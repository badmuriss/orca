import type { OrcaRuntimeService } from '../../../orca-runtime'
import type {
  WorkerTerminalArchiveRow,
  WorkerTerminalResourceRow,
  WorkerTerminalRetainedReason
} from '../../worker-terminal-ownership'
import type { WorkerTerminalTailArchive } from '../../worker-output-archive'
import type { OrchestrationDb } from '../orchestration-db'

export function workerTerminalLeaseIsCurrent(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  dispatchId: string,
  resource: WorkerTerminalResourceRow
): boolean {
  const worker = db.getWorkerDispatch(dispatchId)
  const authority = runtime.getOrchestrationDispatchAuthority(resource.terminal_handle)
  return Boolean(
    worker?.agent_terminal_handle === resource.terminal_handle &&
    authority &&
    authority.terminalHandle === resource.terminal_handle &&
    resource.worktree_id !== null &&
    resource.worktree_id === authority.worktreeId &&
    resource.pane_key !== null &&
    resource.pane_key === authority.paneKey &&
    resource.process_incarnation !== null &&
    resource.process_incarnation === authority.processIncarnation &&
    resource.host_scope === JSON.stringify(authority.hostScope) &&
    db.isDispatchProcessCurrent({
      dispatchId,
      paneKey: authority.paneKey,
      processIncarnation: authority.processIncarnation
    }) &&
    !db.workerTerminalResourceHasIdentityConflict(resource.id)
  )
}

export function summarizeWorkerTerminalArchive(archive: WorkerTerminalArchiveRow): {
  source: 'transcript' | 'terminal'
  status: 'captured' | 'empty'
} {
  if (archive.kind === 'transcript_pin') {
    return { source: 'transcript', status: 'captured' }
  }
  const content = JSON.parse(archive.content) as WorkerTerminalTailArchive
  return {
    source: 'terminal',
    status: content.lines.every((line) => line.trim() === '') ? 'empty' : 'captured'
  }
}

export function retainedWorkerTerminalReason(
  resource: WorkerTerminalResourceRow
): WorkerTerminalRetainedReason {
  if (resource.retained_reason) {
    return resource.retained_reason as WorkerTerminalRetainedReason
  }
  return resource.ownership_state === 'user_owned' ? 'user_takeover' : 'identity_unproven'
}
