import { useEffect, useState } from 'react'
import type { MaestroDocumentReadScope } from '../../../../shared/maestro-contract'
import type {
  AgentGraphProjectionInput,
  MaestroProjection
} from '../../../../shared/maestro-projection'
import { getMaestroProjection } from '@/runtime/runtime-maestro-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { applyAgentGraphDelta } from '../../../../shared/maestro-projection'

export type MaestroProjectionState = {
  state: 'loading' | 'ready' | 'empty' | 'unavailable'
  projection: MaestroProjection | null
}
const PROJECTION_POLL_INTERVAL_MS = 1000

export function isMaestroProjection(value: unknown): value is MaestroProjection {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<MaestroProjection>
  return (
    typeof candidate.change === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.revision === 'number' &&
    (candidate.source === 'snapshot' || candidate.source === 'delta') &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.workspace?.executionHostId === 'string' &&
    typeof candidate.workspace.workspaceKey === 'string'
  )
}

export function useMaestroProjection(
  target: RuntimeClientTarget | null,
  scope: MaestroDocumentReadScope | null
): MaestroProjectionState {
  const [state, setState] = useState<MaestroProjectionState>({ state: 'loading', projection: null })
  const executionHostId = scope?.execution_host_id
  const workspaceKey = scope?.workspace_key
  useEffect(() => {
    if (!target || !executionHostId || !workspaceKey) {
      setState({ state: 'unavailable', projection: null })
      return
    }
    let cancelled = false
    let timer: number | undefined
    setState({ state: 'loading', projection: null })
    const refresh = async (): Promise<void> => {
      try {
        const projection = await getMaestroProjection(target, {
          execution_host_id: executionHostId,
          workspace_key: workspaceKey
        })
        if (!cancelled && (projection === null || isMaestroProjection(projection))) {
          setState(
            projection ? { state: 'ready', projection } : { state: 'empty', projection: null }
          )
        } else if (!cancelled) {
          setState({ state: 'unavailable', projection: null })
        }
      } catch {
        if (!cancelled) {
          setState({ state: 'unavailable', projection: null })
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(refresh, PROJECTION_POLL_INTERVAL_MS)
      }
    }
    void refresh()
    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [executionHostId, target, workspaceKey])
  return state
}

export function mergeMaestroProjectionView(
  previous: AgentGraphProjectionInput,
  next: AgentGraphProjectionInput
): AgentGraphProjectionInput {
  return applyAgentGraphDelta(previous, next)
}
