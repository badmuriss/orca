import { describe, expect, it } from 'vitest'
import {
  MaestroRunProgressSummarySchema,
  parseNegotiatedMaestroRunProgress,
  unavailableMaestroRunProgress
} from './maestro-run-progress'

const summary = {
  schema_version: 1,
  state: 'partial',
  progress_percent: 99,
  task_counts: {
    approved: 4,
    running: 0,
    input_required: 0,
    blocked: 0,
    pending: 0,
    failed: 0
  },
  current_tasks: [],
  next_tasks: [],
  cleanup: {
    pending: { count: 0, ids: [], truncated: false },
    unverifiable: { count: 0, ids: [], truncated: false },
    failed: { count: 0, ids: [], truncated: false },
    retained: { count: 0, ids: [], truncated: false }
  },
  last_activity: { sequence: 12, timestamp: '2026-08-22T09:04:01Z', type: 'result_reported' },
  blockers: [],
  material_findings: [
    { task_id: 'ORC-04P', attempt_id: 'attempt-1', finding_ref: 'finding-1', cleanup_id: null }
  ]
} as const

const authority = {
  runId: 'run-1',
  workspace: { executionHostId: 'host-local', workspaceKey: 'folder:folder-local-01' },
  revision: 4
}

describe('Maestro run progress', () => {
  it('preserves the Harness summary without recomputing carry-forward progress', () => {
    expect(MaestroRunProgressSummarySchema.parse(summary)).toEqual(summary)
  })

  it('bounds Harness-owned references at the protocol boundary', () => {
    expect(() =>
      MaestroRunProgressSummarySchema.parse({
        ...summary,
        current_tasks: Array.from({ length: 4 }, (_, index) => ({
          task_id: `task-${index}`,
          attempt_id: null,
          status: 'running'
        }))
      })
    ).toThrow()
  })

  it('preserves unavailable Harness coordination observations without deriving metrics', () => {
    const coordination = {
      execution_mode: 'single_writer',
      latest_transition_reason: 'Bounded reduction after a failed check.',
      implementation_wall_time_ms: 1200,
      check_wall_time_ms: 'unavailable',
      coordinator_wait_for_worker_wall_time_ms: 300,
      audit_wall_time_ms: 80,
      dispatch_count: 2,
      operational_start_failures: 0,
      technical_attempts: 1,
      token_input: 'unavailable',
      token_output: 'unavailable',
      token_cache: 'unavailable',
      approved_tasks: 4,
      blocking_findings: 0,
      carry_forward_findings: 1,
      durations_diagnostic: true
    } as const

    expect(
      MaestroRunProgressSummarySchema.parse({ ...summary, coordination }).coordination
    ).toEqual(coordination)
  })

  it('rejects token observations outside the negotiated unavailable sentinel', () => {
    expect(() =>
      MaestroRunProgressSummarySchema.parse({
        ...summary,
        coordination: {
          execution_mode: 'single_writer',
          latest_transition_reason: null,
          implementation_wall_time_ms: 'unavailable',
          check_wall_time_ms: 'unavailable',
          coordinator_wait_for_worker_wall_time_ms: 'unavailable',
          audit_wall_time_ms: 'unavailable',
          dispatch_count: 0,
          operational_start_failures: 0,
          technical_attempts: 0,
          token_input: 1,
          token_output: 'unavailable',
          token_cache: 'unavailable',
          approved_tasks: 4,
          blocking_findings: 0,
          carry_forward_findings: 0,
          durations_diagnostic: true
        }
      })
    ).toThrow()
  })

  it('rejects an identity-less Harness reference', () => {
    expect(() =>
      MaestroRunProgressSummarySchema.parse({
        ...summary,
        material_findings: [
          { task_id: null, attempt_id: null, finding_ref: null, cleanup_id: null }
        ]
      })
    ).toThrow()
  })

  it('uses an explicit unavailable boundary for peers without run progress', () => {
    expect(unavailableMaestroRunProgress()).toEqual({ available: false, state: 'outcome_unknown' })
  })

  it.each([
    {
      progress_percent: 100,
      task_counts: { ...summary.task_counts, input_required: 1 },
      current_tasks: [{ task_id: 'ORC-04P', attempt_id: null, status: 'input_required' }]
    },
    {
      progress_percent: 100,
      task_counts: { ...summary.task_counts, blocked: 1 },
      current_tasks: [{ task_id: 'ORC-04P', attempt_id: null, status: 'blocked' }]
    },
    {
      progress_percent: 100,
      task_counts: { ...summary.task_counts, failed: 1 },
      current_tasks: [{ task_id: 'ORC-04P', attempt_id: null, status: 'failed' }]
    },
    {
      progress_percent: 100,
      task_counts: { ...summary.task_counts, running: 1 },
      current_tasks: [{ task_id: 'ORC-04P', attempt_id: null, status: 'running' }]
    },
    {
      progress_percent: 100,
      task_counts: { ...summary.task_counts, pending: 1 },
      next_tasks: [{ task_id: 'ORC-04P', attempt_id: null, status: 'pending' }]
    },
    {
      progress_percent: 100,
      cleanup: {
        ...summary.cleanup,
        retained: { count: 1, ids: ['cleanup-1'], truncated: false }
      }
    },
    { progress_percent: 100, material_findings: summary.material_findings }
  ])('rejects complete progress with unresolved canonical state', (contradiction) => {
    expect(() =>
      MaestroRunProgressSummarySchema.parse({
        ...summary,
        state: 'complete',
        ...contradiction
      })
    ).toThrow()
  })

  it('degrades invalid or unsupported negotiated versions without rejecting the graph', () => {
    expect(parseNegotiatedMaestroRunProgress({ ...summary, schema_version: 2 }, authority)).toEqual(
      { available: false, state: 'outcome_unknown' }
    )
    expect(parseNegotiatedMaestroRunProgress(undefined, null)).toEqual({
      available: false,
      state: 'outcome_unknown'
    })
  })
})
