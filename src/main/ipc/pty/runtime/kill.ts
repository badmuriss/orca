import type { IPtyProvider } from '../../../providers/types'
import { SSH_PROVIDER_UNREGISTERED_REASON } from '../../../../shared/pty-liveness-verdict'
import { parseAppSshPtyId } from '../../../providers/ssh-pty-id'
import { ptyOwnership, ptyIncarnationById } from '../provider/ownership-state'
import { getProvider, getProviderForPty } from '../provider/registry'
import { isPtyAlreadyGoneError, delay } from '../provider/liveness'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import type { PtyStopReceipt } from '../../../../shared/pty-stop-receipt'

export function killPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string
): boolean {
  const {
    runtime,
    store,
    getLocalPtyProviderStartupPromise,
    shutdownProviderAndDetectExit,
    rememberSyntheticKillExit,
    sendPtyExitToRenderer,
    finishPtyShutdown,
    retiredRejectedPtyIds
  } = deps
  runtime?.markPtyStopRequested?.(ptyId)
  let connectionId: string | null | undefined = ptyOwnership.get(ptyId)
  const parsedSshId = connectionId === undefined ? parseAppSshPtyId(ptyId) : null
  connectionId ??= parsedSshId?.connectionId
  const killWithCurrentProvider = (): boolean => {
    let provider: IPtyProvider
    try {
      provider = connectionId ? getProvider(connectionId) : getProviderForPty(ptyId)
    } catch {
      if (connectionId) {
        // Why: runtime/CLI close can target a detached SSH PTY after its
        // provider was unregistered. Tombstone the lease so reconnect does
        // not revive a terminal the user explicitly closed.
        const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
        runtime?.onPtyExit(ptyId, -1, incarnationId)
        rememberSyntheticKillExit(ptyId)
        sendPtyExitToRenderer({
          id: ptyId,
          code: -1,
          ...(incarnationId ? { incarnationId } : {})
        })
        runtime?.markPtyLivenessUnverifiable?.(ptyId, SSH_PROVIDER_UNREGISTERED_REASON)
        return false
      }
      return false
    }
    // Why: controller is synchronous, but keep ownership until the execution owner proves exit.
    void shutdownProviderAndDetectExit(provider, ptyId, { immediate: false })
      .then(({ receipt, providerExitObserved }) => {
        if (receipt.verdict !== 'exited' || !receipt.processTreeVerified) {
          if (receipt.verdict === 'live') {
            runtime?.markPtyLivenessLive?.(ptyId)
          } else {
            runtime?.markPtyLivenessUnverifiable?.(ptyId, receipt.reason)
          }
          return
        }
        const retired = retiredRejectedPtyIds.has(ptyId)
        const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
        if (!providerExitObserved && !retired) {
          runtime?.onPtyExit(ptyId, 0, incarnationId)
          rememberSyntheticKillExit(ptyId)
          sendPtyExitToRenderer({
            id: ptyId,
            code: 0,
            ...(incarnationId ? { incarnationId } : {})
          })
        }
      })
      .catch((err) => {
        const retired = retiredRejectedPtyIds.has(ptyId)
        if (isPtyAlreadyGoneError(err)) {
          const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
          if (!retired) {
            runtime?.markPtyLivenessUnverifiable?.(
              ptyId,
              'The execution owner returned no process-tree stop receipt.'
            )
            runtime?.onPtyExit(ptyId, -1, incarnationId)
            rememberSyntheticKillExit(ptyId)
            sendPtyExitToRenderer({
              id: ptyId,
              code: -1,
              ...(incarnationId ? { incarnationId } : {})
            })
          }
          return
        }
        console.warn(
          `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
        )
        if (!retired && connectionId) {
          runtime?.markPtyLivenessUnverifiable?.(
            ptyId,
            err instanceof Error ? err.message : String(err)
          )
        }
      })
    return true
  }
  const startupPromise = getLocalPtyProviderStartupPromise(connectionId)
  if (startupPromise) {
    // Why: select the provider after the daemon swap; the fallback first can report success while orphaning a daemon PTY.
    void startupPromise.then(killWithCurrentProvider).catch((err) => {
      console.warn(
        `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
      )
      if (!retiredRejectedPtyIds.has(ptyId)) {
        if (connectionId) {
          runtime?.markPtyLivenessUnverifiable?.(
            ptyId,
            err instanceof Error ? err.message : String(err)
          )
        }
        runtime?.onPtyExit(ptyId, -1, ptyIncarnationById.get(ptyId))
      }
    })
    return true
  }
  return killWithCurrentProvider()
}

