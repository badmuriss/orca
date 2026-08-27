import { useEffect, useState } from 'react'
import type { MaestroProjection } from '../../../../shared/maestro-projection'
import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'
import type { RuntimeMaestroWorkspaceCanvasScope } from '../../../../shared/runtime-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { getMaestroProjection } from '@/runtime/runtime-maestro-client'

export function useMaestroWorkspaceRunProgress(
  target: RuntimeClientTarget,
  scope: RuntimeMaestroWorkspaceCanvasScope
): MaestroRunProgress | null {
  return useMaestroWorkspaceProjection(target, scope)?.runProgress ?? null
}

export function useMaestroWorkspaceProjection(
  target: RuntimeClientTarget,
  scope: RuntimeMaestroWorkspaceCanvasScope
): MaestroProjection | null {
  const executionHostId = scope.execution_host_id
  const workspaceKey = scope.workspace_key
  const identity = `${executionHostId}\0${workspaceKey}`
  const [state, setState] = useState<{ identity: string; projection: MaestroProjection | null }>({
    identity,
    projection: null
  })
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ identity, projection: null })
    const poll = async (): Promise<void> => {
      try {
        const projection = await getMaestroProjection(target, {
          execution_host_id: executionHostId,
          workspace_key: workspaceKey
        })
        if (!active) {
          return
        }
        setState((current) =>
          current.identity === identity &&
          ((current.projection === null && projection === null) ||
            (current.projection !== null &&
              projection !== null &&
              current.projection.runId === projection.runId &&
              current.projection.revision === projection.revision))
            ? current
            : { identity, projection }
        )
      } catch {
        // Keep the last confirmed projection for this scope through transient poll failures.
      } finally {
        if (active) {
          timer = setTimeout(() => void poll(), 1_500)
        }
      }
    }
    void poll()
    return () => {
      active = false
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [executionHostId, identity, target, workspaceKey])
  return state.identity === identity ? state.projection : null
}
