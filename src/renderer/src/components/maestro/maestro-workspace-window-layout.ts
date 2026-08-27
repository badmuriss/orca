import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import type {
  MaestroCanvasInsets,
  MaestroCanvasSize,
  MaestroCanvasViewport
} from './maestro-canvas-viewport'

export type MaestroWorkspaceWindowPlacement = WorkspaceCanvasDocument['placements'][string]

export function addedMaestroSurfaceKeys(
  previous: readonly string[],
  current: readonly string[]
): string[] {
  const known = new Set(previous)
  return current.filter((surfaceKey) => !known.has(surfaceKey))
}

export function createMaestroSurfaceAdditionTracker() {
  const observedByScope = new Map<string, readonly string[]>()
  return {
    observe(scope: string, current: readonly string[], viewportReady = true): string[] {
      if (!viewportReady) {
        return []
      }
      const previous = observedByScope.get(scope)
      observedByScope.delete(scope)
      observedByScope.set(scope, current)
      if (observedByScope.size > 64) {
        observedByScope.delete(observedByScope.keys().next().value!)
      }
      return previous ? addedMaestroSurfaceKeys(previous, current) : []
    }
  }
}

export function workspaceWindowPlacement(
  surfaceKey: string,
  index: number,
  document: WorkspaceCanvasDocument,
  surface?: WorkspaceSurface
): MaestroWorkspaceWindowPlacement {
  const isAnnotation = surface?.binding.kind === 'content' && surface.binding.annotation != null
  const size =
    surface?.content_type === 'terminal'
      ? { width: 760, height: 530 }
      : isAnnotation
        ? { width: 440, height: 360 }
        : { width: 360, height: 260 }
  return (
    document.placements[surfaceKey] ?? {
      position: { x: 36 + (index % 3) * 800, y: 52 + Math.floor(index / 3) * 570 },
      size,
      collapsed: false,
      z_order: index
    }
  )
}

export function workspaceWindowBounds(placement: MaestroWorkspaceWindowPlacement) {
  return {
    x: placement.position.x,
    y: placement.position.y,
    width: placement.size.width,
    height: placement.size.height
  }
}

const NEW_WINDOW_GAP = 40
const MAX_PLACEMENT_ROWS = 64

function placementsOverlap(
  left: MaestroWorkspaceWindowPlacement,
  right: MaestroWorkspaceWindowPlacement
): boolean {
  return !(
    left.position.x + left.size.width + NEW_WINDOW_GAP <= right.position.x ||
    right.position.x + right.size.width + NEW_WINDOW_GAP <= left.position.x ||
    left.position.y + left.size.height + NEW_WINDOW_GAP <= right.position.y ||
    right.position.y + right.size.height + NEW_WINDOW_GAP <= left.position.y
  )
}

function placementRowOffset(row: number): number {
  if (row === 0) {
    return 0
  }
  const distance = Math.ceil(row / 2)
  return row % 2 === 1 ? distance : -distance
}

export function placeWorkspaceWindowNearViewport(
  placement: MaestroWorkspaceWindowPlacement,
  occupied: readonly MaestroWorkspaceWindowPlacement[],
  viewport: MaestroCanvasViewport,
  canvas: MaestroCanvasSize,
  insets: MaestroCanvasInsets
): MaestroWorkspaceWindowPlacement {
  const usableScreenCenter = {
    x: (insets.left + canvas.width - insets.right) / 2,
    y: (insets.top + canvas.height - insets.bottom) / 2
  }
  const anchor = {
    x: viewport.center.x + (usableScreenCenter.x - canvas.width / 2) / viewport.zoom,
    y: viewport.center.y + (usableScreenCenter.y - canvas.height / 2) / viewport.zoom
  }
  const usableWorldWidth = (canvas.width - insets.left - insets.right) / viewport.zoom
  const columnX =
    usableWorldWidth >= placement.size.width * 2 + NEW_WINDOW_GAP
      ? [anchor.x - NEW_WINDOW_GAP / 2 - placement.size.width, anchor.x + NEW_WINDOW_GAP / 2]
      : [anchor.x - placement.size.width / 2]
  const originY = anchor.y - placement.size.height / 2
  const zOrder = Math.max(placement.z_order, ...occupied.map((item) => item.z_order + 1), 0)

  for (let row = 0; row < MAX_PLACEMENT_ROWS; row += 1) {
    const y = originY + placementRowOffset(row) * (placement.size.height + NEW_WINDOW_GAP)
    for (const x of columnX) {
      const candidate = {
        ...placement,
        position: {
          x: Math.round(x),
          y: Math.round(y)
        },
        z_order: zOrder
      }
      if (!occupied.some((item) => placementsOverlap(candidate, item))) {
        return candidate
      }
    }
  }

  return {
    ...placement,
    position: { x: Math.round(columnX[0]), y: Math.round(originY) },
    z_order: zOrder
  }
}

export function moveWorkspaceWindow(
  placement: MaestroWorkspaceWindowPlacement,
  delta: { x: number; y: number }
): MaestroWorkspaceWindowPlacement {
  return {
    ...placement,
    position: {
      x: placement.position.x + delta.x,
      y: placement.position.y + delta.y
    }
  }
}

export function resizeWorkspaceWindow(
  placement: MaestroWorkspaceWindowPlacement,
  delta: { x: number; y: number }
): MaestroWorkspaceWindowPlacement {
  return {
    ...placement,
    size: {
      width: Math.max(240, placement.size.width + delta.x),
      height: Math.max(150, placement.size.height + delta.y)
    }
  }
}
