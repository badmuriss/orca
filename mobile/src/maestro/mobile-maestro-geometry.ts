import type { WorkspaceCanvasDocument } from '../../../src/shared/maestro-document-contract'
import {
  workspaceSurfaceKey,
  type WorkspaceSurface
} from '../../../src/shared/maestro-workspace-canvas'

export type MaestroViewport = { center: { x: number; y: number }; zoom: number }
export type MaestroCardFrame = { x: number; y: number; width: number; height: number }

export function mobileMaestroInspectorInsets(
  wide: boolean,
  selected: boolean
): { insetRight: number; insetBottom: number } {
  if (!selected) {
    return { insetRight: 0, insetBottom: 0 }
  }
  return wide ? { insetRight: 292, insetBottom: 0 } : { insetRight: 0, insetBottom: 450 }
}

export function projectMobileMaestroFrame(
  viewport: MaestroViewport,
  frame: MaestroCardFrame,
  viewportSize: { width: number; height: number }
): MaestroCardFrame {
  return {
    x: (frame.x - viewport.center.x) * viewport.zoom + viewportSize.width / 2,
    y: (frame.y - viewport.center.y) * viewport.zoom + viewportSize.height / 2,
    width: frame.width * viewport.zoom,
    height: frame.height * viewport.zoom
  }
}

export function defaultMobileMaestroFrame(index: number, wide: boolean): MaestroCardFrame {
  const width = wide ? 300 : 260
  const height = wide ? 190 : 168
  const columns = wide ? 3 : 2
  return {
    x: (index % columns) * (width + 28),
    y: Math.floor(index / columns) * (height + 28),
    width,
    height
  }
}

export function mobileMaestroFrame(
  surface: WorkspaceSurface,
  index: number,
  document: WorkspaceCanvasDocument,
  wide: boolean
): MaestroCardFrame {
  const fallback = defaultMobileMaestroFrame(index, wide)
  const placement = document.placements[workspaceSurfaceKey(surface.id)]
  return placement
    ? {
        x: placement.position.x,
        y: placement.position.y,
        width: placement.size.width,
        height: placement.size.height
      }
    : fallback
}

export function revealMobileMaestroFrame(
  viewport: MaestroViewport,
  frame: MaestroCardFrame,
  usable: { width: number; height: number; insetRight: number; insetBottom: number }
): MaestroViewport {
  const left = (frame.x - viewport.center.x) * viewport.zoom + usable.width / 2
  const top = (frame.y - viewport.center.y) * viewport.zoom + usable.height / 2
  const right = left + frame.width * viewport.zoom
  const bottom = top + frame.height * viewport.zoom
  const safeRight = usable.width - usable.insetRight - 16
  const safeBottom = usable.height - usable.insetBottom - 16
  const safeLeft = 16
  const safeTop = 72
  let dx = 0
  let dy = 0
  if (left < safeLeft) {
    dx = left - safeLeft
  } else if (right > safeRight) {
    dx = right - safeRight
  }
  if (top < safeTop) {
    dy = top - safeTop
  } else if (bottom > safeBottom) {
    dy = bottom - safeBottom
  }
  return {
    center: {
      x: viewport.center.x + dx / viewport.zoom,
      y: viewport.center.y + dy / viewport.zoom
    },
    zoom: viewport.zoom
  }
}

export function fitMobileMaestroFrames(
  frames: readonly MaestroCardFrame[],
  usable: { width: number; height: number; insetRight: number; insetBottom: number }
): MaestroViewport {
  if (frames.length === 0) {
    return { center: { x: 0, y: 0 }, zoom: 1 }
  }
  const minX = Math.min(...frames.map((frame) => frame.x))
  const minY = Math.min(...frames.map((frame) => frame.y))
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width))
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height))
  const safe = {
    left: 20,
    top: 72,
    right: usable.width - usable.insetRight - 20,
    bottom: usable.height - usable.insetBottom - 20
  }
  const zoom = Math.min(
    1.25,
    Math.max(1, safe.right - safe.left) / (maxX - minX),
    Math.max(1, safe.bottom - safe.top) / (maxY - minY)
  )
  const safeCenter = { x: (safe.left + safe.right) / 2, y: (safe.top + safe.bottom) / 2 }
  return {
    center: {
      x: (minX + maxX) / 2 + (usable.width / 2 - safeCenter.x) / zoom,
      y: (minY + maxY) / 2 + (usable.height / 2 - safeCenter.y) / zoom
    },
    zoom
  }
}
