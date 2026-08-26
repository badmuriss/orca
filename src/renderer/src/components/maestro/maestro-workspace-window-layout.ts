import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'

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
  document: WorkspaceCanvasDocument
): MaestroWorkspaceWindowPlacement {
  return (
    document.placements[surfaceKey] ?? {
      position: { x: 36 + (index % 3) * 350, y: 52 + Math.floor(index / 3) * 260 },
      size: { width: 320, height: 220 },
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
