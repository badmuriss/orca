import { initializeWorkerStartResources } from './worker-start-resource-state'
import { beginLocalWorkerDispatch } from './local-worker-dispatch-start'
import type { TuiAgent } from '../../../../../../shared/tui-agent'
import type { MaestroTerminalLease } from '../../../../../../shared/maestro-terminal-lease'
import { resolveReplacementWorkerStart } from './worker-start-schema'
import {
  createExistingWorktreeWorkerTerminal,
  createWorkerWorktree,
  monitorWorkerSetup,
  requireWorkerAuthority,
  resolveWorkerTerminalTitle
} from './worker-topology'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './worker-setup-gate'
import {
  activateWorkerTerminalLease,
  prepareWorkerTerminalLease
} from './worker-terminal-lease-activation'
import {
  assertWorkerTerminalIncarnation,
  prepareLocalWorkerStartTopology
} from './worker-start-validation'
import { recoverWorkerStartFailure } from '../../orchestration-worker-start-recovery'
import { resolveWorkerStartReadinessTimeoutMs } from '../../../../../../shared/orchestration-timing-budgets'
import {
  buildWorkerTerminalLaunchProfile,
  prepareWorkerTerminalTransferAuthority
} from '../../../../orchestration/db/worker-terminal/worker-terminal-start-authority'
import { createPendingWorkerStartReceipt } from '../../orchestration-worker-start'
import { TUI_AGENT_CONFIG } from '../../../../../../shared/tui-agent-config'
import { isVisibleDraftComposerReady } from '../../../../../../shared/draft-paste-ready-scanner'

import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { RunRow, TaskRow } from '../../../../orchestration/types'
import type { WorkerStartInput } from './worker-start-schema'
import { resolveResidualAgentTerminal } from './failed-start-residual-terminal'
import type { DurableWorkerMutationIdentity } from '../../orchestration-worker-terminal-lease-types'

