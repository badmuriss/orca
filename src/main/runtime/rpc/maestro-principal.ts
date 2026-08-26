import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  isRuntimeOwnedSshTargetId,
  normalizeExecutionHostId,
  RUNTIME_OWNED_SSH_TARGET_ID_PREFIX,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../shared/execution-host'
import type {
  MaestroActor,
  MaestroDocumentReadScope,
  MaestroWorkspaceAnchor
} from '../../../shared/maestro-contract'
import type { MaestroPrincipal } from '../../../shared/maestro-actor'
import { getPtyExecutionHost } from '../../../shared/terminal-execution-host'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../shared/workspace-scope'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrchestrationCompatibilityTerminalAuthority } from '../orca-runtime'
import type { RpcContext } from './core'

type ResolvedMaestroWorkspace = {
  repository_id: string | null
  execution_host_id: string
  workspace_key: string
}

function stablePrincipalId(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/[^A-Za-z0-9._-]/g, '-')
  return normalized && normalized.length > 0 ? normalized.slice(0, 128) : fallback
}

async function resolveRuntimeWorkspace(
  context: RpcContext,
  requested: Pick<MaestroDocumentReadScope, 'execution_host_id' | 'workspace_key'>
): Promise<ResolvedMaestroWorkspace> {
  const parsed = parseWorkspaceKey(requested.workspace_key)
  if (parsed?.type === 'folder') {
    const folder = context.runtime
      .listFolderWorkspaces()
      .find((candidate) => candidate.id === parsed.folderWorkspaceId)
    if (!folder) {
      throw new OrchestrationError('unauthorized', 'Maestro workspace authority is unavailable.')
    }
    const executionHostId =
      normalizeExecutionHostId(folder.executionHostId) ??
      (folder.connectionId ? toSshExecutionHostId(folder.connectionId) : 'local')
    return {
      // Folder workspaces can contain zero or many repositories; host + folder key is authoritative.
      repository_id: null,
      execution_host_id: executionHostId,
      workspace_key: folderWorkspaceKey(folder.id)
    }
  }
  if (parsed?.type !== 'worktree') {
    throw new OrchestrationError('unauthorized', 'Maestro workspace authority is unavailable.')
  }
  let worktree: Awaited<ReturnType<RpcContext['runtime']['showManagedWorktree']>>
  try {
    worktree = await context.runtime.showManagedWorktree(`id:${parsed.worktreeId}`)
  } catch {
    throw new OrchestrationError('unauthorized', 'Maestro workspace authority is unavailable.')
  }
  const repo = context.runtime.listRepos().find((candidate) => candidate.id === worktree.repoId)
  return {
    repository_id: worktree.repoId,
    execution_host_id: getWorktreeExecutionHostId(
      worktree,
      repo,
      repo ? getRepoExecutionHostId(repo) : 'local'
    ),
    workspace_key: worktreeWorkspaceKey(worktree.id)
  }
}

function requireExactRequestedScope(
  requested: Pick<MaestroDocumentReadScope, 'execution_host_id' | 'workspace_key'>,
  resolved: ResolvedMaestroWorkspace
): void {
  if (
    requested.execution_host_id !== resolved.execution_host_id ||
    requested.workspace_key !== resolved.workspace_key
  ) {
    throw new OrchestrationError(
      'unauthorized',
      'The authenticated transport is not bound to this Maestro workspace.'
    )
  }
}

function requireExactRequestedRepository(
  requested: MaestroWorkspaceAnchor,
  resolved: ResolvedMaestroWorkspace
): void {
  if (resolved.repository_id !== null && requested.repository_id !== resolved.repository_id) {
    throw new OrchestrationError(
      'unauthorized',
      'The authenticated transport is not bound to this Maestro workspace.'
    )
  }
}

export async function resolveMaestroDocumentReadScope(
  context: RpcContext,
  requested: MaestroDocumentReadScope
): Promise<MaestroDocumentReadScope> {
  const resolvedWorkspace = await resolveRuntimeWorkspace(context, requested)
  requireExactRequestedScope(requested, resolvedWorkspace)
  return {
    execution_host_id: resolvedWorkspace.execution_host_id,
    workspace_key: resolvedWorkspace.workspace_key
  }
}

export type MaestroLayoutPrincipal = MaestroActor & {
  workspace: MaestroDocumentReadScope
}

export async function resolveMaestroLayoutPrincipal(
  context: RpcContext,
  requested: MaestroDocumentReadScope
): Promise<MaestroLayoutPrincipal> {
  const workspace = await resolveMaestroDocumentReadScope(context, requested)
  const db = context.runtime.getOrchestrationDb()
  const actorId = stablePrincipalId(
    context.authenticatedCallerFingerprint ?? db.getOrCreateLocalMutationCallerFingerprint(),
    'local-user'
  )
  return {
    actor_id: actorId,
    kind: 'user',
    authenticated: true,
    session_id: actorId,
    workspace
  }
}

function terminalWorkspaceKey(worktreeId: string): string {
  return parseWorkspaceKey(worktreeId) ? worktreeId : worktreeWorkspaceKey(worktreeId)
}

function runtimeOwnedSshHostIds(targetId: string): string[] {
  if (!isRuntimeOwnedSshTargetId(targetId)) {
    return [toSshExecutionHostId(targetId)]
  }
  const runtimeId = targetId.slice(RUNTIME_OWNED_SSH_TARGET_ID_PREFIX.length)
  return runtimeId
    ? [toSshExecutionHostId(targetId), toRuntimeExecutionHostId(runtimeId)]
    : [toSshExecutionHostId(targetId)]
}

