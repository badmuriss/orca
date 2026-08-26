import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  MaestroDelegationCatalog,
  MaestroDelegationIntent,
  MaestroDelegationRequest,
  MaestroDelegationSource
} from '../../../../shared/maestro-delegation'
import type { MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import {
  getMaestroDelegationCatalog,
  getMaestroDelegationIntent,
  requestMaestroDelegationIntent
} from '@/runtime/runtime-maestro-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

const DELEGATION_REFRESH_DELAY_MS = 500

export type DelegationContext = {
  source: MaestroDelegationSource
  parentTaskId?: string | null
  parentAttemptId?: string | null
  contextRefs?: readonly string[]
}

export type MaestroDelegationController = {
  catalog: MaestroDelegationCatalog | null
  catalogError: string | null
  dialogOpen: boolean
  context: DelegationContext | null
  intent: MaestroDelegationIntent | null
  openDelegation: (context: DelegationContext) => void
  closeDelegation: () => void
  submitDelegation: (request: MaestroDelegationRequest) => Promise<MaestroDelegationIntent>
  onDialogOpenChange: (open: boolean) => void
}

function isTerminal(intent: MaestroDelegationIntent): boolean {
  return ['succeeded', 'failed', 'rejected', 'outcome-unknown'].includes(intent.state)
}

type DelegationAuthority = {
  targetKind: RuntimeClientTarget['kind'] | null
  targetEnvironmentId: string | null
  repositoryId: string | null
  executionHostId: string | null
  workspaceKey: string | null
  runId: string | null
}

function sameWorkspaceAnchor(left: MaestroWorkspaceAnchor, right: MaestroWorkspaceAnchor): boolean {
  return (
    left.repository_id === right.repository_id &&
    left.execution_host_id === right.execution_host_id &&
    left.workspace_key === right.workspace_key &&
    left.run_id === right.run_id
  )
}

function sameDelegationAuthority(left: DelegationAuthority, right: DelegationAuthority): boolean {
  return (
    left.targetKind === right.targetKind &&
    left.targetEnvironmentId === right.targetEnvironmentId &&
    left.repositoryId === right.repositoryId &&
    left.executionHostId === right.executionHostId &&
    left.workspaceKey === right.workspaceKey &&
    left.runId === right.runId
  )
}

function runtimeClientTargetForIdentity(
  targetKind: RuntimeClientTarget['kind'] | null,
  targetEnvironmentId: string | null
): RuntimeClientTarget | null {
  if (targetKind === 'local') {
    return { kind: 'local' }
  }
  if (targetKind === 'environment' && targetEnvironmentId !== null) {
    return { kind: 'environment', environmentId: targetEnvironmentId }
  }
  return null
}

export function useMaestroDelegation(args: {
  target: RuntimeClientTarget | null
  workspace: MaestroWorkspaceAnchor | null
}): MaestroDelegationController {
  const [catalog, setCatalog] = useState<MaestroDelegationCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [context, setContext] = useState<DelegationContext | null>(null)
  const [intent, setIntent] = useState<MaestroDelegationIntent | null>(null)
  const repositoryId = args.workspace?.repository_id
  const executionHostId = args.workspace?.execution_host_id
  const workspaceKey = args.workspace?.workspace_key
  const runId = args.workspace?.run_id
  const targetKind = args.target?.kind ?? null
  const targetEnvironmentId = args.target?.kind === 'environment' ? args.target.environmentId : null
  const previousAuthority = useRef<DelegationAuthority | null>(null)
  const currentAuthority = useRef<DelegationAuthority | null>(null)

  useLayoutEffect(() => {
    currentAuthority.current = {
      targetKind,
      targetEnvironmentId,
      repositoryId: repositoryId ?? null,
      executionHostId: executionHostId ?? null,
      workspaceKey: workspaceKey ?? null,
      runId: runId ?? null
    }
  }, [executionHostId, repositoryId, runId, targetEnvironmentId, targetKind, workspaceKey])

  useEffect(() => {
    const nextAuthority: DelegationAuthority = {
      targetKind,
      targetEnvironmentId,
      repositoryId: repositoryId ?? null,
      executionHostId: executionHostId ?? null,
      workspaceKey: workspaceKey ?? null,
      runId: runId ?? null
    }
    const currentAuthority = previousAuthority.current
    previousAuthority.current = nextAuthority
    if (!currentAuthority || sameDelegationAuthority(currentAuthority, nextAuthority)) {
      return
    }
    setDialogOpen(false)
    setContext(null)
    setIntent(null)
  }, [executionHostId, repositoryId, runId, targetEnvironmentId, targetKind, workspaceKey])

  useEffect(() => {
    const target = runtimeClientTargetForIdentity(targetKind, targetEnvironmentId)
    if (!target || !repositoryId || !executionHostId || !workspaceKey || !runId) {
      setCatalog(null)
      setCatalogError(null)
      return
    }
    const workspace: MaestroWorkspaceAnchor = {
      repository_id: repositoryId,
      execution_host_id: executionHostId,
      workspace_key: workspaceKey,
      run_id: runId
    }
    let cancelled = false
    void getMaestroDelegationCatalog(target, workspace)
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog)
          setCatalogError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog(null)
          setCatalogError(
            error instanceof Error ? error.message : 'Delegation catalog unavailable.'
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [executionHostId, repositoryId, runId, targetEnvironmentId, targetKind, workspaceKey])

  useEffect(() => {
    const target = runtimeClientTargetForIdentity(targetKind, targetEnvironmentId)
    if (
      !dialogOpen ||
      !intent ||
      isTerminal(intent) ||
      !target ||
      !repositoryId ||
      !executionHostId ||
      !workspaceKey ||
      !runId
    ) {
      return
    }
    const workspace: MaestroWorkspaceAnchor = {
      repository_id: repositoryId,
      execution_host_id: executionHostId,
      workspace_key: workspaceKey,
      run_id: runId
    }
    const pollingIntent = intent
    if (!sameWorkspaceAnchor(pollingIntent.workspace, workspace)) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    const refresh = async (): Promise<void> => {
      if (cancelled || !sameWorkspaceAnchor(pollingIntent.workspace, workspace)) {
        return
      }
      try {
        const nextIntent = await getMaestroDelegationIntent(
          target,
          pollingIntent.intent_id,
          workspace
        )
        if (cancelled || !sameWorkspaceAnchor(nextIntent.workspace, workspace)) {
          return
        }
        setIntent(nextIntent)
        if (!isTerminal(nextIntent)) {
          timer = window.setTimeout(() => void refresh(), DELEGATION_REFRESH_DELAY_MS)
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void refresh(), DELEGATION_REFRESH_DELAY_MS)
        }
      }
    }
    timer = window.setTimeout(() => void refresh(), DELEGATION_REFRESH_DELAY_MS)
    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [
    dialogOpen,
    executionHostId,
    intent,
    repositoryId,
    runId,
    targetEnvironmentId,
    targetKind,
    workspaceKey
  ])

  const openDelegation = useCallback((nextContext: DelegationContext): void => {
    setContext(nextContext)
    setIntent(null)
    setDialogOpen(true)
  }, [])
  const closeDelegation = useCallback((): void => {
    setDialogOpen(false)
    setContext(null)
    setIntent(null)
  }, [])
  const onDialogOpenChange = useCallback(
    (open: boolean): void => {
      if (open) {
        setDialogOpen(true)
        return
      }
      closeDelegation()
    },
    [closeDelegation]
  )
  const submitDelegation = useCallback(
    async (request: MaestroDelegationRequest) => {
      const target = runtimeClientTargetForIdentity(targetKind, targetEnvironmentId)
      if (!target) {
        throw new Error('Delegation runtime unavailable.')
      }
      const nextIntent = await requestMaestroDelegationIntent(target, request)
      const requestAuthority: DelegationAuthority = {
        targetKind,
        targetEnvironmentId,
        repositoryId: request.workspace.repository_id,
        executionHostId: request.workspace.execution_host_id,
        workspaceKey: request.workspace.workspace_key,
        runId: request.workspace.run_id
      }
      if (
        !sameWorkspaceAnchor(nextIntent.workspace, request.workspace) ||
        !currentAuthority.current ||
        !sameDelegationAuthority(currentAuthority.current, requestAuthority)
      ) {
        return nextIntent
      }
      setIntent(nextIntent)
      return nextIntent
    },
    [targetEnvironmentId, targetKind]
  )

  return {
    catalog,
    catalogError,
    dialogOpen,
    context,
    intent,
    openDelegation,
    closeDelegation,
    submitDelegation,
    onDialogOpenChange
  }
}
