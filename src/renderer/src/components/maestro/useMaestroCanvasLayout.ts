import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { MaestroDocument } from '../../../../shared/maestro-contract'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  graphFromMaestroDocument,
  INITIAL_MAESTRO_VIEWPORT,
  maestroNodeBounds,
  nextDirectionalMaestroNode,
  type MaestroCanvasNode,
  type MaestroCanvasPoint,
  type MaestroSpatialGraph
} from './maestro-canvas-view-model'
import {
  clampMaestroZoom,
  isMaestroCanvasBoundsVisible,
  type MaestroCanvasSize
} from './maestro-canvas-viewport'
import { projectionToCanvasGraph } from './maestro-projection-view-model'
import { useMaestroCanvasPersistence } from './useMaestroCanvasPersistence'
import { useMaestroProjection } from './useMaestroProjection'

type Params = {
  document: MaestroDocument
  documentKey: { executionHostId: string; workspaceKey: string }
  revision?: number
  runtimeTarget: RuntimeClientTarget | null
  graph?: MaestroSpatialGraph
  onPositionChange?: (nodeId: string, position: MaestroCanvasPoint) => void
  onConflict?: () => void
}

function canvasSize(element: SVGSVGElement | null): MaestroCanvasSize {
  const bounds = element?.getBoundingClientRect()
  return bounds && bounds.width > 0 && bounds.height > 0
    ? { width: bounds.width, height: bounds.height }
    : { width: 1, height: 1 }
}

export function useMaestroCanvasLayout({
  document,
  documentKey,
  revision,
  runtimeTarget,
  graph,
  onPositionChange,
  onConflict
}: Params) {
  const canvasRef = useRef<SVGSVGElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const revisionRef = useRef(revision)
  const viewportRef = useRef(document.viewport ?? INITIAL_MAESTRO_VIEWPORT)
  const [size, setSize] = useState<MaestroCanvasSize>({ width: 1, height: 1 })
  const [viewport, setViewport] = useState(viewportRef.current)
  const projection = useMaestroProjection(graph ? null : runtimeTarget, {
    execution_host_id: documentKey.executionHostId,
    workspace_key: documentKey.workspaceKey
  })
  const projectedGraph = useMemo(
    () =>
      projection.state === 'ready' && projection.projection
        ? projectionToCanvasGraph(projection.projection)
        : null,
    [projection]
  )
  const sourceGraph = useMemo(
    () => graphFromMaestroDocument(document, graph ?? projectedGraph ?? undefined),
    [document, graph, projectedGraph]
  )
  const [nodes, setNodes] = useState<readonly MaestroCanvasNode[]>(sourceGraph.nodes)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [forcedNodeId, setForcedNodeId] = useState<string | null>(null)
  const documentViewportX = document.viewport?.center.x
  const documentViewportY = document.viewport?.center.y
  const documentViewportZoom = document.viewport?.zoom
  const reducedMotion = usePrefersReducedMotion()
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const persistence = useMaestroCanvasPersistence({
    documentKey,
    runtimeTarget,
    revisionRef,
    viewportRef,
    canvasRef,
    nodesById,
    size,
    setViewport,
    setNodes,
    onPositionChange,
    onConflict
  })

  useEffect(() => {
    revisionRef.current = revision
  }, [revision])
  useEffect(() => {
    setNodes(sourceGraph.nodes)
    const knownIds = new Set(sourceGraph.nodes.map((node) => node.id))
    setSelectedIds((current) => {
      const retained = new Set([...current].filter((id) => knownIds.has(id)))
      return retained.size === current.size ? current : retained
    })
  }, [sourceGraph.nodes])
  useEffect(() => {
    const restored =
      documentViewportX === undefined ||
      documentViewportY === undefined ||
      documentViewportZoom === undefined
        ? INITIAL_MAESTRO_VIEWPORT
        : { center: { x: documentViewportX, y: documentViewportY }, zoom: documentViewportZoom }
    viewportRef.current = restored
    setViewport(restored)
  }, [
    documentViewportX,
    documentViewportY,
    documentViewportZoom,
    documentKey.executionHostId,
    documentKey.workspaceKey
  ])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const update = () => setSize(canvasSize(canvas))
    update()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const selectNode = useCallback((nodeId: string, extend: boolean): void => {
    setSelectedIds((current) => {
      if (!extend) {
        return new Set([nodeId])
      }
      const next = new Set(current)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])
  const focusNode = useCallback(
    (node: MaestroCanvasNode): void => {
      setForcedNodeId(node.id)
      selectNode(node.id, false)
      persistence.scheduleViewportCommit({
        ...viewportRef.current,
        center: {
          x: node.position.x + maestroNodeBounds(node).width / 2,
          y: node.position.y + maestroNodeBounds(node).height / 2
        }
      })
      requestAnimationFrame(() => nodeRefs.current.get(node.id)?.focus())
    },
    [persistence, selectNode]
  )
  const fit = useCallback((): void => {
    if (!nodes.length) {
      persistence.scheduleViewportCommit(INITIAL_MAESTRO_VIEWPORT)
      return
    }
    const left = Math.min(...nodes.map((node) => node.position.x))
    const right = Math.max(...nodes.map((node) => node.position.x + maestroNodeBounds(node).width))
    const top = Math.min(...nodes.map((node) => node.position.y))
    const bottom = Math.max(
      ...nodes.map((node) => node.position.y + maestroNodeBounds(node).height)
    )
    const zoom = clampMaestroZoom(
      Math.min(size.width / (right - left + 160), size.height / (bottom - top + 160))
    )
    persistence.scheduleViewportCommit({
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
      zoom
    })
  }, [nodes, persistence, size])
  const handleNodeKeyDown = useCallback(
    (nodeId: string, event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectNode(nodeId, event.shiftKey)
        return
      }
      const directions: Record<string, MaestroCanvasPoint> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 }
      }
      const current = nodesById.get(nodeId)
      const next =
        current && directions[event.key]
          ? nextDirectionalMaestroNode(current, nodes, directions[event.key])
          : null
      if (next) {
        event.preventDefault()
        focusNode(next)
      }
    },
    [focusNode, nodes, nodesById, selectNode]
  )
  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => isMaestroCanvasBoundsVisible(maestroNodeBounds(node), viewport, size)),
    [nodes, size, viewport]
  )
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () =>
      sourceGraph.edges.filter(
        (edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)
      ),
    [sourceGraph.edges, visibleNodeIds]
  )
  const selectedNode =
    selectedIds.size === 1 ? nodesById.get(selectedIds.values().next().value ?? '') : undefined
  const worldRect = {
    x: viewport.center.x - size.width / viewport.zoom / 2,
    y: viewport.center.y - size.height / viewport.zoom / 2,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom
  }
  const viewBox = `${worldRect.x} ${worldRect.y} ${worldRect.width} ${worldRect.height}`

  return {
    canvasRef,
    nodeRefs,
    revisionRef,
    viewportRef,
    size,
    viewport,
    nodes,
    selectedIds,
    setSelectedIds,
    search,
    setSearch,
    forcedNodeId,
    reducedMotion,
    nodesById,
    visibleNodes,
    visibleEdges,
    selectedNode,
    worldRect,
    projection: projection.state === 'ready' ? projection.projection : null,
    viewBox,
    selectNode,
    focusNode,
    fit,
    handleNodeKeyDown,
    ...persistence
  }
}
