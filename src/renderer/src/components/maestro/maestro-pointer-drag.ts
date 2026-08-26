import type { MaestroCanvasNode, MaestroCanvasPoint } from './maestro-canvas-view-model'
import type { MaestroCanvasSize, MaestroCanvasViewport } from './maestro-canvas-viewport'
import { resizeMaestroWindow, type MaestroResizeHandle } from './maestro-resize-handle'
import { clampMaestroWindowSize } from './maestro-window-model'

export type MaestroPointerDrag =
  | { kind: 'pan'; pointerId: number; point: MaestroCanvasPoint; center: MaestroCanvasPoint }
  | {
      kind: 'node'
      pointerId: number
      nodeId: string
      point: MaestroCanvasPoint
      position: MaestroCanvasPoint
    }
  | {
      kind: 'resize'
      pointerId: number
      nodeId: string
      handle: MaestroResizeHandle
      point: MaestroCanvasPoint
      origin: { x: number; y: number; width: number; height: number }
    }

export type MaestroDragUpdate = {
  viewport?: MaestroCanvasViewport
  node?: { nodeId: string; position: MaestroCanvasPoint; size?: MaestroCanvasSize }
}

/** Turns one pointer move into the viewport or node change it implies. */
export function maestroDragUpdate(
  drag: MaestroPointerDrag,
  pointer: MaestroCanvasPoint,
  zoom: number,
  nodesById: ReadonlyMap<string, MaestroCanvasNode>
): MaestroDragUpdate | null {
  const delta = { x: (pointer.x - drag.point.x) / zoom, y: (pointer.y - drag.point.y) / zoom }
  if (drag.kind === 'node') {
    return {
      node: {
        nodeId: drag.nodeId,
        position: { x: drag.position.x + delta.x, y: drag.position.y + delta.y }
      }
    }
  }
  if (drag.kind === 'resize') {
    const node = nodesById.get(drag.nodeId)
    if (!node) {
      return null
    }
    return {
      node: {
        nodeId: drag.nodeId,
        ...resizeMaestroWindow(drag.handle, drag.origin, delta, (size) =>
          clampMaestroWindowSize(node, size)
        )
      }
    }
  }
  return {
    viewport: { center: { x: drag.center.x - delta.x, y: drag.center.y - delta.y }, zoom }
  }
}
