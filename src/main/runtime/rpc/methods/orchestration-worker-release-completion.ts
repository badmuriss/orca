import type { OrchestrationDb } from '../../orchestration/db'
import type {
  WorkerTerminalArchiveStatus,
  WorkerTerminalResourceRow,
  WorkerTerminalRetainedReason
} from '../../orchestration/worker-terminal-ownership'
import { captureWorkerOutputArchive } from '../../orchestration/worker-output-archive'
import {
  reconcileExitedWorkerTerminalRelease,
  workerTerminalWorkspaceIsCurrent
} from '../../orchestration/worker-terminal-exited-release-reconciliation'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { describeUnconfirmedAgentStop } from '../../../../shared/pty-liveness-verdict'
import { inspectWorkerTerminal } from './orchestration-worker-observation'
import { orchestrationTimestampToMs } from './orchestration-worker-output'
import { settleWorkerTerminalTabNotFoundCloseRace } from '../../orchestration/db/worker-terminal/worker-terminal-close-race'
import {
  retainedWorkerTerminalReason,
  summarizeWorkerTerminalArchive,
  workerTerminalLeaseIsCurrent
} from '../../orchestration/db/worker-terminal/worker-terminal-release-identity'
import { identityMismatchReceipt, releaseUnknown } from './orchestration-worker-release-receipts'

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
  archive: { source: string | null; status: string | null } | null
  recovery?: string
  lastError?: string
  closeResponse?: { error: 'tab_not_found'; message: string }
  inventoryResponse?: { state: 'absent' | 'still_present' | 'unverifiable' }
}

type WorkerTerminalReleaseArgs = {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  dispatchId: string
  resource: WorkerTerminalResourceRow
  mode?: 'interactive' | 'recovery'
}

type ActiveWorkerReleases = Map<string, Promise<WorkerReleaseReceipt>>
const activeReleaseByRuntime = new WeakMap<OrcaRuntimeService, ActiveWorkerReleases>()

import { archiveSummary } from './orchestration-worker-terminal-resource-view'

export {
  archiveSummary,
  exposeWorkerTerminalResource
} from './orchestration-worker-terminal-resource-view'

// Re-prove exact identity, freeze output, and settle one durably requested release.
export function completeWorkerTerminalRelease(
  args: WorkerTerminalReleaseArgs
): Promise<WorkerReleaseReceipt> {
  let activeByResource = activeReleaseByRuntime.get(args.runtime)
  if (!activeByResource) {
    activeByResource = new Map()
    activeReleaseByRuntime.set(args.runtime, activeByResource)
  }
  const active = activeByResource.get(args.resource.id)
  if (active) {
    return active
  }
  const release = completeWorkerTerminalReleaseOnce(args).finally(() => {
    if (activeByResource?.get(args.resource.id) === release) {
      activeByResource.delete(args.resource.id)
    }
  })
  activeByResource.set(args.resource.id, release)
  return release
}

