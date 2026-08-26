import { describe, expect, it } from 'vitest'
import type { MaestroCanvasIndexEntry } from '../../../../shared/maestro-canvas-index'
import type { MaestroRunProgressSummary } from '../../../../shared/maestro-run-progress'
import {
  buildMaestroNavigatorGroups,
  isMaestroRuntimeHostReachable,
  maestroNavigatorRowKey,
  maestroNavigatorRows,
  moveMaestroNavigatorSelection
} from './maestro-navigator-view-model'

const EMPTY_CLEANUP = { count: 0, ids: [], truncated: false }

function summary(running: number): MaestroRunProgressSummary {
  return {
    schema_version: 1,
    state: 'active',
    progress_percent: 40,
    task_counts: {
      approved: 4,
      running,
      input_required: 0,
      blocked: 0,
      pending: 1,
      failed: 0
    },
    current_tasks: [],
    next_tasks: [],
    cleanup: {
      pending: EMPTY_CLEANUP,
      unverifiable: EMPTY_CLEANUP,
      failed: EMPTY_CLEANUP,
      retained: EMPTY_CLEANUP
    },
    last_activity: null,
    blockers: [],
    material_findings: []
  }
}

function entry(host: string, workspaceKey: string, running: number): MaestroCanvasIndexEntry {
  return {
    executionHostId: host,
    workspaceKey,
    revision: 7,
    updatedAt: `2026-08-24T10:0${running}:00.000Z`,
    intentCounts: { pending: 0, claimed: 0, settled: 0 },
    runProgress: {
      available: true,
      summary: summary(running),
      authority: {
        runId: `run-${host}`,
        workspace: { executionHostId: host, workspaceKey },
        revision: 3
      }
    }
  }
}

const hosts = [
  { id: 'local', label: 'Local Linux', reachable: true },
  { id: 'ssh:build', label: 'Build host', reachable: false }
]
const workspaces = [
  {
    executionHostId: 'local',
    workspaceKey: 'worktree:repo::same',
    name: 'Local same',
    projectId: 'repo',
    projectName: 'Orca',
    archived: false
  },
  {
    executionHostId: 'ssh:build',
    workspaceKey: 'worktree:repo::same',
    name: 'Remote same',
    projectId: 'repo',
    projectName: 'Orca',
    archived: false
  }
]

describe('Maestro navigator view model', () => {
  it('fails closed until a runtime host has a live status', () => {
    expect(isMaestroRuntimeHostReachable(undefined)).toBe(false)
    expect(isMaestroRuntimeHostReachable({ status: null })).toBe(false)
    expect(isMaestroRuntimeHostReachable({ status: { runtimeId: 'runtime-1' } })).toBe(true)
  })

  it('keeps colliding workspace keys isolated by execution host', () => {
    const groups = buildMaestroNavigatorGroups({
      entries: [
        entry('local', 'worktree:repo::same', 1),
        entry('ssh:build', 'worktree:repo::same', 3)
      ],
      hosts,
      workspaces,
      query: '',
      recentKeys: []
    })
    const rows = maestroNavigatorRows(groups)

    expect(rows.map((row) => [row.key, row.progress?.task_counts.running, row.reachable])).toEqual([
      [maestroNavigatorRowKey('local', 'worktree:repo::same'), 1, true],
      [maestroNavigatorRowKey('ssh:build', 'worktree:repo::same'), 3, false]
    ])
  })

  it('rejects a progress authority from a colliding workspace', () => {
    const mismatched = entry('local', 'worktree:repo::same', 2)
    if (mismatched.runProgress?.available) {
      mismatched.runProgress.authority.workspace.workspaceKey = 'worktree:repo::other'
    }
    const [row] = maestroNavigatorRows(
      buildMaestroNavigatorGroups({
        entries: [mismatched],
        hosts,
        workspaces,
        query: '',
        recentKeys: []
      })
    )

    expect(row.progress).toBeNull()
    expect(row.progressUnavailable).toBe(true)
  })

  it('filters by workspace and project while excluding archived summaries', () => {
    const groups = buildMaestroNavigatorGroups({
      entries: [entry('local', 'worktree:repo::same', 1), entry('local', 'folder:archived', 1)],
      hosts,
      workspaces: [
        ...workspaces,
        {
          executionHostId: 'local',
          workspaceKey: 'folder:archived',
          name: 'Archived',
          projectId: 'legacy',
          projectName: 'Legacy',
          archived: true
        }
      ],
      query: 'orca local',
      recentKeys: []
    })

    expect(maestroNavigatorRows(groups).map((row) => row.workspaceName)).toEqual(['Local same'])
  })

  it('wraps keyboard selection in visual row order', () => {
    const rows = maestroNavigatorRows(
      buildMaestroNavigatorGroups({
        entries: [
          entry('local', 'worktree:repo::same', 1),
          entry('ssh:build', 'worktree:repo::same', 3)
        ],
        hosts,
        workspaces,
        query: '',
        recentKeys: []
      })
    )

    expect(moveMaestroNavigatorSelection(rows, rows[0].key, -1)).toBe(rows[1].key)
    expect(moveMaestroNavigatorSelection(rows, rows[1].key, 1)).toBe(rows[0].key)
  })
})
