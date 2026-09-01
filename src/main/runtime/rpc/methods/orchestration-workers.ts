import type { TuiAgent } from '../../../../shared/tui-agent'
import type { MaestroTerminalLease } from '../../../../shared/maestro-terminal-lease'
import { defineMethod, type RpcMethod } from '../core'
import { startFederatedWorker } from './orchestration-federated-worker-start'
import {
  resolveReplacementWorkerStart,
  WorkerStartParams
} from './orchestration-worker-start-schema'
import {
  createExistingWorktreeWorkerTerminal,
  createWorkerWorktree,
  monitorWorkerSetup,
  requireWorkerAuthority,
  resolveWorkerTerminalTitle,
  type WorkerEffect,
  type WorkerSetupReceipt
} from './orchestration-worker-topology'
import {
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome
} from './orchestration-worker-setup-gate'
import {
  activateWorkerTerminalLease,
  prepareWorkerTerminalLease
} from './orchestration-worker-start-receipt'
import {
  assertWorkerTerminalIncarnation,
  prepareLocalWorkerStartTopology,
  resolveWorkerStartTask
} from './orchestration-worker-start-validation'
import { recoverWorkerStartFailure } from './orchestration-worker-start-recovery'
import { resolveDispatchCreator } from './orchestration-dispatch-creator'
import {
  isWorkerStartTimeoutWithinTimerLimit,
  resolveWorkerStartReadinessTimeoutMs
} from '../../../../shared/orchestration-timing-budgets'
import {
  buildWorkerTerminalLaunchProfile,
  prepareWorkerTerminalTransferAuthority
} from '../../orchestration/db/worker-terminal/worker-terminal-start-authority'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { createPendingWorkerStartReceipt } from './orchestration-worker-start'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import { isVisibleDraftComposerReady } from '../../../../shared/draft-paste-ready-scanner'

export const ORCHESTRATION_WORKER_START_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.workerStart',
    params: WorkerStartParams,
    handler: async (
      params,
      { runtime, orchestrationMutation, orchestrationCompatibilityEvidence, recordMutationReceipt }
    ) => {
      if (!isWorkerStartTimeoutWithinTimerLimit(params.timeoutMs)) {
        throw new OrchestrationError(
          'invalid_argument',
          `--timeout-ms is too large for worker-start transport grace; the derived timeout must fit within the timer limit.`
        )
      }
      const readinessTimeoutMs = resolveWorkerStartReadinessTimeoutMs(params.timeoutMs)
      const { db, run, task } = resolveWorkerStartTask({
        params,
        runtime,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      params = resolveReplacementWorkerStart(params, db)

      if (params.on) {
        return startFederatedWorker({
          params,
          runtime,
          db,
          runId: run.id,
          task,
          orchestrationMutation
        })
      }
      const prepared = await prepareLocalWorkerStartTopology({
        params,
        runtime,
        db,
        runId: run.id,
        taskId: task.id,
        coordinatorGeneration: run.consumer_generation,
        hasDurableMutation: Boolean(orchestrationMutation)
      })
      const {
        requestedWorktree,
        createsWorktree,
        creationWorktree,
        agent,
        agentDiscovery,
        launch,
        retryPreflight
      } = prepared
      let { resolvedWorktree } = prepared

      const startOptions = {
        worktree: requestedWorktree,
        resolvedWorktreeId: resolvedWorktree?.id ?? null,
        name: params.name ?? null,
        repo: params.repo ?? creationWorktree?.repoId ?? null,
        baseBranch: params.baseBranch ?? null,
        terminal: params.terminal ?? null,
        agent: agent ?? null,
        replacementOf: params.replacementOf ?? null,
        launch: launch.receipt,
        timeoutMs: readinessTimeoutMs,
        setup: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
        setupSource: createsWorktree
          ? params.setup
            ? 'explicit_request'
            : 'orchestration_default'
          : 'existing_worktree'
      }
      const started = db.createStartingWorkerDispatch({
        creator: resolveDispatchCreator(runtime, params.from),
        maxDepth: runtime.getNestedWorkerMaxDepth(),
        taskId: task.id,
        retryOf: params.retryOf,
        replacementOf: params.replacementOf,
        startOptions,
        runtimeEpoch: runtime.getRuntimeId(),
        mutationReceipt: orchestrationMutation
      })
      const attemptId = params.attemptId ?? started.dispatch.id
      const leaseTitle = resolveWorkerTerminalTitle(task)
      let workerLease: MaestroTerminalLease | undefined
      let leaseTransferReceipt: ReturnType<typeof db.transferMaestroWorkerTerminalLease> | undefined
      const effects: WorkerEffect[] = []
      if (resolvedWorktree) {
        effects.push(
          { kind: 'worktree', action: 'reused', id: resolvedWorktree.id },
          { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
        )
      }
      let terminalHandle = params.terminal
      let terminalRevealWarning: string | undefined
      let failedStage = 'terminal_create'
      let setupReceipt: WorkerSetupReceipt = {
        requested: 'not_applicable',
        effective: 'not_applicable',
        source: 'existing_worktree',
        hookFound: false,
        startupPolicy: 'start-immediately',
        state: 'not_applicable'
      }
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
          recordMutationReceipt
        })
      }
    }
  })
]
