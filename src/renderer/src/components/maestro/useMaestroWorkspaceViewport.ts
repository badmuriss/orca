import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { MaestroWorkspaceCanvasResource } from '@/hooks/useMaestroWorkspaceCanvas'
import {
  clampMaestroZoom,
  maestroBoardGridStep,
  panMaestroViewport,
  revealMaestroCanvasBounds,
  zoomMaestroViewportAtPointer,
  type MaestroCanvasBounds,
  type MaestroCanvasInsets,
  type MaestroCanvasSize,
  type MaestroCanvasViewport
} from './maestro-canvas-viewport'
import type { MaestroWorkspaceWindowPlacement } from './maestro-workspace-window-layout'

const DEFAULT_VIEWPORT: MaestroCanvasViewport = { center: { x: 0, y: 0 }, zoom: 1 }

export function useMaestroWorkspaceViewport(params: {
  canvasRevision: number
  persisted: WorkspaceCanvasDocument['viewport']
  placements: Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
  resource: MaestroWorkspaceCanvasResource
  mutationIdentity: string
}) {
  const [viewport, setViewport] = useState<MaestroCanvasViewport>(
    params.persisted ?? DEFAULT_VIEWPORT
  )
  const viewportRef = useRef(viewport)
  const [size, setSize] = useState<MaestroCanvasSize>({ width: 1, height: 1 })
  const [canvasElement, setCanvasElement] = useState<HTMLElement | null>(null)
  const canvasRef = useCallback((node: HTMLElement | null): void => {
    if (node) {
      setCanvasElement(node)
    }
  }, [])
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitInFlight = useRef(false)
  const flushPendingRef = useRef<() => void>(() => {})
  const pendingCommit = useRef<{
    viewport: MaestroCanvasViewport
    mutate: MaestroWorkspaceCanvasResource['mutate']
    identity: string
  } | null>(null)
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const persistedX = params.persisted?.center.x ?? DEFAULT_VIEWPORT.center.x
  const persistedY = params.persisted?.center.y ?? DEFAULT_VIEWPORT.center.y
  const persistedZoom = params.persisted?.zoom ?? DEFAULT_VIEWPORT.zoom

  useEffect(() => {
    if (pan.current || pendingCommit.current || commitInFlight.current) {
      return
    }
    const persisted = { center: { x: persistedX, y: persistedY }, zoom: persistedZoom }
    viewportRef.current = persisted
    setViewport(persisted)
  }, [params.canvasRevision, persistedX, persistedY, persistedZoom])
  useEffect(() => {
    const node = canvasElement
    if (!node) {
      return
    }
    if (typeof ResizeObserver === 'undefined') {
      const bounds = node.getBoundingClientRect()
      setSize({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) })
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [canvasElement])
  const flushPending = useCallback((): void => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current)
    }
    commitTimer.current = null
    if (commitInFlight.current) {
      return
    }
    const pending = pendingCommit.current
    pendingCommit.current = null
    if (!pending) {
      return
    }
    commitInFlight.current = true
    void pending
      .mutate({
        action: 'set-viewport',
        viewport: pending.viewport,
        idempotency_key: `renderer-viewport-${pending.identity}-${crypto.randomUUID()}`
      })
      .finally(() => {
        commitInFlight.current = false
        if (pendingCommit.current) {
          flushPendingRef.current()
        }
      })
  }, [])
  flushPendingRef.current = flushPending
  useEffect(() => () => flushPending(), [flushPending, params.mutationIdentity])

  const commit = useCallback(
    (next: MaestroCanvasViewport): void => {
      if (commitTimer.current) {
        clearTimeout(commitTimer.current)
      }
      pendingCommit.current = {
        viewport: next,
        mutate: params.resource.mutate,
        identity: params.mutationIdentity
      }
      commitTimer.current = setTimeout(flushPending, 140)
    },
    [flushPending, params.mutationIdentity, params.resource.mutate]
  )

  const update = useCallback(
    (next: MaestroCanvasViewport): void => {
      viewportRef.current = next
      setViewport(next)
      commit(next)
    },
    [commit]
  )

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>): void => {
      if (event.target !== event.currentTarget) {
        return
      }
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      const current = viewportRef.current
      const scrollDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      const next = event.shiftKey
        ? {
            ...current,
            center: { ...current.center, x: current.center.x + scrollDelta / current.zoom }
          }
        : event.ctrlKey || event.metaKey
          ? {
              ...current,
              center: { ...current.center, y: current.center.y + scrollDelta / current.zoom }
            }
          : zoomMaestroViewportAtPointer(
              current,
              size,
              { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
              current.zoom * Math.exp(-scrollDelta * 0.002)
            )
      update(next)
    },
    [size, update]
  )

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget || event.button !== 0) {
      return
    }
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    const current = pan.current
    if (!current || current.pointerId !== event.pointerId) {
      return
    }
    const currentViewport = viewportRef.current
    const next = panMaestroViewport(currentViewport, {
      x: event.clientX - current.x,
      y: event.clientY - current.y
    })
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    viewportRef.current = next
    setViewport(next)
  }, [])
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (pan.current?.pointerId !== event.pointerId) {
        return
      }
      pan.current = null
      commit(viewportRef.current)
    },
    [commit]
  )

  const zoom = useCallback(
    (factor: number) => {
      const current = viewportRef.current
      update({ ...current, zoom: clampMaestroZoom(current.zoom * factor) })
    },
    [update]
  )
  const reset = useCallback(() => update(DEFAULT_VIEWPORT), [update])
  const reveal = useCallback(
    (bounds: MaestroCanvasBounds, insets: MaestroCanvasInsets): void => {
      const current = viewportRef.current
      const next = revealMaestroCanvasBounds(current, size, bounds, insets)
      if (next !== current) {
        update(next)
      }
    },
    [size, update]
  )
  const fit = useCallback(() => {
    const values = Object.values(params.placements)
    if (!values.length) {
      return reset()
    }
    const left = Math.min(...values.map((item) => item.position.x))
    const top = Math.min(...values.map((item) => item.position.y))
    const right = Math.max(...values.map((item) => item.position.x + item.size.width))
    const bottom = Math.max(...values.map((item) => item.position.y + item.size.height))
    update({
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
      zoom: clampMaestroZoom(
        Math.min(size.width / (right - left + 80), size.height / (bottom - top + 80))
      )
    })
  }, [params.placements, reset, size, update])

  const gridStep = maestroBoardGridStep(viewport.zoom) * viewport.zoom
  return {
    canvasRef,
    viewportReady: size.width > 1 && size.height > 1,
    viewport,
    zoom,
    reset,
    fit,
    reveal,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    canvasStyle: {
      backgroundSize: `${gridStep}px ${gridStep}px`,
      backgroundPosition: `${size.width / 2 - viewport.center.x * viewport.zoom}px ${size.height / 2 - viewport.center.y * viewport.zoom}px`
    },
    worldStyle: {
      left: '50%',
      top: '50%',
      transform: `translate(${-viewport.center.x * viewport.zoom}px, ${-viewport.center.y * viewport.zoom}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0'
    }
  }
}
