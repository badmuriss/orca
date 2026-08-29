import { describe, expect, it } from 'vitest'
import { buildLabeledMaestroCanvasIndex, joinMaestroCanvasProgress } from './maestro-list'
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

  it('labels projection-only workspaces and provides the public recovery path', () => {
    const result = buildLabeledMaestroCanvasIndex(
      [],
      [
        {
          executionHostId: 'local',
          workspaceKey: 'folder:alpha',
          revision: 0,
          updatedAt: '2026-08-24T10:00:00.000Z',
          runId: 'run-1'
        }
      ],
      []
    )

    expect(result).toEqual([
      expect.objectContaining({
        documentState: 'empty',
        documentRevision: null,
        projectionState: 'ready',
        projectionRevision: 0,
        recoveryHint: expect.stringContaining('maestro projection show')
      })
    ])
  })

  it('keeps document and projection revisions explicitly separate', () => {
    const result = buildLabeledMaestroCanvasIndex(
      [entry('local', 'folder:alpha')],
      [
        {
          executionHostId: 'local',
          workspaceKey: 'folder:alpha',
          revision: 7,
          updatedAt: '2026-08-24T11:00:00.000Z',
          runId: 'run-1'
        }
      ],
      []
    )

    expect(result[0]).toMatchObject({
      documentState: 'ready',
      documentRevision: 2,
      projectionState: 'ready',
      projectionRevision: 7,
      recoveryHint: null
    })
  })
})
