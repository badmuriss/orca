import { useCallback, useEffect, useRef } from 'react'
import type {
  Dispatch,
  MutableRefObject,
  PointerEvent,
  RefObject,
  SetStateAction,
  WheelEvent
} from 'react'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  maestroNodeBounds,
  type MaestroCanvasNode,
  type MaestroCanvasPoint
} from './maestro-canvas-view-model'
import { commitMaestroLayout, type MaestroPendingCommit } from './maestro-layout-commit'
import {
  zoomMaestroViewportAtPointer,
  type MaestroCanvasSize,
  type MaestroCanvasViewport
} from './maestro-canvas-viewport'
import type { MaestroResizeHandle } from './maestro-resize-handle'
import { maestroDragUpdate, type MaestroPointerDrag } from './maestro-pointer-drag'
type Params = {
  documentKey: { executionHostId: string; workspaceKey: string }
  runtimeTarget: RuntimeClientTarget | null
  revisionRef: MutableRefObject<number | undefined>
  viewportRef: MutableRefObject<MaestroCanvasViewport>
  canvasRef: RefObject<SVGSVGElement | null>
  nodesById: ReadonlyMap<string, MaestroCanvasNode>
  size: MaestroCanvasSize
  setViewport: Dispatch<SetStateAction<MaestroCanvasViewport>>
  setNodes: Dispatch<SetStateAction<readonly MaestroCanvasNode[]>>
  onPositionChange?: (nodeId: string, position: MaestroCanvasPoint) => void
  onConflict?: () => void
}

export function useMaestroCanvasPersistence({
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
}: Params) {
  const frameRef = useRef<number | null>(null)
  const dragRef = useRef<MaestroPointerDrag | null>(null)
  const wheelTimerRef = useRef<number | null>(null)
  const pendingViewportRef = useRef<MaestroCanvasViewport | null>(null)
  const pendingNodeRef = useRef<{
    nodeId: string
    position: MaestroCanvasPoint
    size?: MaestroCanvasSize
  } | null>(null)
  const pendingCommitRef = useRef<MaestroPendingCommit | null>(null)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current)
      }
    },
    []
  )

  const commit = useCallback(
    (next: MaestroPendingCommit): Promise<void> => {
      const queued = mutationQueueRef.current.then(async () => {
        const result = await commitMaestroLayout({
          next,
          runtimeTarget,
          scope: {
            execution_host_id: documentKey.executionHostId,
            workspace_key: documentKey.workspaceKey
          },
          expectedRevision: revisionRef.current
        })
        if (result.outcome === 'conflict') {
          onConflict?.()
          return
        }
        if (result.outcome === 'applied') {
          revisionRef.current = result.revision
        }
      })
      mutationQueueRef.current = queued.catch(() => undefined)
      return queued
    },
    [documentKey, onConflict, revisionRef, runtimeTarget]
  )

  const flushFrame = useCallback(
    (durable: boolean): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      const pendingViewport = pendingViewportRef.current
      const pendingNode = pendingNodeRef.current
      pendingViewportRef.current = null
      pendingNodeRef.current = null
      if (pendingViewport) {
        setViewport(pendingViewport)
      }
      if (pendingNode) {
        setNodes((current) =>
          current.map((node) =>
            node.id === pendingNode.nodeId
              ? {
                  ...node,
                  position: pendingNode.position,
                  size: pendingNode.size ?? node.size
                }
              : node
          )
        )
        onPositionChange?.(pendingNode.nodeId, pendingNode.position)
      }
      if (durable && pendingCommitRef.current) {
        const next = pendingCommitRef.current
        pendingCommitRef.current = null
        void commit(next)
      }
    },
    [commit, onPositionChange, setNodes, setViewport]
  )

  const schedule = useCallback(
    (
      nextViewport?: MaestroCanvasViewport,
      nextNode?: { nodeId: string; position: MaestroCanvasPoint; size?: MaestroCanvasSize }
    ): void => {
      if (nextViewport) {
        viewportRef.current = nextViewport
        pendingViewportRef.current = nextViewport
        pendingCommitRef.current = { kind: 'set-viewport', viewport: nextViewport }
      }
      if (nextNode) {
        pendingNodeRef.current = nextNode
        pendingCommitRef.current = {
          kind: 'move-node',
          nodeId: nextNode.nodeId,
          position: nextNode.position
        }
      }
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null
          flushFrame(false)
        })
      }
    },
    [flushFrame, viewportRef]
  )

  const scheduleViewportCommit = useCallback(
    (nextViewport: MaestroCanvasViewport): void => {
      schedule(nextViewport)
      flushFrame(true)
    },
    [flushFrame, schedule]
  )

  const deferViewportCommit = useCallback((): void => {
    if (wheelTimerRef.current !== null) {
      window.clearTimeout(wheelTimerRef.current)
    }
    wheelTimerRef.current = window.setTimeout(() => flushFrame(true), 120)
  }, [flushFrame])

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>): void => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }
      const update = maestroDragUpdate(
        drag,
        { x: event.clientX, y: event.clientY },
        viewportRef.current.zoom,
        nodesById
      )
      if (update) {
        schedule(update.viewport, update.node)
      }
    },
    [nodesById, schedule, viewportRef]
  )
  const endPointerDrag = useCallback(
    (event: PointerEvent<SVGSVGElement>): void => {
      if (dragRef.current?.pointerId !== event.pointerId) {
        return
      }
      dragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      flushFrame(true)
    },
    [flushFrame]
  )
  const handleCanvasPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>): void => {
      if (event.button !== 0 || event.target !== event.currentTarget) {
        return
      }
      dragRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        point: { x: event.clientX, y: event.clientY },
        center: viewportRef.current.center
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [viewportRef]
  )
  const handleNodePointerDown = useCallback(
    (nodeId: string, event: PointerEvent<HTMLElement>): void => {
      const node = nodesById.get(nodeId)
      const canvas = canvasRef.current
      if (event.button !== 0 || !node || !canvas) {
        return
      }
      event.stopPropagation()
      dragRef.current = {
        kind: 'node',
        pointerId: event.pointerId,
        nodeId,
        point: { x: event.clientX, y: event.clientY },
        position: node.position
      }
      canvas.setPointerCapture(event.pointerId)
    },
    [canvasRef, nodesById]
  )
  const handleNodeResizePointerDown = useCallback(
    (nodeId: string, handle: MaestroResizeHandle, event: PointerEvent<Element>): void => {
      const node = nodesById.get(nodeId)
      const canvas = canvasRef.current
      if (event.button !== 0 || !node || !canvas) {
        return
      }
      event.stopPropagation()
      event.preventDefault()
      dragRef.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        nodeId,
        handle,
        point: { x: event.clientX, y: event.clientY },
        origin: maestroNodeBounds(node)
      }
      canvas.setPointerCapture(event.pointerId)
    },
    [canvasRef, nodesById]
  )
  const handleWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>): void => {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      schedule(
        zoomMaestroViewportAtPointer(
          viewportRef.current,
          size,
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          viewportRef.current.zoom * Math.exp(-event.deltaY * 0.0015)
        )
      )
      deferViewportCommit()
    },
    [deferViewportCommit, schedule, size, viewportRef]
  )

  return {
    endPointerDrag,
    handleCanvasPointerDown,
    handleNodePointerDown,
    handleNodeResizePointerDown,
    handlePointerMove,
    handleWheel,
    scheduleViewportCommit
  }
}
