import { createHash } from 'node:crypto'
import { InvalidArgumentError, defineMethod, type RpcAnyMethod } from '../../core'
import { isTerminalQueryReply } from '../../../../../shared/terminal-query-reply'
import { assertTerminalAgentSendable } from '../../terminal-agent-send-guard'
import { TerminalSend } from './unary-schemas'
import {
  assertTerminalSendExactPtyBinding,
  assertTerminalSendTextWithinLimit,
  commitMobileInputFloorClaim,
  getTerminalSendGuardRefusedReason,
  isTerminalInputLockedForClient,
  isTerminalSendGuardNotWritable,
  resolveMobileFloorClientId,
  type MobileInputFloorClaimHolder
} from './terminal-input-delivery'
import { updateViewportForClient } from './terminal-viewport-update'

export const TERMINAL_SEND_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'terminal.send',
    params: TerminalSend,
    handler: async (
      params,
      {
        runtime,
        clientId,
        signal,
        authenticatedCallerFingerprint,
        orchestrationMutation,
        orchestrationCompatibilityCallerAuthority,
        orchestrationCompatibilityEvidence
      }
    ) => {
      await assertTerminalSendTextWithinLimit(params.text)
      await assertTerminalSendTextWithinLimit(params.resolvedLaunchDraft?.text)
      const queryReplyClientId = clientId ?? params.client?.id
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
      if (
        params.inputKind === 'query-reply' &&
        (!params.text ||
          !isTerminalQueryReply(params.text) ||
          params.enter === true ||
          params.interrupt === true ||
          params.agentPrompt === true ||
          params.requireAgentStatus !== undefined ||
          params.client?.type !== 'mobile' ||
          !queryReplyClientId ||
          (clientId !== undefined && params.client.id !== clientId))
      ) {
        throw new InvalidArgumentError('Invalid terminal query reply')
      }
      // Why: a stale handle must fail with terminal_handle_stale, not evaluate driver/lock state against the wrong PTY (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      const driver = leaf?.ptyId ? runtime.getDriver(leaf.ptyId) : null
      if (
        params.inputKind === 'query-reply' &&
        leaf?.ptyId &&
        !runtime.isMobileTerminalQueryReplyAuthority(leaf.ptyId, queryReplyClientId!)
      ) {
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      if (leaf?.ptyId && isTerminalInputLockedForClient(runtime, leaf.ptyId, params.client)) {
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      if (
        leaf?.ptyId &&
        params.client?.type === 'desktop' &&
        params.claimViewport === true &&
        params.viewport
      ) {
        const claim = await updateViewportForClient(
          runtime,
          leaf.ptyId,
          `send:${params.client.id}`,
          params.client,
          params.viewport,
          'desktop',
          'refresh',
          true
        )
        // Why: a stream-less request can't safely create ownership, so never write at stale geometry.
        if (!claim.updated || isTerminalInputLockedForClient(runtime, leaf.ptyId, params.client)) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0
            }
          }
        }
      }
      const hasText = typeof params.text === 'string' && params.text.length > 0
      const hasSuffix = params.enter === true || params.interrupt === true
      if (params.requireAgentStatus === 'sendable' && hasText && hasSuffix) {
        // Why: guarded sends are two-phase; reject combined payload + submit so a guard flip can't cause partial delivery.
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      // Why: recheck permission/no-agent state immediately before accepting the PTY write.
      const assertSendPreconditions =
        params.requireAgentStatus === 'sendable'
          ? async (ptyId?: string): Promise<void> => {
              await assertTerminalAgentSendable({
                runtime,
                handle: params.terminal,
                assertWritable: () => {
                  assertTerminalSendExactPtyBinding(runtime, params.terminal, ptyId)
                  if (ptyId && isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
                    throw new Error('terminal_guard_not_writable')
                  }
                }
              })
            }
          : undefined
      if (params.requireAgentStatus === 'sendable') {
        try {
          await assertSendPreconditions?.(leaf?.ptyId ?? undefined)
        } catch (error) {
          if (isTerminalSendGuardNotWritable(error)) {
            return {
              send: {
                handle: params.terminal,
                accepted: false,
                bytesWritten: 0
              }
            }
          }
          const refusedReason = getTerminalSendGuardRefusedReason(error)
          if (!refusedReason) {
            throw error
          }
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0,
              refusedReason
            }
          }
        }
      }
      const mobileFloorClientId = resolveMobileFloorClientId(driver, params.client)
      const mobileFloorClaim: MobileInputFloorClaimHolder = { current: null }
      const beforeWrite = assertSendPreconditions
      const useSettledAgentPrompt =
        params.agentPrompt === true &&
        hasText &&
        params.enter === true &&
        params.interrupt !== true &&
        params.client?.type === 'desktop' &&
        (await runtime.isTerminalRunningSettledPromptAgent(params.terminal))
      const reserveWrite =
        params.inputKind !== 'query-reply' && leaf?.ptyId && mobileFloorClientId
          ? (ptyId: string): void => {
              const claim = runtime.beginMobileInputFloor(ptyId, mobileFloorClientId)
              if (!claim) {
                throw new Error('mobile_input_floor_unavailable')
              }
              mobileFloorClaim.current = claim
            }
          : undefined
      let result
      try {
        result = useSettledAgentPrompt
          ? await runtime.sendTerminalAgentPrompt(params.terminal, params.text!, {
              beforeWrite,
              signal
            })
          : await runtime.sendTerminal(
              params.terminal,
              {
                text: params.text,
                enter: params.enter === true,
                interrupt: params.interrupt === true
              },
              {
                beforeWrite,
                signal,
                ...(reserveWrite ? { reserveWrite } : {}),
                ...(params.inputKind !== 'query-reply' && mobileFloorClientId
                  ? { afterWrite: () => commitMobileInputFloorClaim(mobileFloorClaim) }
                  : {})
              }
            )
      } catch (error) {
        mobileFloorClaim.current?.rollback()
        if (durableInputCommandId) {
          db.transitionMaestroTerminalInput({
            commandId: durableInputCommandId,
            state: 'delivery_unknown'
          })
        }
        const refusedReason = getTerminalSendGuardRefusedReason(error)
        if (refusedReason) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0,
              refusedReason
            }
          }
        }
        if (isTerminalSendGuardNotWritable(error)) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0
            }
          }
        }
        throw error
      }
      if (result.accepted !== true) {
        mobileFloorClaim.current?.rollback()
      }
      const deliveryReceipt = durableInputCommandId
        ? db.transitionMaestroTerminalInput({
            commandId: durableInputCommandId,
            state: result.accepted ? 'written_to_pty' : 'delivery_unknown',
            bytesWritten: result.bytesWritten,
            enterWritten: result.accepted && params.enter === true
          })
        : undefined
      if (
        result.accepted === true &&
        params.enter === true &&
        params.client?.type === 'mobile' &&
        params.resolvedLaunchDraft
      ) {
        runtime.notifyNativeChatLaunchDraftResolved(params.terminal, params.resolvedLaunchDraft)
      }
      // Why: deliberate mobile input takes the floor (drives `* → mobile{clientId}`); clientless sends fall back to the current mobile driver.
      return { send: { ...result, ...(deliveryReceipt ? { deliveryReceipt } : {}) } }
    }
  })
]
