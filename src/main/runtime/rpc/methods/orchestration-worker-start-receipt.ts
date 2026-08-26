import { createHash } from 'node:crypto'
import type { MaestroTerminalLaunchProfile } from '../../../../shared/maestro-terminal-lease'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import { isAgentPromptStalledError } from '../../agent-prompt-submission-verification'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import {
  isUnknownWorkerStartOutcome,
  type WorkerEffect,
  type WorkerSetupReceipt
} from './orchestration-worker-topology'
import type { OrchestrationWorkerLaunchReceipt } from './orchestration-worker-launch-preferences'

type DurableMutationIdentity = {
  callerFingerprint: string
  requestId: string
  method: string
  payloadHash: string
}

export async function activateWorkerTerminalLease(args: {
  db: OrchestrationDb
  runtime: OrcaRuntimeService
  runId: string
  canDispatchSubWorkers: boolean
  taskId: string
  taskSpec: string
  coordinatorGeneration: number
  dispatchId: string
  attemptId: string
  retryOf?: string
  mutation?: DurableMutationIdentity
  terminalHandle: string
  terminal: { tabId?: string; ptyId?: string | null }
  terminalAuthority: { paneKey: string; processIncarnation: string; hostScope?: string }
  preflightExecutable: string
  retryResourceId?: string
  retryPredecessorLeaseId?: string
  reusableResourceId?: string
  leaseTitle: string
  launchProfile: MaestroTerminalLaunchProfile
  capability: string
  coordinatorHandle: string
  devMode?: boolean
  effects: WorkerEffect[]
  onLeaseTransfer: (
    receipt: ReturnType<OrchestrationDb['transferMaestroWorkerTerminalLease']>
  ) => void
}) {
  const { db, runtime } = args
  runtime.assertTerminalManagedCliAvailable(args.terminalHandle)
  const managedCliContext = runtime.buildTerminalManagedCliContext(args.terminalHandle)
  if (managedCliContext.executable !== args.preflightExecutable) {
    throw new Error(
      `managed_cli_profile_drift: preflighted executable "${args.preflightExecutable}" does not match the resolved "${managedCliContext.executable}" for terminal ${args.terminalHandle}.`
    )
  }
  const hostScope = args.terminalAuthority.hostScope ?? null
  const tabId =
    args.terminal.tabId ??
    args.terminalAuthority.paneKey.slice(0, args.terminalAuthority.paneKey.indexOf(':'))
  const resource =
    db.getWorkerTerminalResourceByOwner(args.dispatchId) ??
    db.findTransferableWorkerTerminalResource({
      terminalHandle: args.terminalHandle,
      paneKey: args.terminalAuthority.paneKey,
      processIncarnation: args.terminalAuthority.processIncarnation,
      hostScope
    })
  const predecessorLease = resource
    ? db.getMaestroTerminalLeaseByWorkerResource(resource.id)
    : undefined
  if (args.retryOf && resource?.id !== args.retryResourceId) {
    throw new OrchestrationError(
      'lease_identity_conflict',
      `Retry ${args.retryOf} terminal ownership changed before transfer.`
    )
  }
  if (args.retryOf && predecessorLease?.id !== args.retryPredecessorLeaseId) {
    throw new OrchestrationError(
      'lease_identity_conflict',
      `Retry ${args.retryOf} terminal lease changed before transfer.`
    )
  }
  const leaseParams = {
    requestId: `worker:${args.runId}:${args.dispatchId}`,
    executionHostId: managedCliContext.executionHostId,
    workspaceKey: managedCliContext.workspaceKey,
    runId: args.runId,
    taskId: args.taskId,
    attemptId: args.attemptId,
    coordinatorGeneration: args.coordinatorGeneration,
    role: 'worker' as const,
    title: args.leaseTitle,
    launchProfile: args.launchProfile,
    spawnedBy: `coordinator:g${args.coordinatorGeneration}`,
    ownerPrincipal: `dispatch:${args.dispatchId}`,
    retentionPolicy: 'auto_release' as const
  }
  let transferReceipt: ReturnType<OrchestrationDb['transferMaestroWorkerTerminalLease']> | undefined
  let workerLease
  if (predecessorLease && (args.retryOf || resource?.id === args.reusableResourceId)) {
    transferReceipt = db.transferMaestroWorkerTerminalLease({
      requestId: `worker-transfer:${args.runId}:${args.dispatchId}`,
      mutation: args.mutation,
      kind: args.retryOf ? 'strict_retry' : 'settled_resource_reuse',
      predecessorLeaseId: predecessorLease.id,
      successorRequestId: leaseParams.requestId,
      successorDispatchId: args.dispatchId,
      runId: args.runId,
      taskId: args.taskId,
      attemptId: args.attemptId,
      terminalHandle: args.terminalHandle,
      paneKey: args.terminalAuthority.paneKey,
      ptyIncarnation: args.terminalAuthority.processIncarnation,
      processRootId: args.terminal.ptyId ?? null,
      executionHostId: managedCliContext.executionHostId,
      workspaceKey: managedCliContext.workspaceKey,
      hostScope,
      predecessorOwnerPrincipal: predecessorLease.ownerPrincipal,
      successorOwnerPrincipal: `dispatch:${args.dispatchId}`,
      coordinatorGeneration: args.coordinatorGeneration,
      title: args.leaseTitle,
      launchProfile: args.launchProfile,
      retentionPolicy: predecessorLease.retentionPolicy,
      spawnedBy: leaseParams.spawnedBy
    })
    args.onLeaseTransfer(transferReceipt)
    workerLease = db.getMaestroTerminalLease(transferReceipt.successorLeaseId)
  } else {
    workerLease = db.reserveMaestroTerminalLease(leaseParams)
    db.attachMaestroTerminalLease({
      leaseId: workerLease.id,
      terminalHandle: args.terminalHandle,
      tabId,
      paneKey: args.terminalAuthority.paneKey,
      ptyIncarnation: args.terminalAuthority.processIncarnation,
      processRootId: args.terminal.ptyId ?? null,
      executionHostId: managedCliContext.executionHostId,
      workspaceKey: managedCliContext.workspaceKey,
      workerTerminalResourceId: resource?.id ?? null
    })
    db.transitionMaestroTerminalLease({ leaseId: workerLease.id, state: 'ready' })
  }
  if (!workerLease) {
    throw new OrchestrationError(
      'lease_identity_conflict',
      'Worker terminal lease transfer did not create one successor owner.'
    )
  }
  const preamble = buildDispatchPreamble({
    canDispatchSubWorkers: args.canDispatchSubWorkers,
    taskId: args.taskId,
    dispatchId: args.dispatchId,
    taskSpec: args.taskSpec,
    coordinatorHandle: args.coordinatorHandle,
    workerHandle: args.terminalHandle,
    dispatchCapability: args.capability,
    devMode: args.devMode,
    cliCommand: runtime.getTerminalOrchestrationCliCommand(args.terminalHandle),
    managedCliContext,
    requiresManagedCliContext: true
  })
  const commandId = `dispatch:${args.dispatchId}:preamble`
  const inputAcceptance = db.acceptMaestroTerminalInput({
    commandId,
    idempotencyKey: commandId,
    contentDigest: `sha256:${createHash('sha256').update(preamble).digest('hex')}`,
    enqueueSequence: 1,
    sender: {
      principalId: `coordinator:${args.coordinatorHandle}`,
      authority: 'coordinator',
      runId: args.runId,
      coordinatorGeneration: args.coordinatorGeneration
    },
    leaseId: workerLease.id,
    executionHostId: managedCliContext.executionHostId,
    workspaceKey: managedCliContext.workspaceKey,
    terminalHandle: args.terminalHandle,
    tabId,
    ptyIncarnation: args.terminalAuthority.processIncarnation,
    expectedLifecycleState: workerLease.lifecycleState === 'active' ? 'active' : 'ready',
    observedInputSurface: 'ready_prompt',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expectedGraphRevision: null
  })
  if (inputAcceptance.replayed && inputAcceptance.receipt.state === 'accepted') {
    db.transitionMaestroTerminalInput({
      commandId: inputAcceptance.receipt.commandId,
      state: 'delivery_unknown',
      rejectionCode: 'delivery_interrupted_before_receipt'
    })
    throw new Error('worker_preamble_delivery_unknown')
  }
  if (!inputAcceptance.replayed) {
    const send = await runtime.sendTerminalAgentPrompt(args.terminalHandle, preamble)
    db.transitionMaestroTerminalInput({
      commandId: inputAcceptance.receipt.commandId,
      state: send.accepted ? 'written_to_pty' : 'delivery_unknown',
      bytesWritten: send.bytesWritten,
      enterWritten: send.accepted
    })
    if (!send.accepted) {
      throw new Error('dispatch_input_delivery_unknown')
    }
  } else if (!['written_to_pty', 'acknowledged'].includes(inputAcceptance.receipt.state)) {
    throw new Error(`worker_preamble_${inputAcceptance.receipt.state}`)
  }
  db.transitionMaestroTerminalLease({ leaseId: workerLease.id, state: 'active' })
  args.effects.push({
    kind: 'dispatch_input',
    role: 'agent',
    id: args.terminalHandle,
    state: 'accepted'
  })
  return { workerLease, transferReceipt }
}

