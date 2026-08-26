import type { OrcaRuntimeService } from '../orca-runtime'
import {
  archiveSummary,
  completeWorkerTerminalRelease
} from '../rpc/methods/orchestration-worker-release-completion'
import { inspectWorkerTerminal } from '../rpc/methods/orchestration-worker-observation'
import type { WorkerReleaseReceipt } from '../rpc/methods/orchestration-worker-release-completion'
import type { WorkerTerminalResourceRow } from './worker-terminal-ownership'
import { workerTerminalLeaseIsCurrent } from './db/worker-terminal/worker-terminal-release-identity'

export type WorkerTerminalReleaseReconciliationResult = {
  attempted: number
  released: number
  pending: number
  unknown: number
  retained: number
}

type ActiveReconciliation = {
  rerunRequested: boolean
  promise?: Promise<WorkerTerminalReleaseReconciliationResult>
}

const activeReconciliationByRuntime = new WeakMap<OrcaRuntimeService, ActiveReconciliation>()

export async function autoReleaseSettledWorkerTerminal(args: {
  runtime: OrcaRuntimeService
  db: ReturnType<OrcaRuntimeService['getOrchestrationDb']>
  dispatchId: string
}): Promise<WorkerReleaseReceipt | null> {
  const { runtime, db, dispatchId } = args
  const worker = db.getWorkerDispatch(dispatchId)
  const resource = db.getWorkerTerminalResourceByOwner(dispatchId)
  if (
    db.getFederatedDispatch(dispatchId) ||
    !worker ||
    !resource ||
    !['succeeded', 'failed'].includes(worker.state) ||
    resource.ownership_state !== 'owned' ||
    resource.release_state !== 'not_requested' ||
    !workspaceHasExclusiveWorkerOwnership(db, resource)
  ) {
    return null
  }
  const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
  if (observation.agentWait || observation.status === 'unverifiable') {
    return null
  }
  if (observation.status === 'exited') {
    const settled = db.settleDeadWorkerTerminalRelease({
      requestingDispatchId: dispatchId,
      resourceId: resource.id,
      processIncarnation: resource.process_incarnation ?? ''
    })
    if (settled.disposition !== 'released') {
      return null
    }
    runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
    return {
      dispatchId,
      state: 'released',
      processAction: 'closed_exited_terminal',
      archive: archiveSummary(settled.resource)
    }
  }
  if (
    observation.status !== 'live' ||
    !workerTerminalLeaseIsCurrent(runtime, db, dispatchId, resource)
  ) {
    return null
  }
  const requested = db.requestWorkerTerminalRelease(dispatchId, { auto: true })
  return requested.disposition === 'requested'
    ? completeWorkerTerminalRelease({ runtime, db, dispatchId, resource: requested.resource })
    : null
}

// Finishes ONLY previously requested releases after startup/reconnect terminal discovery.
// It never invents release intent: resources outside requested/releasing are untouched, and
// unresolved identity defers (release_pending) rather than settling or broadening the close.
export function reconcileRequestedWorkerTerminalReleases(
  runtime: OrcaRuntimeService
): Promise<WorkerTerminalReleaseReconciliationResult> {
  const active = activeReconciliationByRuntime.get(runtime)
  if (active?.promise) {
    active.rerunRequested = true
    return active.promise
  }
  const state: ActiveReconciliation = { rerunRequested: false }
  const reconciliation = runReconciliationPasses(runtime, state).finally(() => {
    if (activeReconciliationByRuntime.get(runtime) === state) {
      activeReconciliationByRuntime.delete(runtime)
    }
  })
  state.promise = reconciliation
  activeReconciliationByRuntime.set(runtime, state)
  return reconciliation
}

async function runReconciliationPasses(
  runtime: OrcaRuntimeService,
  state: ActiveReconciliation
): Promise<WorkerTerminalReleaseReconciliationResult> {
  const combined = emptyResult()
  do {
    state.rerunRequested = false
    const pass = await reconcileRequestedWorkerTerminalReleasesOnce(runtime)
    combined.attempted += pass.attempted
    combined.released += pass.released
    combined.pending += pass.pending
    combined.unknown += pass.unknown
    combined.retained += pass.retained
  } while (state.rerunRequested)
  if (combined.attempted > 0) {
    // Structured counts only; never transcript content or paths.
    console.info('[orchestration] worker terminal release reconciliation', combined)
  }
  return combined
}

async function reconcileRequestedWorkerTerminalReleasesOnce(
  runtime: OrcaRuntimeService
): Promise<WorkerTerminalReleaseReconciliationResult> {
  const db = runtime.getOrchestrationDb()
  const backlog = db.listWorkerTerminalReleaseBacklog()
  const result = { ...emptyResult(), attempted: backlog.length }
  for (const resource of backlog) {
    try {
      const receipt = await completeWorkerTerminalRelease({
        runtime,
        db,
        dispatchId: resource.owner_dispatch_id,
        resource,
        mode: 'recovery'
      })
      if (receipt.state === 'released' || receipt.state === 'already_released') {
        result.released += 1
      } else if (receipt.state === 'release_pending') {
        result.pending += 1
      } else if (receipt.state === 'release_unknown') {
        result.unknown += 1
      } else {
        result.retained += 1
      }
    } catch (error) {
      // Archive or endpoint failure: durable intent stays requested; a later discovery retries.
      console.warn('[orchestration] worker terminal release retry failed', {
        resourceId: resource.id,
        dispatchId: resource.owner_dispatch_id,
        error: error instanceof Error ? error.message : String(error)
      })
      result.pending += 1
    }
  }
  const reclaimable = db
    .listWorkerTerminalResources()
    .filter((worker) => worker.terminalState === 'reclaimable')
  for (const worker of reclaimable) {
    try {
      const receipt = await autoReleaseSettledWorkerTerminal({
        runtime,
        db,
        dispatchId: worker.dispatchId
      })
      if (!receipt) {
        continue
      }
      result.attempted += 1
      if (receipt.state === 'released' || receipt.state === 'already_absent') {
        result.released += 1
      } else if (receipt.state === 'release_pending') {
        result.pending += 1
      } else if (receipt.state === 'release_unknown') {
        result.unknown += 1
      } else {
        result.retained += 1
      }
    } catch (error) {
      console.warn('[orchestration] worker terminal auto-release failed', {
        dispatchId: worker.dispatchId,
        error: error instanceof Error ? error.message : String(error)
      })
      result.pending += 1
    }
  }
  return result
}

function emptyResult(): WorkerTerminalReleaseReconciliationResult {
  return { attempted: 0, released: 0, pending: 0, unknown: 0, retained: 0 }
}

function workspaceHasExclusiveWorkerOwnership(
  db: ReturnType<OrcaRuntimeService['getOrchestrationDb']>,
  resource: WorkerTerminalResourceRow
): boolean {
  return (
    Boolean(resource.worktree_id) &&
    !db
      .listWorkerTerminalResources()
      .some(
        (candidate) =>
          candidate.resource?.id !== resource.id &&
          candidate.resource?.worktree_id === resource.worktree_id &&
          candidate.resource?.release_state !== 'released'
      )
  )
}
