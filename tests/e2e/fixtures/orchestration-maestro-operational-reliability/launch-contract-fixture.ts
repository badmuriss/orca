import { createDraftPasteReadyScanner } from '../../../../src/shared/draft-paste-ready-scanner'
import type { OrchestrationDb } from '../../../../src/main/runtime/orchestration/db/orchestration-db'
import {
  createPendingWorkerStartReceipt,
  createWorkerAgentDiscoveryReceipt,
  createWorkerStartRecoveryCommand,
  isReadinessUnverifiable
} from '../../../../src/main/runtime/rpc/methods/orchestration-worker-start'
import { resolveReplacementWorkerStart } from '../../../../src/main/runtime/rpc/methods/orchestration-worker-start-schema'

export function exerciseLaunchContracts() {
  const discovery = createWorkerAgentDiscoveryReceipt('opencode')
  const pending = createPendingWorkerStartReceipt({
    runId: 'run-career-ops',
    taskId: 'task-launch',
    attemptId: 'attempt-launch',
    dispatchId: 'dispatch-launch',
    leaseId: 'lease-launch',
    terminalHandle: 'term-launch',
    agentDiscovery: discovery
  })
  const scanner = createDraftPasteReadyScanner('opencode-composer-prompt')
  const composerReady = scanner.observe('\x1b[?2004hAsk anything').ready
  const replacement = resolveReplacementWorkerStart(
    { task: 'task-launch', from: 'term-coordinator', replacementOf: 'dispatch-launch' },
    {
      getWorkerDispatch: () => ({
        start_options: JSON.stringify({
          agent: 'opencode',
          resolvedWorktreeId: 'repo::/worktrees/career-ops',
          launch: { requested: { agent: 'opencode', model: null, effort: null } }
        })
      })
    } as OrchestrationDb
  )
  return {
    discovery,
    pendingReadiness: pending.readiness,
    composerReady,
    readinessUnverifiable: isReadinessUnverifiable(new Error('timeout'), 'agent_readiness'),
    replacementAgent: replacement.agent,
    replacementAttempt: replacement.attemptId,
    recoveryCommand: createWorkerStartRecoveryCommand({
      executable: 'orca-dev',
      taskId: 'task-launch',
      dispatchId: 'dispatch-launch',
      exactRetryAvailable: false
    })
  }
}
