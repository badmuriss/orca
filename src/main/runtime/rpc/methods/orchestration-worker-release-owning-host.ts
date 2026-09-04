import type { OrchestrationDb } from '../../orchestration/db'
import type {
  WorkerTerminalArchiveStatus,
  WorkerTerminalResourceRow,
  WorkerTerminalRetainedReason
} from '../../orchestration/worker-terminal-ownership'
import { settleWorkerTerminalTabNotFoundCloseRace } from '../../orchestration/db/worker-terminal/worker-terminal-close-race'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { describeUnconfirmedAgentStop } from '../../../../shared/pty-liveness-verdict'
import { archiveSummary } from './orchestration-worker-terminal-resource-view'
import { releaseUnknown } from './orchestration-worker-release-receipts'

export type WorkerReleaseReceipt = {
  dispatchId: string
  state:
    | 'released'
    | 'already_absent'
    | 'already_released'
    | 'retained'
    | 'release_pending'
    | 'release_unknown'
  reason?: WorkerTerminalRetainedReason
  processAction: 'closed_agent_terminal' | 'closed_exited_terminal' | 'none'
  processVerdict?: 'live' | 'unverifiable' | 'exited'
  archive: { source: string | null; status: string | null } | null
  recovery?: string
  lastError?: string
  closeResponse?: { error: 'tab_not_found'; message: string }
  inventoryResponse?: { state: 'absent' | 'still_present' | 'unverifiable' }
}

export async function reconcileMissingWorkerTerminalRelease(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  dispatchId: string
  resource: WorkerTerminalResourceRow
}): Promise<WorkerReleaseReceipt> {
  const { runtime, db, dispatchId, resource } = args
  const archive = db.getWorkerTerminalArchive(dispatchId)
  if (
    resource.release_state !== 'unknown' ||
    !resource.process_incarnation ||
    archive?.resource_id !== resource.id
  ) {
    return {
      ...releaseUnknown(
        db,
        dispatchId,
        resource,
        'The recorded terminal is missing; its process state is unverifiable.'
      ),
      processVerdict: 'unverifiable'
    }
  }
  const processVerdict = await inspectProcess(runtime, resource)
  if (processVerdict === 'exited') {
    const settled = db.settleDeadWorkerTerminalRelease({
      requestingDispatchId: dispatchId,
      resourceId: resource.id,
      processIncarnation: resource.process_incarnation
    })
    if (settled.disposition === 'released') {
      runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
      return {
        dispatchId,
        state: 'released',
        processAction: 'closed_exited_terminal',
        processVerdict,
        archive: archiveSummary(settled.resource)
      }
    }
  }
  const reason =
    processVerdict === 'live'
      ? 'The recorded terminal is missing, but its exact process is live on the owning host.'
      : processVerdict === 'exited'
        ? 'The exact process exited, but its worker release identity no longer matches.'
        : 'The recorded terminal is missing, and its exact process is unverifiable on the owning host.'
  return { ...releaseUnknown(db, dispatchId, resource, reason), processVerdict }
}

export async function closeWorkerTerminalOnOwningHost(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  dispatchId: string
  resource: WorkerTerminalResourceRow
  releasing: WorkerTerminalResourceRow
  archiveSource: 'transcript' | 'terminal' | null
  archiveStatus: WorkerTerminalArchiveStatus | null
}): Promise<WorkerReleaseReceipt> {
  const { runtime, db, dispatchId, resource, releasing, archiveSource, archiveStatus } = args
  try {
    const close = await runtime.closeTerminal(resource.terminal_handle)
    if (!close.ptyKilled) {
      const processVerdict = await inspectProcess(runtime, resource)
      if (processVerdict === 'exited') {
        const released = db.settleWorkerTerminalRelease(resource.id)
        runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
        return {
          dispatchId,
          state: 'released',
          processAction: 'closed_agent_terminal',
          processVerdict,
          archive: archiveSummary(released)
        }
      }
      const reason =
        processVerdict === 'live'
          ? 'The agent terminal was closed but its exact process remains live on the owning host.'
          : describeUnconfirmedAgentStop(close)
      const unknown = db.markWorkerTerminalReleaseUnknown(resource.id, reason)
      return {
        dispatchId,
        state: 'release_unknown',
        processAction: 'closed_agent_terminal',
        processVerdict,
        archive: { source: archiveSource, status: archiveStatus },
        lastError: unknown.release_error ?? reason,
        recovery: releaseRecovery(dispatchId)
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (/(?:session_)?tab_not_found/.test(reason)) {
      return settleWorkerTerminalTabNotFoundCloseRace({
        runtime,
        db,
        dispatchId,
        resource,
        archive: { source: archiveSource, status: archiveStatus },
        closeResponse: { error: 'tab_not_found', message: reason }
      })
    }
    if (/disposed|not connected|unavailable/i.test(reason)) {
      return {
        ...releaseUnknown(
          db,
          dispatchId,
          releasing,
          `The owning endpoint is unavailable, so the exact worker process is unverifiable: ${reason}`
        ),
        processVerdict: 'unverifiable'
      }
    }
    const unknown = db.markWorkerTerminalReleaseUnknown(resource.id, reason)
    return {
      dispatchId,
      state: 'release_unknown',
      processAction: 'none',
      archive: { source: archiveSource, status: archiveStatus },
      lastError: unknown.release_error ?? reason,
      recovery: releaseRecovery(dispatchId)
    }
  }
  const released = db.settleWorkerTerminalRelease(resource.id)
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return {
    dispatchId,
    state: 'released',
    processAction: 'closed_agent_terminal',
    processVerdict: 'exited',
    archive: archiveSummary(released)
  }
}

function inspectProcess(
  runtime: OrcaRuntimeService,
  resource: WorkerTerminalResourceRow
): Promise<'live' | 'unverifiable' | 'exited'> {
  return runtime
    .inspectTerminalProcessIncarnationLiveness(
      resource.process_incarnation ?? '',
      resource.host_scope
    )
    .catch(() => 'unverifiable' as const)
}

function releaseRecovery(dispatchId: string): string {
  return `Inspect with: orca orchestration worker-show --dispatch ${dispatchId} --json — then repeat worker-release with the same --retry-request. Never substitute a broad terminal close.`
}
