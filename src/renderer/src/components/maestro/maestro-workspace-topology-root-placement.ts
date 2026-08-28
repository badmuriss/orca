import type {
  MaestroCanvasInsets,
  MaestroCanvasSize,
  MaestroCanvasViewport
} from './maestro-canvas-viewport'
import {
  findWorkspaceWindowPlacementNearPosition,
  placeWorkspaceWindowNearViewport,
  type MaestroWorkspaceWindowPlacement,
  type MaestroWorkspaceWindowPlacementAttempt
} from './maestro-workspace-window-layout'

export function placeMaestroWorkspaceTopologyRoot(
  placement: MaestroWorkspaceWindowPlacement,
  occupied: readonly MaestroWorkspaceWindowPlacement[],
  preferredPosition: { x: number; y: number },
  viewport: MaestroCanvasViewport,
  canvas: MaestroCanvasSize,
  insets: MaestroCanvasInsets
): MaestroWorkspaceWindowPlacementAttempt {
  const nearViewport = placeWorkspaceWindowNearViewport(
    placement,
    occupied,
    viewport,
    canvas,
    insets
  )
  const usableWorldSpan = Math.max(
    (canvas.width - insets.left - insets.right) / viewport.zoom,
    (canvas.height - insets.top - insets.bottom) / viewport.zoom
  )
  if (
    Math.abs(nearViewport.position.x - preferredPosition.x) <= usableWorldSpan &&
    Math.abs(nearViewport.position.y - preferredPosition.y) <= usableWorldSpan
  ) {
    return { placement: nearViewport, collisionFree: true }
  }
  return findWorkspaceWindowPlacementNearPosition(placement, occupied, preferredPosition)
}