export async function startLocalWorker(args: {
  params: WorkerStartInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  coordinatorPane: string | null
  existingTask?: TaskRow
  orchestrationMutation?: DurableWorkerMutationIdentity
  recordMutationReceipt?: (receipt: unknown) => void
}): Promise<unknown> {
  const {
    runtime,
    db,
    run,
    coordinatorPane,
    existingTask,
    orchestrationMutation,
    recordMutationReceipt
  } = args
  const params = resolveReplacementWorkerStart(args.params, db)
  const readinessTimeoutMs = resolveWorkerStartReadinessTimeoutMs(params.timeoutMs)
  const prepared = await prepareLocalWorkerStartTopology({
    params,
    runtime,
    db,
    runId: run.id,
    taskId: existingTask?.id,
    coordinatorGeneration: run.consumer_generation,
    hasDurableMutation: Boolean(orchestrationMutation)
  })
  const { requestedWorktree, creationWorktree, agent, agentDiscovery, launch, retryPreflight } =
    prepared
  let { resolvedWorktree } = prepared

  const started = beginLocalWorkerDispatch({
    params,
    runtime,
    db,
    run,
    coordinatorPane,
    existingTask,
    orchestrationMutation,
    prepared,
    readinessTimeoutMs
  })
  const task = started.task
  const attemptId = params.attemptId ?? started.dispatch.id
  const leaseTitle = resolveWorkerTerminalTitle(task)
  let workerLease: MaestroTerminalLease | undefined
  let leaseTransferReceipt: ReturnType<typeof db.transferMaestroWorkerTerminalLease> | undefined
  const initial = initializeWorkerStartResources(resolvedWorktree?.id)
  const effects = initial.effects
  let setupReceipt = initial.setupReceipt
  let terminalHandle = params.terminal
  let terminalRevealWarning: string | undefined
  let failedStage = 'terminal_create'
  try {
    if (creationWorktree) {
      failedStage = 'worktree_create'
      const created = await createWorkerWorktree({
        runtime,
        db,
        dispatchId: started.dispatch.id,
        requestedWorktree,
        coordinatorWorktree: creationWorktree,
        params,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        effects
      })
      resolvedWorktree = created.worktree
      terminalHandle = created.terminalHandle
      setupReceipt = created.setupReceipt
    } else if (!terminalHandle) {
      db.recordWorkerStage({
        dispatchId: started.dispatch.id,
        stage: 'terminal_creating',
        worktreeId: resolvedWorktree!.id,
        effects
      })
      const terminal = await createExistingWorktreeWorkerTerminal({
        runtime,
        worktreeId: resolvedWorktree!.id,
        agent: agent as TuiAgent,
        launchPreferences: launch.preferences,
        taskId: task.id,
        effects
      })
      terminalHandle = terminal.handle
      terminalRevealWarning = terminal.warning
    } else {
      effects.push({
        kind: 'terminal',
        role: 'agent',
        action: 'reused',
        id: terminalHandle
      })
    }
    if (!resolvedWorktree || !terminalHandle) {
      throw new Error('Worker topology did not resolve an agent terminal and worktree.')
    }
    const setupStage = {
      db,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      terminalHandle,
      setup: setupReceipt,
      effects
    }
    if (persistGatedSetupSpawnFailure(setupStage)) {
      failedStage = 'setup_start'
      throw new Error('Setup terminal failed to start before the gated agent launch.')
    }
    persistWorkerReadinessStage(setupStage)

    const terminal = await runtime.showTerminal(terminalHandle)
    assertWorkerTerminalIncarnation(runtime, terminalHandle)
    const terminalAuthority = requireWorkerAuthority(runtime, terminalHandle)
    const authority = prepareWorkerTerminalTransferAuthority({
      db,
      terminalHandle,
      terminalAuthority,
      retryPreflight,
      effects,
      retryOf: params.retryOf,
      dispatchId: started.dispatch.id,
      worktreeId: resolvedWorktree.id,
      setupState: setupReceipt.state,
      externalTerminal: Boolean(params.terminal)
    })
    const leaseArgs = {
      db,
      runtime,
      attemptId,
      terminalHandle,
      terminal,
      terminalAuthority,
      leaseTitle,
      effects,
      runId: run.id,
      taskId: task.id,
      taskSpec: task.spec,
      canDispatchSubWorkers: started.dispatch.depth < runtime.getNestedWorkerMaxDepth(),
      coordinatorGeneration: run.consumer_generation,
      dispatchId: started.dispatch.id,
      retryOf: params.retryOf,
      mutation: orchestrationMutation,
      preflightExecutable: prepared.preflightExecutable,
      retryResourceId: retryPreflight?.resourceId,
      reusableResourceId: authority.reusableResourceId,
      retryPredecessorLeaseId: authority.predecessorLeaseId,
      launchProfile: buildWorkerTerminalLaunchProfile(launch.receipt.effective),
      capability: authority.capability,
      coordinatorHandle: params.from,
      devMode: params.devMode,
      onLeaseTransfer: (receipt: NonNullable<typeof leaseTransferReceipt>) => {
        leaseTransferReceipt = receipt
      }
    }
    const preparedLease = prepareWorkerTerminalLease(leaseArgs)
    workerLease = preparedLease.workerLease
    leaseTransferReceipt = preparedLease.transferReceipt
    recordMutationReceipt?.(
      createPendingWorkerStartReceipt({
        runId: run.id,
        taskId: task.id,
        attemptId,
        terminalHandle,
        dispatchId: started.dispatch.id,
        leaseId: preparedLease.workerLease.id,
        ...(agentDiscovery ? { agentDiscovery } : {})
      })
    )

    failedStage = 'agent_readiness'
    let wait = await runtime.waitForTerminal(terminalHandle, {
      condition: 'tui-idle',
      timeoutMs: readinessTimeoutMs
    })
    const readySignal = agent ? TUI_AGENT_CONFIG[agent].draftPasteReadySignal : undefined
    if (!wait.satisfied && readySignal) {
      const refreshedTerminal = await runtime.showTerminal(terminalHandle)
      if (isVisibleDraftComposerReady(readySignal, refreshedTerminal.preview)) {
        wait = { ...wait, satisfied: true }
      }
    }
    persistWorkerSetupWaitOutcome({ ...setupStage, wait })
    if (!wait.satisfied) {
      if (setupReceipt.state === 'failed') {
        failedStage = 'setup_wait'
      }
      throw new Error(
        wait.blockedReason
          ? `Agent startup blocked: ${wait.blockedReason}`
          : 'worker_readiness_unverifiable'
      )
    }

    failedStage = 'dispatch_input'
    const activated = await activateWorkerTerminalLease({
      ...leaseArgs,
      prepared: preparedLease
    })
    workerLease = activated.workerLease
    leaseTransferReceipt = activated.transferReceipt
    const worker = db.markWorkerDispatchReady(started.dispatch.id, effects)
    monitorWorkerSetup({
      runtime,
      db,
      runId: run.id,
      dispatchId: started.dispatch.id,
      setupReceipt,
      effects
    })
    const result = {
      runId: run.id,
      taskId: task.id,
      attemptId,
      terminalHandle,
      dispatchId: started.dispatch.id,
      leaseId: workerLease.id,
      readiness: 'ready',
      ...(activated.prompt?.prompt ? { prompt: activated.prompt.prompt } : {}),
      ...(agentDiscovery ? { agentDiscovery } : {}),
      state: worker.state,
      stage: worker.stage,
      setup: setupReceipt,
      launch: launch.receipt,
      timeoutMs: readinessTimeoutMs,
      effects,
      residualResources: [],
      ...(leaseTransferReceipt ? { leaseTransfer: leaseTransferReceipt } : {}),
      ...(terminalRevealWarning ? { warning: terminalRevealWarning } : {})
    }
    recordMutationReceipt?.(result)
    return result
  } catch (error) {
    const residualAgentTerminal = resolveResidualAgentTerminal({
      runtime,
      effects,
      terminalHandle,
      worktreeId: resolvedWorktree?.id ?? null
    })
    return recoverWorkerStartFailure({
      db,
      runId: run.id,
      taskId: task.id,
      dispatchId: started.dispatch.id,
      failedStage,
      error,
      setup: setupReceipt,
      launch: launch.receipt,
      attemptId,
      terminalHandle,
      workerLease,
      leaseTransferReceipt,
      residualAgentTerminal,
      recordMutationReceipt
    })
  }
}
