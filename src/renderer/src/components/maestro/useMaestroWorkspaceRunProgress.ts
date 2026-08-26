import { useEffect, useState } from 'react'
import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'
import type { RuntimeMaestroWorkspaceCanvasScope } from '../../../../shared/runtime-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { getMaestroProjection } from '@/runtime/runtime-maestro-client'

export function useMaestroWorkspaceRunProgress(
  target: RuntimeClientTarget,
  scope: RuntimeMaestroWorkspaceCanvasScope
): MaestroRunProgress | null {
  const executionHostId = scope.execution_host_id
  const workspaceKey = scope.workspace_key
  const identity = `${executionHostId}\0${workspaceKey}`
  const [state, setState] = useState<{ identity: string; progress: MaestroRunProgress | null }>({
    identity,
    progress: null
  })
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ identity, progress: null })
    const poll = async (): Promise<void> => {
      try {
        const projection = await getMaestroProjection(target, {
          execution_host_id: executionHostId,
          workspace_key: workspaceKey
        })
        if (!active) {
          return
        }
        setState({ identity, progress: projection?.runProgress ?? null })
      } catch {
        if (active) {
          setState({ identity, progress: null })
        }
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
  return state.identity === identity ? state.progress : null
}