type DiagnosticRedactionRule = {
  pattern: RegExp
  // Why: String.replace passes the numeric match offset as the 2nd callback
  // arg whenever a pattern has NO capture group — truthiness-checking that
  // arg (as an earlier draft of this function did) redacts to "37[redacted]"
  // instead of "[redacted]". Each rule declares its own replacement shape so
  // there is never an ambiguous positional argument to misread.
  replace: (match: string) => string
}

// Why: a raw error message can carry a bearer token, credential-file content,
// or an embedded API key from a failed remote command; a worker-start
// diagnostic is stored durably and shown to any coordinator, so it must never
// leak one. Order matters — the k=v pattern must run first so a token also
// matching a later blob pattern is already replaced.
const SECRET_DIAGNOSTIC_RULES: readonly DiagnosticRedactionRule[] = [
  {
    pattern:
      /\b[A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|credential)[A-Za-z0-9_-]*\s*[:=]\s*\S+/gi,
    replace: (match) => {
      const keyPrefix = match.match(/^(\S+?\s*[:=]\s*)/)?.[1] ?? ''
      return `${keyPrefix}[redacted]`
    }
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]+/gi, replace: () => 'Bearer [redacted]' },
  { pattern: /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}\b/g, replace: () => '[redacted]' },
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replace: () => '[redacted]' }
]

