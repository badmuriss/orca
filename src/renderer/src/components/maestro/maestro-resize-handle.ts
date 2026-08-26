import type { MaestroCanvasPoint, MaestroCanvasSize } from './maestro-canvas-view-model'

/** Excalidraw's grammar: four corners plus four edge midpoints. */
export type MaestroResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type HandleGeometry = {
  handle: MaestroResizeHandle
  /** Fraction of the window's width/height where the handle centre sits. */
  fx: number
  fy: number
  cursor: string
}

export const MAESTRO_RESIZE_HANDLES: readonly HandleGeometry[] = [
  { handle: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { handle: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { handle: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { handle: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { handle: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { handle: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { handle: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { handle: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' }
]

export type MaestroResizeOrigin = {
  x: number
  y: number
  width: number
  height: number
}

/** Re-anchors so the edge the operator is not dragging stays put, even once the size clamps. */
export function resizeMaestroWindow(
  handle: MaestroResizeHandle,
  origin: MaestroResizeOrigin,
  delta: MaestroCanvasPoint,
  clamp: (size: MaestroCanvasSize) => MaestroCanvasSize
): { position: MaestroCanvasPoint; size: MaestroCanvasSize } {
  const pullsWest = handle.includes('w')
  const pullsNorth = handle.includes('n')
  const requested = {
    width: origin.width + (handle.includes('e') ? delta.x : pullsWest ? -delta.x : 0),
    height: origin.height + (handle.includes('s') ? delta.y : pullsNorth ? -delta.y : 0)
  }
  const size = clamp(requested)
  return {
    position: {
      x: pullsWest ? origin.x + origin.width - size.width : origin.x,
      y: pullsNorth ? origin.y + origin.height - size.height : origin.y
    },
    size
  }
}
