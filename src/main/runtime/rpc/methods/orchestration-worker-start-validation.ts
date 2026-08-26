import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { getRetryWorkerTerminalPreflight } from '../../orchestration/db/worker-terminal/worker-terminal-start-authority'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { assertOrchestrationWorktreeCreationSupported } from './orchestration-folder-worktree-placement'
import type { FederationAttachStartInput } from './orchestration-federation-start-schema'
import {
  attachWorkerLaunchExecutable,
  assertWorkerLaunchPreferencesCreateTerminal,
  createWorkerLaunchReceipt,
  resolveWorkerLaunchPreferences
} from './orchestration-worker-launch-preferences'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import type { OrchestrationCompatibilityEvidence } from '../../../../shared/orchestration-compatibility-evidence'
import { resolveOrchestrationCaller } from './orchestration-run-scope'

type WorkerStartLaunch = ReturnType<typeof resolveWorkerLaunchPreferences>

export function assertWorkerTerminalIncarnation(
  runtime: OrcaRuntimeService,
  terminalHandle: string
): void {
  if (
    !runtime.getTerminalProcessIncarnation(terminalHandle) ||
    !runtime.getTerminalPaneKey(terminalHandle)
  ) {
    throw new Error('terminal_incarnation_unavailable')
  }
}

export function resolveWorkerStartTask(args: {
  params: WorkerStartInput
  runtime: OrcaRuntimeService
  callerEvidence?: OrchestrationCompatibilityEvidence
}) {
  const db = args.runtime.getOrchestrationDb()
  const coordinatorPane = resolveOrchestrationCaller(args.runtime, {
    callerTerminalHandle: args.params.from,
    callerEvidence: args.callerEvidence
  })
  const run = coordinatorPane ? db.getCurrentRunForPane(coordinatorPane) : undefined
  if (!run || (args.params.run && args.params.run !== run.id)) {
    throw new OrchestrationError(
      'consumer_fenced',
      'worker-start requires the coordinator terminal currently bound to the Task Run.'
    )
  }
  const task = db.getTask(args.params.task)
  if (!task || task.run_id !== run.id) {
    throw new OrchestrationError(
      'task_not_found',
      `Task ${args.params.task} was not found in Run ${run.id}.`
    )
  }
  return { db, run, task }
}

/** getClientSettings() throws when no store is wired up; permission-mode reporting must degrade, not block worker-start. */
function safeGetClientSettings(
  runtime: OrcaRuntimeService
): ReturnType<OrcaRuntimeService['getClientSettings']> | undefined {
  try {
    return runtime.getClientSettings()
  } catch {
    return undefined
  }
}

export function validateFederatedWorkerStartPlacement(
  params: WorkerStartInput,
  createsWorktree: boolean
): void {
  if (createsWorktree && (!params.name || !params.repo)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Remote new-top-level requires --name and an explicit --repo from remote discovery.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  if (!params.terminal && (!params.agent || !isTuiAgent(params.agent))) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'A configured --agent is required when remote worker-start creates a terminal.'
    )
  }
}

export function prepareLocalWorkerStart(args: {
  params: WorkerStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with new-worktree creation.'
    )
  }
  if (createsWorktree && !params.name) {
    throw new OrchestrationError('invalid_argument', 'New worktrees require --name.')
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to new-child or new-top-level worktrees.'
    )
  }
  return resolveWorkerStartAgent({
    runtime,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage: 'A configured --agent is required when worker-start creates a terminal.'
  })
}

