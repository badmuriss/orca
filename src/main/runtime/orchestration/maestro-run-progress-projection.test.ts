import { describe, expect, it } from 'vitest'
import type { MaestroTerminalLease } from '../../../shared/maestro-terminal-lease'
import type { OrchestrationNestedAgentActivity } from '../../../shared/orchestration-nested-agent-activity'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'
import { browserReceipt } from '../rpc/methods/maestro-workspace-canvas-session-fixtures'
import type { DispatchContextRow, MessageRow, RunRow, TaskRow, WorkerDispatchRow } from './types'
import { projectMaestroRunProgress } from './maestro-run-progress-projection'

const run: RunRow = {
  id: 'run-1',
  objective: 'Harden orchestration progress',
  home_database: ':memory:',
  coordinator_handle: 'coordinator-1',
  coordinator_pane_key: 'tab-1:leaf-1',
  consumer_generation: 1,
  legacy: 0,
  created_at: '2026-08-28T10:00:00.000Z',
  updated_at: '2026-08-28T10:00:00.000Z'
}

function task(id: string, status: TaskRow['status'], overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    run_id: run.id,
    parent_id: null,
    created_by_terminal_handle: null,
    created_by_pane_key: null,
    created_by_process_incarnation: null,
    created_by_run_generation: null,
    task_title: 'Implement progress',
    display_name: 'Runtime engineer',
    spec: 'Project explicit ledger fields.',
    status,
    deps: '[]',
    result: null,
    created_at: `2026-08-28T10:00:0${id.endsWith('1') ? '1' : '2'}.000Z`,
    completed_at: null,
    ...overrides
  }
}

function dispatch(
  id: string,
  taskId: string,
  overrides: Partial<DispatchContextRow> = {}
): DispatchContextRow {
  return {
    id,
    run_id: run.id,
    task_id: taskId,
    contract_version: 1,
    launch_token_hash: 'hash',
    assignee_handle: `terminal-${id}`,
    assignee_pane_key: `tab-${id}:leaf-1`,
    capability_hash: 'capability',
    process_incarnation: `pty-${id}:1`,
    capability_revoked_at: null,
    status: 'dispatched',
    failure_count: 0,
    last_failure: null,
    termination_reason: null,
    depth: 1,
    dispatched_at: '2026-08-28T10:01:00.000Z',
    completed_at: null,
    created_at: '2026-08-28T10:01:00.000Z',
    last_heartbeat_at: null,
    ...overrides
  }
}

function lease(
  taskId: string,
  lifecycleState: MaestroTerminalLease['lifecycleState']
): MaestroTerminalLease {
  const dispatchId = `dispatch-${taskId.replace(/^task-/, '')}`
  return {
    id: `lease-${taskId}`,
    requestId: `request-${taskId}`,
    executionHostId: 'local',
    workspaceKey: 'folder:one',
    terminalHandle: `terminal-${dispatchId}`,
    tabId: `tab-${dispatchId}`,
    paneKey: `tab-${dispatchId}:leaf-1`,
    ptyIncarnation: `pty-${dispatchId}:1`,
    processRootId: `process-${taskId}`,
    runId: run.id,
    taskId,
    attemptId: `attempt-${taskId}`,
    coordinatorGeneration: null,
    role: 'worker',
    workerTerminalResourceId: `resource-${taskId}`,
    coordinatorRunId: null,
    title: 'Runtime engineer',
    launchProfile: {
      agent: 'codex',
      model: 'gpt-5',
      effort: 'high',
      permissionMode: 'default',
      routeRef: null
    },
    parentLeaseId: null,
    spawnedBy: 'coordinator-1',
    ownerPrincipal: `dispatch:${dispatchId}`,
    retentionPolicy: 'auto_release',
    lifecycleState,
    observation: null,
    providerSessionId: `session-${taskId}`,
    capsuleDigest: null,
    cleanupReceipt: null,
    archivedTail: null,
    createdAt: '2026-08-28T10:01:00.000Z',
    updatedAt: '2026-08-28T10:02:00.000Z'
  }
}