const DIAGNOSTIC_MAX_LENGTH = 2000

/**
 * Bounds and redacts a raw failure message for durable storage. Never emits
 * secrets or unbounded text. Naturally idempotent: an already-redacted
 * "[redacted]"/truncation marker matches none of the secret patterns and is
 * already under the length bound, so relaying an already-sanitized message
 * from a federated peer through this again is a no-op. The stage itself is
 * carried on the separate `failedStage`/`stage` receipt fields already
 * returned alongside this — it is not re-encoded into the message text.
 */
export function boundedRedactedDiagnostic(rawMessage: string): string {
  let redacted = rawMessage
  for (const rule of SECRET_DIAGNOSTIC_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replace)
  }
  return redacted.length > DIAGNOSTIC_MAX_LENGTH
    ? `${redacted.slice(0, DIAGNOSTIC_MAX_LENGTH)}… [truncated ${redacted.length - DIAGNOSTIC_MAX_LENGTH} chars]`
    : redacted
}

export function failWorkerStartWithReceipt(args: {
  db: OrchestrationDb
  runId: string
  taskId: string
  dispatchId: string
  failedStage: string
  error: unknown
  setup: WorkerSetupReceipt
  launch: OrchestrationWorkerLaunchReceipt
}): unknown {
  const rawReason = args.error instanceof Error ? args.error.message : String(args.error)
  const reason = boundedRedactedDiagnostic(rawReason)
  const unknown = isUnknownWorkerStartOutcome(args.error, args.failedStage)
  const worker = unknown
    ? args.db.markWorkerStartUnknown(args.dispatchId, args.failedStage, reason)
    : args.db.failWorkerStart(args.dispatchId, args.failedStage, reason, {
        // Why (#16095): the preamble is written before submission is verified, so a stalled
        // verdict never means the worker lacks its task — keep the authority its report needs.
        retainCapability: isAgentPromptStalledError(args.error)
      })
  return {
    runId: args.runId,
    taskId: args.taskId,
    dispatchId: args.dispatchId,
    state: worker.state === 'start_unknown' ? 'outcome_unknown' : worker.state,
    stage: worker.stage,
    failedStage: args.failedStage,
    lastError: reason,
    setup: args.setup,
    launch: args.launch,
    effects: JSON.parse(worker.effects) as unknown[],
    residualResources: JSON.parse(worker.residual_resources) as unknown[],
    ...(unknown
      ? {
          nextCommands: [
            `orca orchestration worker-show --dispatch ${args.dispatchId} --json`,
            `orca orchestration worker-abandon --dispatch ${args.dispatchId} --json`
          ]
        }
      : {})
  }
}