function terminalExecutionHostIds(terminal: OrchestrationCompatibilityTerminalAuthority): string[] {
  const ptyHost = getPtyExecutionHost(terminal.ptyId)
  if (ptyHost === 'foreign') {
    return []
  }
  if (ptyHost?.startsWith('ssh:')) {
    const parsedTargetId = decodeURIComponent(ptyHost.slice('ssh:'.length))
    return runtimeOwnedSshHostIds(parsedTargetId)
  }
  if (ptyHost) {
    return [ptyHost]
  }
  return terminal.hostScope.kind === 'ssh'
    ? runtimeOwnedSshHostIds(terminal.hostScope.targetId)
    : ['local']
}

function principalWorkspace(
  resolved: ResolvedMaestroWorkspace,
  runId: string
): MaestroPrincipal['workspace'] {
  return {
    execution_host_id: resolved.execution_host_id,
    workspace_key: resolved.workspace_key,
    run_id: runId
  }
}

export async function resolveMaestroPrincipal(
  context: RpcContext,
  requested: MaestroWorkspaceAnchor
): Promise<MaestroPrincipal> {
  const resolvedWorkspace = await resolveRuntimeWorkspace(context, requested)
  requireExactRequestedScope(requested, resolvedWorkspace)
  requireExactRequestedRepository(requested, resolvedWorkspace)
  const db = context.runtime.getOrchestrationDb()
  const run = db.getRun(requested.run_id)
  if (!run) {
    throw new OrchestrationError('run_not_found', 'Maestro requires an active Orca Run.')
  }

  const legacyCoordinator = context.legacyCoordinatorAuthority
  if (legacyCoordinator) {
    const terminal = context.runtime.getOrchestrationDispatchAuthority(
      legacyCoordinator.terminalHandle
    )
    if (
      legacyCoordinator.runId !== run.id ||
      legacyCoordinator.consumerGeneration !== run.consumer_generation ||
      !terminal ||
      terminal.paneKey !== legacyCoordinator.paneKey ||
      run.coordinator_handle !== legacyCoordinator.terminalHandle ||
      run.coordinator_pane_key !== legacyCoordinator.paneKey ||
      !terminalExecutionHostIds(terminal).includes(resolvedWorkspace.execution_host_id) ||
      terminalWorkspaceKey(terminal.worktreeId) !== resolvedWorkspace.workspace_key
    ) {
      throw new OrchestrationError('unauthorized', 'Maestro coordinator authority is stale.')
    }
    return {
      actor_id: stablePrincipalId(
        legacyCoordinator.principalId ?? legacyCoordinator.terminalHandle,
        'coordinator'
      ),
      kind: 'coordinator',
      authenticated: true,
      session_id: stablePrincipalId(legacyCoordinator.terminalHandle, 'coordinator-session'),
      generation: legacyCoordinator.consumerGeneration,
      workspace: principalWorkspace(resolvedWorkspace, run.id)
    }
  }

  const callerAuthority =
    context.orchestrationCompatibilityCallerAuthority ??
    context.runtime.verifyOrchestrationCompatibilityCaller(
      context.orchestrationCompatibilityEvidence,
      { currentRuntimeLaunchSufficient: true }
    )
  if (callerAuthority) {
    const terminal = context.runtime.getOrchestrationDispatchAuthority(
      callerAuthority.terminalHandle
    )
    if (
      !terminal ||
      terminal.paneKey !== callerAuthority.paneKey ||
      terminal.processIncarnation !== callerAuthority.processIncarnation ||
      !terminalExecutionHostIds(terminal).includes(resolvedWorkspace.execution_host_id) ||
      terminalWorkspaceKey(terminal.worktreeId) !== resolvedWorkspace.workspace_key
    ) {
      throw new OrchestrationError(
        'unauthorized',
        'The authenticated terminal is not bound to this Maestro workspace.'
      )
    }
    const dispatch = db.getActiveDispatchForIdentity(
      callerAuthority.terminalHandle,
      callerAuthority.paneKey
    )
    if (dispatch && dispatch.run_id !== run.id) {
      throw new OrchestrationError(
        'unauthorized',
        'The authenticated worker belongs to another run.'
      )
    }
    const isCoordinator =
      run.coordinator_handle === callerAuthority.terminalHandle &&
      run.coordinator_pane_key === callerAuthority.paneKey
    if (!dispatch && !isCoordinator) {
      throw new OrchestrationError(
        'unauthorized',
        'The authenticated terminal has no authority for this Maestro run.'
      )
    }
    const actorId = stablePrincipalId(callerAuthority.terminalHandle, 'maestro-terminal')
    return {
      actor_id: actorId,
      kind: isCoordinator ? 'coordinator' : 'worker',
      authenticated: true,
      session_id: stablePrincipalId(callerAuthority.processIncarnation, actorId),
      ...(isCoordinator ? { generation: run.consumer_generation } : {}),
      workspace: principalWorkspace(resolvedWorkspace, run.id)
    }
  }

  const caller = stablePrincipalId(
    context.authenticatedCallerFingerprint ?? db.getOrCreateLocalMutationCallerFingerprint(),
    'local-user'
  )
  return {
    actor_id: caller,
    kind: 'user',
    authenticated: true,
    session_id: caller,
    workspace: principalWorkspace(resolvedWorkspace, run.id)
  }
}
