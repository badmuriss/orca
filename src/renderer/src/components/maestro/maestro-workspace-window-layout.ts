import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'

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