function message(
  id: string,
  dispatchId: string,
  subject: string,
  sequence: number,
  payload: Record<string, unknown> = {}
): MessageRow {
  return {
    id,
    run_id: run.id,
    delivery_contract: 'current_delivery',
    from_handle: `terminal-${dispatchId}`,
    to_handle: `run:${run.id}`,
    subject,
    body: '',
    type: 'heartbeat',
    priority: 'normal',
    thread_id: null,
    payload: JSON.stringify({ dispatchId, ...payload }),
    read: 0,
    sequence,
    created_at: '2026-08-28T10:02:00.000Z',
    delivered_at: null,
    sender_pane_key: null
  }
}

function project(overrides: Partial<Parameters<typeof projectMaestroRunProgress>[0]> = {}) {
  return projectMaestroRunProgress({
    run,
    tasks: [],
    dispatches: [],
    messages: [],
    terminalLeases: [],
    workerDispatches: [],
    browserSurfaces: [],
    providerExecutions: [],
    nestedActivity: [],
    executionHostId: 'local',
    workspaceKey: 'folder:one',
    revision: 3,
    projectionHealth: { state: 'healthy', revision: 3 },
    cleanupHealth: { state: 'clean', count: 0 },
    recoveredAuthority: false,
    browserSurfaceKeys: new Map(),
    ...overrides
  })
}

