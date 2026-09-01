import { join } from 'node:path'
import { OrchestrationDb } from '../../../../src/main/runtime/orchestration/db/orchestration-db'
import { DispatchTranscriptStore } from '../../../../src/main/runtime/orchestration/db/dispatch-transcript/dispatch-transcript-store'

const launchProfile = {
  agent: 'codex' as const,
  model: 'gpt-5.6-sol',
  effort: 'high',
  permissionMode: 'yolo',
  routeRef: null
}

const terminal = {
  executionHostId: 'local',
  workspaceKey: 'folder:career-ops',
  terminalHandle: 'term-career-ops',
  paneKey: 'tab-career-ops:leaf-career-ops',
  ptyIncarnation: 'pty:career-ops',
  processRootId: 'pid:career-ops'
}

function createSettledPredecessor(database: OrchestrationDb) {
  database.db
    .prepare(
      `INSERT INTO worker_terminal_resources (
        id, origin_dispatch_id, owner_dispatch_id, terminal_handle, pane_key,
        process_incarnation, host_scope, ownership_state, release_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'owned', 'not_requested')`
    )
    .run(
      'resource-predecessor',
      'dispatch-predecessor',
      'dispatch-predecessor',
      terminal.terminalHandle,
      terminal.paneKey,
      terminal.ptyIncarnation,
      'local'
    )
  database.db
    .prepare("INSERT INTO worker_dispatches (dispatch_id, state) VALUES (?, 'succeeded')")
    .run('dispatch-predecessor')
  const lease = database.reserveMaestroTerminalLease({
    requestId: 'worker:dispatch-predecessor',
    executionHostId: terminal.executionHostId,
    workspaceKey: terminal.workspaceKey,
    runId: 'run-career-ops',
    taskId: 'task-predecessor',
    attemptId: 'attempt-predecessor',
    role: 'worker',
    workerTerminalResourceId: 'resource-predecessor',
    title: 'Career Ops predecessor',
    launchProfile,
    spawnedBy: 'coordinator:g1',
    ownerPrincipal: 'dispatch:dispatch-predecessor',
    retentionPolicy: 'auto_release'
  })
  database.attachMaestroTerminalLease({
    leaseId: lease.id,
    tabId: 'tab-career-ops',
    ...terminal
  })
  database.transitionMaestroTerminalLease({ leaseId: lease.id, state: 'ready' })
  database.transitionMaestroTerminalLease({ leaseId: lease.id, state: 'active' })
  database.transitionMaestroTerminalLease({ leaseId: lease.id, state: 'settled' })
  return lease
}

export function exerciseSessionTransferAndRestart(root: string) {
  const databasePath = join(root, 'orchestration.sqlite')
  let database = new OrchestrationDb(databasePath)
  const predecessor = createSettledPredecessor(database)
  let transcripts = new DispatchTranscriptStore(database)
  transcripts.startSegment({
    dispatchId: 'dispatch-predecessor',
    leaseId: predecessor.id,
    runId: 'run-career-ops',
    taskId: 'task-predecessor',
    attemptId: 'attempt-predecessor',
    startCursor: 0,
    ...terminal
  })
  transcripts.appendEntries({
    dispatchId: 'dispatch-predecessor',
    terminal,
    entries: [{ cursor: 0, payload: 'predecessor output' }]
  })
  const leaseTransfer = database.transferMaestroWorkerTerminalLease({
    requestId: 'lease-transfer-career-ops',
    predecessorLeaseId: predecessor.id,
    successorRequestId: 'worker:dispatch-successor',
    kind: 'settled_resource_reuse',
    successorDispatchId: 'dispatch-successor',
    runId: 'run-career-ops',
    taskId: 'task-successor',
    attemptId: 'attempt-successor',
    hostScope: 'local',
    predecessorOwnerPrincipal: 'dispatch:dispatch-predecessor',
    successorOwnerPrincipal: 'dispatch:dispatch-successor',
    coordinatorGeneration: 1,
    retentionPolicy: 'auto_release',
    title: 'Career Ops successor',
    launchProfile,
    spawnedBy: 'coordinator:g1',
    ...terminal
  })
  const transcriptTransfer = transcripts.transferSegment({
    requestId: 'transcript-transfer-career-ops',
    leaseTransferRequestId: leaseTransfer.requestId,
    predecessorDispatchId: 'dispatch-predecessor',
    predecessorLeaseId: predecessor.id,
    successorDispatchId: 'dispatch-successor',
    successorLeaseId: leaseTransfer.successorLeaseId,
    successorRunId: 'run-career-ops',
    successorTaskId: 'task-successor',
    successorAttemptId: 'attempt-successor',
    transferCursor: 1,
    ...terminal
  })
  transcripts.appendEntries({
    dispatchId: 'dispatch-successor',
    terminal,
    entries: [{ cursor: 1, payload: 'successor output' }]
  })
  const activeRead = transcripts.read({ dispatchId: 'dispatch-successor' })
  const predecessorRead = transcripts.read({
    dispatchId: 'dispatch-successor',
    selector: { kind: 'predecessor', dispatchId: 'dispatch-predecessor' }
  })
  database.close()
  database = new OrchestrationDb(databasePath)
  transcripts = new DispatchTranscriptStore(database)
  const replayed = transcripts.getTransferReceipt(transcriptTransfer.requestId)
  const restartedRead = transcripts.read({ dispatchId: 'dispatch-successor' })
  database.close()
  return {
    leaseTransferred: leaseTransfer.predecessorLeaseId === predecessor.id,
    activeRead: activeRead.entries.map((entry) => entry.payload),
    predecessorRead: predecessorRead.entries.map((entry) => entry.payload),
    restartPreserved: replayed?.successorDispatchId === 'dispatch-successor',
    restartedRead: restartedRead.entries.map((entry) => entry.payload)
  }
}