export async function prepareLocalWorkerStartTopology(args: {
  params: WorkerStartInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  runId: string
  taskId: string
  coordinatorGeneration: number
  hasDurableMutation: boolean
}) {
  const { params, runtime, db } = args
  if (params.retryOf && (!params.terminal || !params.attemptId)) {
    throw new OrchestrationError(
      'lease_identity_conflict',
      'Retry worker-start requires the exact prior terminal and attempt.'
    )
  }
  if (params.retryOf && !args.hasDurableMutation) {
    throw new OrchestrationError(
      'invalid_argument',
      'Retry worker-start requires a durable mutation request before terminal effects.'
    )
  }

  const requestedWorktree = params.worktree ?? 'current'
  const createsWorktree = requestedWorktree === 'new-child' || requestedWorktree === 'new-top-level'
  const { agent, launch } = prepareLocalWorkerStart({ params, createsWorktree, runtime })
  const coordinatorTerminal = await runtime.showTerminal(params.from)
  const creationWorktree = createsWorktree
    ? await runtime.showManagedWorktree(`id:${coordinatorTerminal.worktreeId}`)
    : undefined
  if (creationWorktree) {
    await assertOrchestrationWorktreeCreationSupported({
      runtime,
      repoSelector: params.repo ?? creationWorktree.repoId,
      existingPlacement: 'current or an exact existing folder workspace'
    })
  }
  const resolvedWorktree = creationWorktree
    ? undefined
    : requestedWorktree === 'current'
      ? await runtime.showManagedTerminalWorkspace(`id:${coordinatorTerminal.worktreeId}`)
      : await runtime.showManagedTerminalWorkspace(requestedWorktree)
  if (params.terminal) {
    const explicitTerminal = await runtime.showTerminal(params.terminal)
    if (explicitTerminal.worktreeId !== resolvedWorktree?.id) {
      throw new OrchestrationError(
        'terminal_worktree_mismatch',
        `Terminal ${params.terminal} does not belong to worktree ${resolvedWorktree?.id}.`
      )
    }
    if (!(await runtime.isTerminalRunningAgent(params.terminal))) {
      throw new OrchestrationError(
        'agent_unconfigured',
        `Terminal ${params.terminal} is not running a recognized agent.`
      )
    }
  }

  const retryPreflight = params.retryOf
    ? getRetryWorkerTerminalPreflight({
        runtime,
        db,
        retryOf: params.retryOf,
        attemptId: params.attemptId!,
        terminalHandle: params.terminal!,
        runId: args.runId,
        taskId: args.taskId,
        coordinatorGeneration: args.coordinatorGeneration
      })
    : undefined
  const preflightWorktree =
    !createsWorktree || requestedWorktree === 'new-child'
      ? (creationWorktree ?? resolvedWorktree!)
      : await (async () => {
          const targetRepo = await runtime.showRepo(params.repo ?? creationWorktree!.repoId)
          return { id: targetRepo.id, hostId: getRepoExecutionHostId(targetRepo) }
        })()
  const preflightExecutable = runtime.preflightWorktreeManagedCliExecutable(preflightWorktree)
  attachWorkerLaunchExecutable(launch.receipt, preflightExecutable)
  return {
    requestedWorktree,
    createsWorktree,
    creationWorktree,
    resolvedWorktree,
    agent,
    launch,
    retryPreflight,
    preflightExecutable
  }
}

export function prepareFederationAttachmentWorkerStart(args: {
  params: FederationAttachStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (createsWorktree && (!params.name || !params.repo)) {
    throw new OrchestrationError(
      'invalid_argument',
      'A remote new-top-level worktree requires --name and an explicit --repo.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (
    !createsWorktree &&
    (params.name || params.repo || params.baseBranch || params.setup || params.setupSource)
  ) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  return resolveWorkerStartAgent({
    runtime,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage:
      'A configured --agent is required when federated worker-start creates a terminal.'
  })
}

function resolveWorkerStartAgent(args: {
  runtime: OrcaRuntimeService
  terminal?: string
  agent?: string
  model?: string
  effort?: string
  missingAgentMessage: string
}): { agent: TuiAgent | undefined; launch: WorkerStartLaunch } {
  if (!args.terminal && (!args.agent || !isTuiAgent(args.agent))) {
    throw new OrchestrationError('agent_unconfigured', args.missingAgentMessage)
  }
  const agent = args.agent as TuiAgent | undefined
  if (agent) {
    args.runtime.validateOrchestrationAgentLauncher(agent)
    return {
      agent,
      launch: resolveWorkerLaunchPreferences({
        agent,
        model: args.model,
        effort: args.effort,
        // Why: permission-mode reporting is best-effort — a runtime without a
        // live store (unset up in some test/degraded contexts) must not block
        // worker-start over it; resolveRequestedAgentPermissionMode already
        // degrades to the agent's shipped default when settings is undefined.
        settings: safeGetClientSettings(args.runtime)
      })
    }
  }
  return {
    agent: undefined,
    launch: {
      preferences: undefined,
      receipt: createWorkerLaunchReceipt({ agent: null })
    }
  }
}
