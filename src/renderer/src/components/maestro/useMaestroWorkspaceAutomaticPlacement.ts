import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { RuntimeMaestroWorkspaceCanvasScope } from '../../../../shared/runtime-types'
import type { MaestroWorkspaceCanvasResource } from '@/hooks/useMaestroWorkspaceCanvas'
import type { MaestroWorkspaceTopologyLayoutNode } from './maestro-workspace-topology-layout'
import { layoutIncrementalMaestroWorkspaceTopology } from './maestro-workspace-topology-layout'
import {
  createMaestroSurfaceAdditionTracker,
  workspaceWindowBounds,
  type MaestroWorkspaceWindowPlacement
} from './maestro-workspace-window-layout'
import type { useMaestroWorkspaceViewport } from './useMaestroWorkspaceViewport'
import { maestroWorkspaceMutationKey } from './maestro-workspace-mutation-key'

const surfaceAdditionTracker = createMaestroSurfaceAdditionTracker()
export const MAESTRO_REVEAL_INSETS = { top: 64, right: 344, bottom: 16, left: 16 } as const

type PlacementMap = Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
type CanvasResult = NonNullable<MaestroWorkspaceCanvasResource['result']>

export function useMaestroWorkspaceAutomaticPlacement({
  result,
  resource,
  scope,
  surfaceKeys,
  nodes,
  placements,
  setPlacements,
  optimisticPlacements,
  board
}: {
  result: CanvasResult | null
  resource: MaestroWorkspaceCanvasResource
  scope: RuntimeMaestroWorkspaceCanvasScope
  surfaceKeys: readonly string[]
  nodes: readonly MaestroWorkspaceTopologyLayoutNode[]
  placements: PlacementMap
  setPlacements: Dispatch<SetStateAction<PlacementMap>>
  optimisticPlacements: MutableRefObject<Record<string, MaestroWorkspaceWindowPlacement>>
  board: ReturnType<typeof useMaestroWorkspaceViewport>
}): void {
  useEffect(() => {
    if (!result) {
      return
    }
    const additions = surfaceAdditionTracker.observe(
      `${scope.execution_host_id}:${scope.workspace_key}`,
      surfaceKeys,
      board.viewportReady
    )
    const unplaced = surfaceKeys.filter(
      (surfaceKey) =>
        !result.canvas.document.placements[surfaceKey] && !optimisticPlacements.current[surfaceKey]
    )
    const candidateKeys = [...new Set([...additions, ...unplaced])]
    if (candidateKeys.length === 0) {
      return
    }
    const candidates = new Set(candidateKeys)
    const existingPlacements = Object.fromEntries(
      Object.entries(placements).filter(([surfaceKey]) => !candidates.has(surfaceKey))
    )
    const layout = layoutIncrementalMaestroWorkspaceTopology({
      nodes,
      existingPlacements,
      viewport: board.viewport,
      canvas: board.size,
      insets: MAESTRO_REVEAL_INSETS
    })
    const positioned = Object.fromEntries(
      layout.automaticallyPlacedSurfaceKeys.flatMap((surfaceKey) => {
        const placement = layout.placements[surfaceKey]
        return placement ? [[surfaceKey, placement]] : []
      })
    )
    if (Object.keys(positioned).length === 0) {
      return
    }
    for (const [surfaceKey, placement] of Object.entries(positioned)) {
      const surface = result.snapshot.surfaces[surfaceKey]
      if (!surface) {
        continue
      }
      optimisticPlacements.current[surfaceKey] = placement
      void resource.mutate({
        action: 'set-placement',
        surface_id: surface.id,
        placement,
        idempotency_key: maestroWorkspaceMutationKey('initial-placement', surfaceKey)
      })
    }
    setPlacements((current) => ({ ...current, ...positioned }))
    const newestAddition = additions.findLast((surfaceKey) => positioned[surfaceKey])
    if (newestAddition) {
      board.reveal(workspaceWindowBounds(positioned[newestAddition]!), MAESTRO_REVEAL_INSETS)
    }
  }, [
    board,
    nodes,
    optimisticPlacements,
    placements,
    resource,
    result,
    scope.execution_host_id,
    scope.workspace_key,
    setPlacements,
    surfaceKeys
  ])
}
