import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { InvalidArgumentError, type RpcContext } from '../../core'
import type { TerminalSend } from './unary-schemas'

export async function acceptManagedTerminalInput(
  params: z.infer<typeof TerminalSend>,
  context: RpcContext
) {
  const {
    runtime,
    clientId,
    authenticatedCallerFingerprint,
    orchestrationMutation,
    orchestrationCompatibilityCallerAuthority,
    orchestrationCompatibilityEvidence
  } = context
  const db = runtime.getOrchestrationDb()
  const managedLease = db.getMaestroTerminalLeaseByHandle(params.terminal)
  if (managedLease && !params.leaseInput) {
    throw new InvalidArgumentError(
      'An orchestration-owned terminal requires an authenticated lease input envelope.'
    )
  }
  let durableInputCommandId: string | null = null
  if (params.leaseInput) {
    if (!managedLease || managedLease.id !== params.leaseInput.leaseId) {
      throw new InvalidArgumentError('Lease input does not match this managed terminal.')
    }
    const contentDigest = `sha256:${createHash('sha256')
      .update(params.text ?? '')
      .digest('hex')}`
    if (contentDigest !== params.leaseInput.contentDigest) {
      throw new InvalidArgumentError('Lease input content digest mismatched.')
    }
    const terminal = await runtime.showTerminal(params.terminal)
    const agentStatus = await runtime.getTerminalAgentStatus(params.terminal)
    const observedInputSurface =
      agentStatus.status === 'working'
        ? 'working'
        : agentStatus.status === 'permission'
          ? 'permission'
          : terminal.agentWait
            ? 'input_required'
            : 'ready_prompt'
    if (observedInputSurface !== params.leaseInput.observedInputSurface) {
      throw new InvalidArgumentError(
        `Managed terminal input surface is ${observedInputSurface}, not ${params.leaseInput.observedInputSurface}.`
      )
    }
    const ptyIncarnation = runtime.getTerminalProcessIncarnation(params.terminal)
    if (!ptyIncarnation) {
      throw new InvalidArgumentError('Managed terminal incarnation is unavailable.')
    }
    const principalId =
      authenticatedCallerFingerprint ??
      orchestrationMutation?.callerFingerprint ??
      clientId ??
      'local-runtime'
    if (params.leaseInput.authority !== 'user') {
      const callerAuthority =
        orchestrationCompatibilityCallerAuthority ??
        runtime.verifyOrchestrationCompatibilityCaller(orchestrationCompatibilityEvidence, {
          currentRuntimeLaunchSufficient: true
        })
      if (!callerAuthority) {
        throw new InvalidArgumentError(
          'Managed terminal input authority requires an authenticated caller terminal.'
        )
      }
      if (params.leaseInput.authority === 'coordinator') {
        const run = db.getRun(params.leaseInput.runId)
        if (
          !run ||
          run.consumer_generation !== params.leaseInput.coordinatorGeneration ||
          run.coordinator_handle !== callerAuthority.terminalHandle ||
          run.coordinator_pane_key !== callerAuthority.paneKey
        ) {
          throw new InvalidArgumentError('Coordinator terminal input authority is stale.')
        }
      } else {
        const dispatch = db.getActiveDispatchForIdentity(
          callerAuthority.terminalHandle,
          callerAuthority.paneKey
        )
        if (!dispatch || dispatch.run_id !== params.leaseInput.runId) {
          throw new InvalidArgumentError('Worker terminal input authority is stale.')
        }
      }
    }
    const inputAcceptance = db.acceptMaestroTerminalInput({
      commandId: params.leaseInput.commandId,
      idempotencyKey: params.leaseInput.idempotencyKey,
      contentDigest,
      enqueueSequence: params.leaseInput.enqueueSequence,
      sender: {
        principalId,
        authority: params.leaseInput.authority,
        runId: params.leaseInput.runId,
        coordinatorGeneration: params.leaseInput.coordinatorGeneration
      },
      leaseId: managedLease.id,
      executionHostId: managedLease.executionHostId,
      workspaceKey: managedLease.workspaceKey,
      terminalHandle: managedLease.terminalHandle as string,
      tabId: terminal.tabId,
      ptyIncarnation,
      expectedLifecycleState: params.leaseInput.expectedLifecycleState,
      observedInputSurface,
      expiresAt: params.leaseInput.expiresAt,
      expectedGraphRevision: params.leaseInput.expectedGraphRevision
    })
    const accepted = inputAcceptance.receipt
    durableInputCommandId = accepted.commandId
    if (inputAcceptance.replayed && accepted.state === 'accepted') {
      const unknown = db.transitionMaestroTerminalInput({
        commandId: accepted.commandId,
        state: 'delivery_unknown',
        rejectionCode: 'delivery_interrupted_before_receipt'
      })
      return {
        send: {
          handle: params.terminal,
          accepted: false,
          bytesWritten: unknown.bytesWritten,
          deliveryReceipt: unknown
        }
      }
    }
    if (
      accepted.state === 'written_to_pty' ||
      accepted.state === 'acknowledged' ||
      accepted.state === 'rejected' ||
      accepted.state === 'superseded' ||
      accepted.state === 'delivery_unknown'
    ) {
      return {
        send: {
          handle: params.terminal,
          accepted: accepted.state === 'written_to_pty' || accepted.state === 'acknowledged',
          bytesWritten: accepted.bytesWritten,
          deliveryReceipt: accepted
        }
      }
    }
    if (
      observedInputSurface === 'working' ||
      observedInputSurface === 'permission' ||
      observedInputSurface === 'input_required'
    ) {
      const queued = db.transitionMaestroTerminalInput({
        commandId: accepted.commandId,
        state: 'queued'
      })
      return {
        send: {
          handle: params.terminal,
          accepted: true,
          bytesWritten: 0,
          deliveryReceipt: queued
        }
      }
    }
  }
  return { commandId: durableInputCommandId }
}