export function retireRejectedPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string,
  stopConfirmed: boolean
): void {
  const {
    runtime,
    store,
    rememberRetiredRejectedPty,
    rememberSyntheticKillExit,
    sendPtyExitToRenderer,
    finishPtyShutdown
  } = deps
  rememberRetiredRejectedPty(ptyId)
  if (!stopConfirmed) {
    runtime?.markPtyLivenessUnverifiable?.(
      ptyId,
      'a follow-up stop was issued but its outcome could not be verified'
    )
    if (!ptyOwnership.has(ptyId)) {
      return
    }
    runtime?.onPtyExit(ptyId, -1, ptyIncarnationById.get(ptyId))
    rememberSyntheticKillExit(ptyId)
    sendPtyExitToRenderer({
      id: ptyId,
      code: -1,
      ...(ptyIncarnationById.get(ptyId) ? { incarnationId: ptyIncarnationById.get(ptyId) } : {})
    })
    return
  }
  // Why: a completed stop already cleared provider state, tombstoned the lease and told the
  // renderer; repeating that double-fires the exit IPC. The runtime still needs code 0 so an
  // SSH pane retires for good instead of staying preserved by the stop's negative exit.
  if (!ptyOwnership.has(ptyId)) {
    runtime?.onPtyExit(ptyId, 0, ptyIncarnationById.get(ptyId))
    return
  }
  let connectionId: string | null | undefined = ptyOwnership.get(ptyId)
  const parsedSshId = connectionId === undefined ? parseAppSshPtyId(ptyId) : null
  connectionId ??= parsedSshId?.connectionId
  const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
  runtime?.onPtyExit(ptyId, 0, incarnationId)
  rememberSyntheticKillExit(ptyId)
  sendPtyExitToRenderer({
    id: ptyId,
    code: 0,
    ...(incarnationId ? { incarnationId } : {})
  })
}

export function markReversibleStopsFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyIds: readonly string[]
): () => void {
  const { reversibleStopOwnersByPtyId } = deps
  for (const ptyId of ptyIds) {
    reversibleStopOwnersByPtyId.set(ptyId, (reversibleStopOwnersByPtyId.get(ptyId) ?? 0) + 1)
  }
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    for (const ptyId of ptyIds) {
      const owners = (reversibleStopOwnersByPtyId.get(ptyId) ?? 0) - 1
      if (owners > 0) {
        reversibleStopOwnersByPtyId.set(ptyId, owners)
      } else {
        reversibleStopOwnersByPtyId.delete(ptyId)
      }
    }
  }
}

export async function stopAndWaitPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  ptyId: string,
  opts?: { keepHistory?: boolean; deadlineMs?: number }
): Promise<PtyStopReceipt | null> {
  const {
    runtime,
    store,
    getLocalPtyProviderStartupPromise,
    shutdownProviderAndDetectExit,
    rememberSyntheticKillExit,
    sendPtyExitToRenderer,
    finishPtyShutdown
  } = deps
  runtime?.markPtyStopRequested?.(ptyId)
  let connectionId: string | null | undefined = ptyOwnership.get(ptyId)
  const parsedSshId = connectionId === undefined ? parseAppSshPtyId(ptyId) : null
  connectionId ??= parsedSshId?.connectionId
  // Why: destructive teardown threads one absolute deadline through every await
  // below; each RPC leaf converts it to the remaining time when it issues, so
  // sequential RPCs share the budget and cannot overrun the sweep deadline.
  const deadlineMs = opts?.deadlineMs
  const startupPromise = getLocalPtyProviderStartupPromise(connectionId)
  if (startupPromise) {
    // Why: exact-stop must resolve the provider after daemon startup just
    // like renderer kills, or the fallback can falsely confirm teardown.
    if (deadlineMs !== undefined) {
      // Why: bound the cold-start await by the teardown deadline instead of the
      // 60s startup fail-open cap; fail closed so the sweep records the miss.
      const won = await Promise.race([
        // Why: () => false on rejection both fails closed on a startup error and
        // keeps the losing branch's rejection from surfacing as unhandled.
        startupPromise.then(
          () => true,
          () => false
        ),
        delay(Math.max(1, deadlineMs - Date.now())).then(() => false)
      ])
      if (!won) {
        return null
      }
    } else {
      await startupPromise
    }
  }
  let provider: IPtyProvider
  try {
    provider = connectionId ? getProvider(connectionId) : getProviderForPty(ptyId)
  } catch {
    if (connectionId) {
      // Why: an absent SSH provider means there is no live target left to
      // await, but the relay lease must still be tombstoned.
      const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
      runtime?.onPtyExit(ptyId, -1, incarnationId)
      rememberSyntheticKillExit(ptyId)
      sendPtyExitToRenderer({
        id: ptyId,
        code: -1,
        ...(incarnationId ? { incarnationId } : {})
      })
      runtime?.markPtyLivenessUnverifiable?.(ptyId, SSH_PROVIDER_UNREGISTERED_REASON)
    }
    return null
  }
  let receipt: PtyStopReceipt
  let providerExitObserved = false
  try {
    const stopResult = await shutdownProviderAndDetectExit(provider, ptyId, {
      immediate: true,
      keepHistory: opts?.keepHistory ?? false,
      deadlineMs
    })
    receipt = stopResult.receipt
    providerExitObserved = stopResult.providerExitObserved
  } catch (err) {
    if (!isPtyAlreadyGoneError(err)) {
      if (connectionId) {
        runtime?.markPtyLivenessUnverifiable?.(
          ptyId,
          err instanceof Error ? err.message : String(err)
        )
      }
      console.warn(
        `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
    return null
  }
  if (receipt.verdict === 'live') {
    runtime?.markPtyLivenessLive?.(ptyId)
    return receipt
  }
  if (receipt.verdict !== 'exited' || !receipt.processTreeVerified) {
    runtime?.markPtyLivenessUnverifiable?.(ptyId, receipt.reason)
    return receipt
  }
  const incarnationId = finishPtyShutdown(ptyId, connectionId, store)
  if (!providerExitObserved) {
    runtime?.onPtyExit(ptyId, 0, incarnationId)
    rememberSyntheticKillExit(ptyId)
    sendPtyExitToRenderer({
      id: ptyId,
      code: 0,
      ...(incarnationId ? { incarnationId } : {})
    })
  }
  return receipt
}
