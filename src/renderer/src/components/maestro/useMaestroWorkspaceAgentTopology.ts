import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { MaestroProjection } from '../../../../shared/maestro-projection'
import type { WorkspaceSurfaceSnapshot } from '../../../../shared/maestro-workspace-canvas'
import { useAppStore } from '@/store'
import {
  maestroTerminalSurfacePaneKey,
  projectMaestroAgentTopology,
  type CanvasAgentTopology
} from './maestro-agent-topology'

function terminalPaneKeys(snapshot: WorkspaceSurfaceSnapshot | null): string[] {
  if (!snapshot) {
    return []
  }
  return Object.values(snapshot.surfaces)
    .flatMap((surface) => {
      const paneKey = maestroTerminalSurfacePaneKey(surface)
      return paneKey ? [paneKey] : []
    })
    .sort()
}

function definedOrchestration(
  values: Readonly<Record<string, AgentStatusOrchestrationContext | undefined>>
): Record<string, AgentStatusOrchestrationContext> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, AgentStatusOrchestrationContext] => entry[1] !== undefined
    )
  )
}

export function useMaestroWorkspaceAgentTopology(
  snapshot: WorkspaceSurfaceSnapshot | null,
  formalProjection: MaestroProjection | null
): CanvasAgentTopology {
  const paneKeys = useMemo(() => terminalPaneKeys(snapshot), [snapshot])
  const orchestrationByPaneKey = useAppStore(
    useShallow((state) =>
      Object.fromEntries(
        paneKeys.map((paneKey) => [paneKey, state.runtimeAgentOrchestrationByPaneKey[paneKey]])
      )
    )
  )
  const statusTerminalHandleByPaneKey = useAppStore(
    useShallow((state) =>
      Object.fromEntries(
        paneKeys.map((paneKey) => [
          paneKey,
          state.agentStatusByPaneKey[paneKey]?.terminalHandle ??
            state.retainedAgentsByPaneKey[paneKey]?.entry.terminalHandle
        ])
      )
    )
  )

  return useMemo(() => {
    if (!snapshot) {
      return { nodes: [], relations: [] }
    }
    const sessionHandleByPaneKey = Object.fromEntries(
      Object.values(snapshot.surfaces).flatMap((surface) => {
        const paneKey = maestroTerminalSurfacePaneKey(surface)
        return paneKey && surface.binding.kind === 'terminal' && surface.binding.session_id
          ? [[paneKey, surface.binding.session_id]]
          : []
      })
    )
    return projectMaestroAgentTopology({
      surfaces: snapshot.surfaces,
      orchestrationByPaneKey: definedOrchestration(orchestrationByPaneKey),
      terminalHandleByPaneKey: {
        ...sessionHandleByPaneKey,
        ...Object.fromEntries(
          Object.entries(statusTerminalHandleByPaneKey).filter(([, handle]) => handle !== undefined)
        )
      },
      formalProjection
    })
  }, [formalProjection, orchestrationByPaneKey, snapshot, statusTerminalHandleByPaneKey])
}
