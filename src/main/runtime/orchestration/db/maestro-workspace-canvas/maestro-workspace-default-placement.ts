import type { WorkspaceCanvasDocument } from '../../../../../shared/maestro-document-contract'
import type { WorkspaceSurface } from '../../../../../shared/maestro-workspace-canvas'

export function defaultWorkspaceCanvasPlacement(
  index: number,
  surface: WorkspaceSurface
): WorkspaceCanvasDocument['placements'][string] {
  const isAnnotation = surface.binding.kind === 'content' && surface.binding.annotation != null
  const size =
    surface.content_type === 'terminal'
      ? { width: 720, height: 460 }
      : isAnnotation
        ? { width: 440, height: 360 }
        : { width: 360, height: 260 }
  return {
    position: { x: (index % 3) * 760, y: Math.floor(index / 3) * 500 },
    size,
    collapsed: false,
    z_order: index
  }
}