describe('Maestro Run progress projection', () => {
  it('projects human activity from accepted ledger messages without adding child weight', () => {
    const first = task('task-1', 'dispatched')
    const second = task('task-2', 'ready')
    const firstDispatch = dispatch('dispatch-1', first.id)
    const rejected = message('message-2', firstDispatch.id, 'Untrusted phase', 2, {
      _orcaLifecycleRejection: { code: 'sender_not_assignee', reason: 'wrong actor' }
    })
    const accepted = message('message-1', firstDispatch.id, 'alive', 1, {
      phase: 'Validating the runtime projection'
    })
    const nested: OrchestrationNestedAgentActivity = {
      parent_dispatch_id: firstDispatch.id,
      parent_provider_session_id: 'session-1',
      provider_child_id: 'child-1',
      provider: 'codex',
      type: 'reviewer',
      model: 'gpt-5',
      description: 'Reviews lifecycle math',
      state: 'running',
      started_at: '2026-08-28T10:01:00.000Z',
      updated_at: '2026-08-28T10:02:00.000Z'
    }
    const worker: WorkerDispatchRow = {
      dispatch_id: firstDispatch.id,
      runtime_epoch: 'runtime-1',
      state: 'succeeded',
      stage: 'ready',
      worktree_id: 'folder:one',
      agent_terminal_handle: 'terminal-task-1',
      setup_state: 'ready',
      effects: '[]',
      residual_resources: '[]',
      start_options: '{}',
      last_error: null,
      created_at: '2026-08-28T10:01:00.000Z',
      updated_at: '2026-08-28T10:02:00.000Z'
    }
    const provider: ExactWorkerProviderSession = {
      paneKey: firstDispatch.assignee_pane_key as string,
      processIncarnation: firstDispatch.process_incarnation as string,
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'provider-session-1' },
      observedAt: Date.parse('2026-08-28T10:02:00.000Z')
    }

    const result = project({
      tasks: [second, first],
      dispatches: [firstDispatch],
      messages: [rejected, accepted],
      terminalLeases: [lease(first.id, 'active')],
      workerDispatches: [worker],
      browserSurfaces: [
        browserReceipt({
          runId: run.id,
          taskId: first.id,
          attemptId: firstDispatch.id
        })
      ],
      providerExecutions: [{ dispatchId: firstDispatch.id, session: provider }],
      browserSurfaceKeys: new Map([['browser-page-1', 'browser-surface-key']]),
      nestedActivity: [nested]
    })

    expect(result.execution).toMatchObject({ total: 2, completed: 0, progress_percent: 0 })
    expect(result.current[0]).toMatchObject({
      reference: first.id,
      title: 'Implement progress 1',
      worker_label: 'Runtime engineer',
      activity_summary: 'Validating the runtime projection'
    })
    expect(result.next[0]).toMatchObject({ reference: second.id, title: 'Implement progress 2' })
    expect(result.nested_activity[0]).toMatchObject({
      parent_reference: first.id,
      child_id: 'child-1'
    })
    expect(new Set(result.resources?.map((resource) => resource.kind))).toEqual(
      new Set([
        'coordinator',
        'task',
        'attempt',
        'dispatch',
        'provider',
        'terminal',
        'browser',
        'cleanup'
      ])
    )
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'terminal',
          parent_reference: 'attempt-task-1',
          terminal_handle: 'terminal-dispatch-1',
          liveness: 'live'
        }),
        expect.objectContaining({
          kind: 'attempt',
          reference: 'attempt-task-1',
          parent_reference: firstDispatch.id
        }),
        expect.objectContaining({ kind: 'browser', surface_key: 'browser-surface-key' }),
        expect.objectContaining({
          kind: 'coordinator',
          state: 'unverifiable',
          detail: 'Coordinator handle has no matching live terminal lease.'
        }),
        expect.objectContaining({
          kind: 'provider',
          reference: 'provider-session-1',
          state: 'completed'
        })
      ])
    )
  })

  it('reports terminal Tasks at 100 percent while preserving orthogonal health warnings', () => {
    const succeeded = task('task-1', 'completed', {
      result: JSON.stringify({
        provenance: 'worker_report',
        outcome: 'succeeded',
        subject: 'Progress worker completed',
        body: 'Added authoritative progress projection.'
      }),
      completed_at: '2026-08-28T10:03:00.000Z'
    })
    const failed = task('task-2', 'failed', {
      result: 'Validation failed.',
      completed_at: '2026-08-28T10:04:00.000Z'
    })
    const uncertainLease = lease(failed.id, 'outcome_unknown')
    uncertainLease.cleanupReceipt = {
      verdict: 'unverifiable',
      processTreeVerified: false,
      closedTerminalHandle: null,
      replacementTerminalHandle: null,
      replacementIncarnation: null,
      archiveRef: null,
      observedAt: '2026-08-28T10:05:00.000Z'
    }

    const result = project({
      tasks: [succeeded, failed],
      dispatches: [dispatch('dispatch-1', succeeded.id), dispatch('dispatch-2', failed.id)],
      terminalLeases: [uncertainLease],
      projectionHealth: { state: 'partial', revision: 3, warning: 'Projection is partial.' },
      cleanupHealth: {
        state: 'unverifiable',
        count: 1,
        warning: 'Cleanup is unverifiable for 1 worker resource.'
      }
    })

    expect(result.execution).toMatchObject({
      state: 'completed_with_failures',
      progress_percent: 100,
      completed: 2,
      total: 2
    })
    expect(result.projection_health.state).toBe('partial')
    expect(result.cleanup_health).toMatchObject({ state: 'unverifiable', count: 1 })
    expect(result.recently_completed.map((entry) => entry.outcome_summary)).toEqual([
      'Validation failed.',
      'Added authoritative progress projection.'
    ])
  })

  it('derives cancellation from an explicit operator-close terminal reason', () => {
    const cancelled = task('task-1', 'failed', { result: 'Cancelled by operator.' })
    const result = project({
      tasks: [cancelled],
      dispatches: [
        dispatch('dispatch-1', cancelled.id, {
          status: 'failed',
          termination_reason: 'operator_close'
        })
      ]
    })

    expect(result.execution).toMatchObject({
      state: 'cancelled',
      progress_percent: 100,
      counts: { cancelled: 1, failed: 0 }
    })
  })

  it('omits percentage for zero-Task Runs', () => {
    expect(project().execution).toEqual({
      state: 'active',
      completed: 0,
      total: 0,
      counts: {
        pending: 0,
        running: 0,
        input_required: 0,
        blocked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0
      }
    })
  })

  it('keeps deliverable completion separate from superseded operational work', () => {
    const deliverable = task('task-1', 'completed', { purpose: 'deliverable' })
    const superseded = task('task-2', 'failed', {
      purpose: 'operational',
      operational_outcome: 'superseded',
      successor_task_id: 'task-3'
    })
    const successor = task('task-3', 'ready', { purpose: 'operational' })

    const result = project({ tasks: [successor, superseded, deliverable] })

    expect(result.deliverables).toEqual({ completed: 1, total: 1, progress_percent: 100 })
    expect(result.operational_reliability).toEqual({
      successful: 0,
      failed: 0,
      superseded: 1,
      unverifiable: 0
    })
    expect(result.recently_completed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: superseded.id,
          purpose: 'operational',
          operational_outcome: 'superseded',
          successor_reference: successor.id
        })
      ])
    )
  })
})