async function completeWorkerTerminalReleaseOnce(
  args: WorkerTerminalReleaseArgs
): Promise<WorkerReleaseReceipt> {
  const { runtime, db, dispatchId, resource } = args
  const worker = db.getWorkerDispatch(dispatchId)
  if (!worker || worker.agent_terminal_handle !== resource.terminal_handle) {
    return identityMismatchReceipt(
      db,
      dispatchId,
      resource,
      'The worker assignment no longer matches the recorded terminal; worker release remains unknown.'
    )
  }
  const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
  if (observation.status === 'identity_changed') {
    return identityMismatchReceipt(
      db,
      dispatchId,
      resource,
      'The recorded terminal now identifies a different process; worker release remains unknown.'
    )
  }
  if (observation.status === 'unverifiable') {
    return releaseUnknown(
      db,
      dispatchId,
      resource,
      `The exact worker process is unverifiable: ${observation.reason ?? 'the owning host did not return a liveness verdict'}.`
    )
  }
  if (!workerTerminalLeaseIsCurrent(runtime, db, dispatchId, resource)) {
    return identityMismatchReceipt(
      db,
      dispatchId,
      resource,
      'The recorded worker lease no longer matches its exact terminal identity; worker release remains unknown.'
    )
  }
  if (observation.status === 'missing' || observation.status === 'unattached') {
    return releaseUnknown(
      db,
      dispatchId,
      resource,
      'The recorded terminal is missing; its process state is unverifiable.'
    )
  }
  if (!workerTerminalWorkspaceIsCurrent(resource, observation)) {
    return identityMismatchReceipt(
      db,
      dispatchId,
      resource,
      'The recorded worker workspace no longer matches the exact terminal; worker release remains unknown.'
    )
  }
  const providerSessionBeforeArchive = runtime.getExactWorkerProviderSession(
    resource.terminal_handle,
    orchestrationTimestampToMs(worker.created_at)
  )
  const archive = db.getWorkerTerminalArchive(dispatchId)
  let archiveSource = resource.archive_source as 'transcript' | 'terminal' | null
  let archiveStatus: WorkerTerminalArchiveStatus | null = resource.archive_status
  let capturedArchive: { kind: 'transcript_pin' | 'terminal_tail'; content: string } | undefined
  if (!archive) {
    const captured = await captureWorkerOutputArchive({
      runtime,
      dispatchId,
      terminalHandle: resource.terminal_handle,
      attachedAtMs: orchestrationTimestampToMs(worker.created_at)
    })
    capturedArchive = { kind: captured.kind, content: JSON.stringify(captured.content) }
    archiveSource = captured.kind === 'transcript_pin' ? 'transcript' : 'terminal'
    archiveStatus = captured.status
  } else {
    const stored = summarizeWorkerTerminalArchive(archive)
    archiveSource ??= stored.source
    archiveStatus ??= stored.status
  }
  const reusesArchivedUnknown =
    resource.release_state === 'unknown' && archive?.resource_id === resource.id
  const releasing = reusesArchivedUnknown
    ? resource
    : db.commitWorkerTerminalArchiveForRelease({
        dispatchId,
        resourceId: resource.id,
        ...capturedArchive,
        archiveSource,
        archiveStatus: archiveStatus === 'empty' ? 'empty' : 'captured'
      })
  const canReconcile =
    releasing.release_state === 'releasing' ||
    (reusesArchivedUnknown && releasing.release_state === 'unknown')
  if (releasing.ownership_state !== 'owned') {
    return {
      dispatchId,
      state: 'retained',
      reason: retainedWorkerTerminalReason(releasing),
      processAction: 'none',
      archive: archiveSummary(releasing)
    }
  }
  if (releasing.release_state === 'retained') {
    return {
      dispatchId,
      state: 'retained',
      reason: retainedWorkerTerminalReason(releasing),
      processAction: 'none',
      archive: archiveSummary(releasing)
    }
  }
  if (!canReconcile) {
    return releaseUnknown(
      db,
      dispatchId,
      releasing,
      'The archived release receipt does not match this worker resource; worker release remains unknown.'
    )
  }
  if (!workerTerminalLeaseIsCurrent(runtime, db, dispatchId, releasing)) {
    return identityMismatchReceipt(
      db,
      dispatchId,
      resource,
      'The recorded worker lease changed while output was archived; worker release remains unknown.'
    )
  }
  const observationAfterArchive = await inspectWorkerTerminal(runtime, db, dispatchId)
  if (
    !['live', 'exited'].includes(observationAfterArchive.status) ||
    !workerTerminalWorkspaceIsCurrent(releasing, observationAfterArchive)
  ) {
    if (
      observationAfterArchive.status === 'identity_changed' ||
      (['live', 'exited'].includes(observationAfterArchive.status) &&
        !workerTerminalWorkspaceIsCurrent(releasing, observationAfterArchive))
    ) {
      return identityMismatchReceipt(
        db,
        dispatchId,
        resource,
        `The exact worker evidence became ${observationAfterArchive.status} while output was archived; worker release remains unknown.`
      )
    }
    return releaseUnknown(
      db,
      dispatchId,
      releasing,
      `The exact worker evidence became ${observationAfterArchive.status} while output was archived; worker release remains unknown.`
    )
  }

  const exited = await reconcileExitedWorkerTerminalRelease({
    runtime,
    db,
    dispatchId,
    resource: releasing,
    observation: observationAfterArchive,
    providerSessionBeforeArchive,
    attachedAtMs: orchestrationTimestampToMs(worker.created_at)
  })
  if (exited.state === 'release_unknown') {
    return releaseUnknown(db, dispatchId, releasing, exited.reason)
  }
  if (exited.state === 'released') {
    return {
      dispatchId,
      state: 'released',
      processAction: 'closed_exited_terminal',
      archive: archiveSummary(exited.resource)
    }
  }
  try {
    const close = await runtime.closeTerminal(resource.terminal_handle)
    if (!close.ptyKilled) {
      const reason = describeUnconfirmedAgentStop(close)
      const unknown = db.markWorkerTerminalReleaseUnknown(resource.id, reason)
      return {
        dispatchId,
        state: 'release_unknown',
        processAction: 'closed_agent_terminal',
        archive: { source: archiveSource, status: archiveStatus },
        lastError: unknown.release_error ?? reason,
        recovery: `Inspect with: orca orchestration worker-show --dispatch ${dispatchId} --json — then repeat worker-release with the same --retry-request. Never substitute a broad terminal close.`
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
      return releaseUnknown(
        db,
        dispatchId,
        releasing,
        `The owning endpoint is unavailable, so the exact worker process is unverifiable: ${reason}`
      )
    }
    const unknown = db.markWorkerTerminalReleaseUnknown(resource.id, reason)
    return {
      dispatchId,
      state: 'release_unknown',
      processAction: 'none',
      archive: { source: archiveSource, status: archiveStatus },
      lastError: unknown.release_error ?? reason,
      recovery: `Inspect with: orca orchestration worker-show --dispatch ${dispatchId} --json — then repeat worker-release with the same --retry-request. Never substitute a broad terminal close.`
    }
  }
  const released = db.settleWorkerTerminalRelease(resource.id)
  runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
  return {
    dispatchId,
    state: 'released',
    processAction: 'closed_agent_terminal',
    archive: archiveSummary(released)
  }
}
