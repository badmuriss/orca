import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from './orchestration-error'
import {
  recordRemoteAttachmentReleaseStage,
  REMOTE_ATTACHMENT_RELEASE_STAGES
} from './db/federation/remote-dispatch-attachment-release'

export type FederatedLifecycleSettlement =
  | { action: 'completed' | 'failed'; authority: 'run_home' }
  | { action: 'rejected'; code: string; reason: string; authority: 'run_home' }

export function areFederatedLifecycleSettlementsEqual(
  left: FederatedLifecycleSettlement,
  right: FederatedLifecycleSettlement
): boolean {
  return (
    left.action === right.action &&
    (left.action !== 'rejected' ||
      (right.action === 'rejected' && left.code === right.code && left.reason === right.reason))
  )
}

type Waiter = (settlement: FederatedLifecycleSettlement) => void

const waitersByRuntime = new WeakMap<OrcaRuntimeService, Map<string, Set<Waiter>>>()
const activeReleasesByRuntime = new WeakMap<
  OrcaRuntimeService,
  Map<string, Promise<FederatedReleaseReceipt>>
>()

export type FederatedReleaseReceipt = {
  state: 'released' | 'already_released' | 'retained' | 'unverifiable'
  reason?: 'identity_unproven'
  processAction: 'closed_agent_terminal' | 'none'
  lastError?: string
  recovery?: string
}

export function publishFederatedLifecycleSettlement(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  sequence: number,
  settlement: FederatedLifecycleSettlement
): void {
  const waiters = waitersByRuntime.get(runtime)?.get(settlementKey(dispatchId, sequence))
  for (const waiter of waiters ?? []) {
    waiter(settlement)
  }
}

export function waitForFederatedLifecycleSettlement(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  sequence: number,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<FederatedLifecycleSettlement | undefined> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve(undefined)
      return
    }
    const runtimeWaiters = getRuntimeWaiters(runtime)
    const key = settlementKey(dispatchId, sequence)
    const waiters = runtimeWaiters.get(key) ?? new Set<Waiter>()
    runtimeWaiters.set(key, waiters)
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (settlement?: FederatedLifecycleSettlement) => {
      if (timer) {
        clearTimeout(timer)
      }
      options.signal?.removeEventListener('abort', onAbort)
      waiters.delete(onSettlement)
      if (waiters.size === 0) {
        runtimeWaiters.delete(key)
      }
      resolve(settlement)
    }
    const onSettlement: Waiter = (settlement) => finish(settlement)
    const onAbort = () => finish()
    waiters.add(onSettlement)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(), options.timeoutMs)
  })
}

export function releaseFederatedAttachment(
  runtime: OrcaRuntimeService,
  dispatchId: string
): Promise<FederatedReleaseReceipt> {
  let active = activeReleasesByRuntime.get(runtime)
  if (!active) {
    active = new Map()
    activeReleasesByRuntime.set(runtime, active)
  }
  const existing = active.get(dispatchId)
  if (existing) {
    return existing
  }
  const release = releaseFederatedAttachmentOnce(runtime, dispatchId).finally(() => {
    if (active?.get(dispatchId) === release) {
      active.delete(dispatchId)
    }
  })
  active.set(dispatchId, release)
  return release
}

async function releaseFederatedAttachmentOnce(
  runtime: OrcaRuntimeService,
  dispatchId: string
): Promise<FederatedReleaseReceipt> {
  const db = runtime.getOrchestrationDb()
  const attachment = db.getRemoteDispatchAttachment(dispatchId)
  if (!attachment) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Remote Dispatch ${dispatchId} was not found.`
    )
  }
  if (attachment.stage === REMOTE_ATTACHMENT_RELEASE_STAGES.completed) {
    return { state: 'already_released', processAction: 'none' }
  }
  if (!['succeeded', 'failed', 'stopped', 'abandoned'].includes(attachment.state)) {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Remote Dispatch ${dispatchId} is not settled.`
    )
  }
  if (!attachment.terminal_handle || !attachment.pane_key || !attachment.process_incarnation) {
    return { state: 'retained', reason: 'identity_unproven', processAction: 'none' }
  }
  const terminal = await runtime.showTerminal(attachment.terminal_handle).catch(() => null)
  if (!terminal) {
    return markRemoteReleaseUnverifiable(
      runtime,
      dispatchId,
      'The authoritative terminal inventory did not resolve the recorded worker process.'
    )
  }
  if (
    !db.isRemoteAttachmentProcessCurrent({
      dispatchId,
      paneKey: runtime.getTerminalPaneKey(attachment.terminal_handle),
      processIncarnation: runtime.getTerminalProcessIncarnation(attachment.terminal_handle)
    })
  ) {
    return { state: 'retained', reason: 'identity_unproven', processAction: 'none' }
  }
  const liveness = runtime.getTerminalLivenessVerdict?.(attachment.terminal_handle)
  if (liveness?.status === 'unverifiable') {
    return markRemoteReleaseUnverifiable(runtime, dispatchId, liveness.reason)
  }
  try {
    const close = await runtime.closeTerminal(attachment.terminal_handle)
    if (!close.ptyKilled) {
      return markRemoteReleaseUnverifiable(
        runtime,
        dispatchId,
        'The execution host closed the tab without confirming that the worker process stopped.'
      )
    }
  } catch (error) {
    return markRemoteReleaseUnverifiable(
      runtime,
      dispatchId,
      error instanceof Error ? error.message : String(error)
    )
  }
  recordRemoteAttachmentReleaseStage(db, {
    dispatchId,
    stage: REMOTE_ATTACHMENT_RELEASE_STAGES.completed,
    lastError: ''
  })
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return { state: 'released', processAction: 'closed_agent_terminal' }
}

function markRemoteReleaseUnverifiable(
  runtime: OrcaRuntimeService,
  dispatchId: string,
  reason: string
): FederatedReleaseReceipt {
  recordRemoteAttachmentReleaseStage(runtime.getOrchestrationDb(), {
    dispatchId,
    stage: REMOTE_ATTACHMENT_RELEASE_STAGES.pending,
    lastError: reason
  })
  return {
    state: 'unverifiable',
    processAction: 'none',
    lastError: reason,
    recovery: 'The execution host could not verify the worker release outcome.'
  }
}

function getRuntimeWaiters(runtime: OrcaRuntimeService): Map<string, Set<Waiter>> {
  const existing = waitersByRuntime.get(runtime)
  if (existing) {
    return existing
  }
  const created = new Map<string, Set<Waiter>>()
  waitersByRuntime.set(runtime, created)
  return created
}

function settlementKey(dispatchId: string, sequence: number): string {
  return `${dispatchId}:${sequence}`
}
