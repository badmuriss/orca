import { describe, expect, it } from 'vitest'
import { joinMaestroCanvasProgress, MAESTRO_LIST_METHODS } from './maestro-list'
import type { MaestroCanvasIndexEntry } from '../../../../shared/maestro-canvas-index'
import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'

function entry(executionHostId: string, workspaceKey: string): MaestroCanvasIndexEntry {
  return {
    executionHostId,
    workspaceKey,
    revision: 2,
    updatedAt: '2026-08-24T10:00:00.000Z',
    intentCounts: { pending: 1, claimed: 0, settled: 0 }
  }
}

function unavailableProgress(): MaestroRunProgress {
  return { available: false, state: 'outcome_unknown' }
}

describe('Maestro list RPC', () => {
  it('registers the summary-only Canvas index', () => {
    expect(MAESTRO_LIST_METHODS.map((method) => method.name)).toEqual(['maestro.list'])
  })

  it('joins progress only on the exact host and workspace pair', () => {
    const local = entry('local', 'worktree:repo::same')
    const remote = entry('ssh:build', 'worktree:repo::same')

    expect(
      joinMaestroCanvasProgress(
        [local, remote],
        [{ ...remote, runProgress: unavailableProgress() }]
      )
    ).toEqual([
      { ...local, runProgress: undefined },
      { ...remote, runProgress: unavailableProgress() }
    ])
  })

  it('drops progress for a different workspace instead of merging counts', () => {
    const canvas = entry('local', 'folder:alpha')
    const result = joinMaestroCanvasProgress(
      [canvas],
      [
        {
          executionHostId: 'local',
          workspaceKey: 'folder:beta',
          runProgress: unavailableProgress()
        }
      ]
    )

    expect(result).toEqual([{ ...canvas, runProgress: undefined }])
  })
})
