import { describe, expect, it } from 'vitest'
import type { AgentGraphView, MaestroWorkspaceAnchor } from '../../../../../shared/maestro-contract'
import { OrchestrationDb } from '../orchestration-db'
import {
  applyMaestroBootstrapProjection,
  applyMaestroProjection,
  getMaestroProjection,
  listMaestroProjectionIndex,
  listMaestroRunProgress
} from './maestro-projection-store'

const HOME = { execution_host_id: 'local', workspace_key: 'folder:home-1' }
const EXECUTION = { execution_host_id: 'ssh:build', workspace_key: 'worktree:repo-1::/srv/repo' }

function anchor(runId = 'run-1'): MaestroWorkspaceAnchor {
  return {
    repository_id: 'home-1',
    execution_host_id: HOME.execution_host_id,
    workspace_key: HOME.workspace_key,
    run_id: runId
  }
}

function view(overrides: Partial<AgentGraphView> = {}): AgentGraphView {
  return {
    schema_version: 1,
    protocol: 'agent-graph-view/v1',
    kind: 'snapshot',
    workspace_scope: {
      schema_version: 1,
      repository_id: 'home-1',
      canonical_root: '/workspace/home',
      execution_host: { id: EXECUTION.execution_host_id, boundary: 'remote' },
      orchestration_home: {
        ...HOME,
        kind: 'folder',
        path: '/workspace/home'
      },
      execution_workspace: {
        ...EXECUTION,
        kind: 'git-worktree',
        path: '/srv/repo',
        worktree_path: '/srv/repo'
      },
      base_revision: 'a'.repeat(40),
      dirty_paths: [],
      run_id: 'run-1',
      coordinator_generation: 2,
      binding_receipt_ref: 'artifact:workspace-bootstrap/mutation-1.json',
      binding_receipt_hash: `sha256:${'b'.repeat(64)}`
    },
    change: 'orchestration-run',
    run_id: 'run-1',
    coordinator: { id: 'coordinator-1', generation: 2 },
    capabilities: {
      agents: ['codex'],
      efforts: ['high'],
      placement_kinds: ['existing-workspace'],
      watch_deltas: true
    },
    nodes: [],
    edges: [],
    removed_node_ids: [],
    removed_edge_ids: [],
    revision: 0,
    cursor: null,
    from_cursor: null,
    reset_required: false,
    ...overrides
  }
}

describe('Maestro projection store', () => {
  it('publishes one strict projection to its home and execution scopes', () => {
    const database = new OrchestrationDb(':memory:')
    const projection = applyMaestroProjection.call(database, anchor(), view())

    expect(projection.revision).toBe(0)
    expect(getMaestroProjection.call(database, HOME)).toMatchObject({ runId: 'run-1' })
    expect(getMaestroProjection.call(database, EXECUTION)).toMatchObject({ runId: 'run-1' })
    expect(listMaestroProjectionIndex.call(database)).toHaveLength(1)
    expect(listMaestroRunProgress.call(database)).toHaveLength(1)
    database.close()
  })

  it('rejects schema spread before persistence', () => {
    const database = new OrchestrationDb(':memory:')
    expect(() =>
      applyMaestroProjection.call(database, anchor(), { ...view(), caller_owned: true } as never)
    ).toThrow()
    expect(getMaestroProjection.call(database, HOME)).toBeNull()
    database.close()
  })

  it('replays an equivalent revision-zero bootstrap without overwriting it', () => {
    const database = new OrchestrationDb(':memory:')
    expect(applyMaestroBootstrapProjection.call(database, anchor(), view())).toBe('published')
    expect(applyMaestroBootstrapProjection.call(database, anchor(), view())).toBe('replayed')
    expect(listMaestroProjectionIndex.call(database)).toHaveLength(1)
    database.close()
  })

  it('rejects conflicting base and Run bindings without overwriting the active projection', () => {
    const database = new OrchestrationDb(':memory:')
    applyMaestroBootstrapProjection.call(database, anchor(), view())

    const conflictingBase = view({
      workspace_scope: { ...view().workspace_scope, base_revision: 'c'.repeat(40) }
    })
    expect(() => applyMaestroBootstrapProjection.call(database, anchor(), conflictingBase)).toThrow(
      'conflicts'
    )
    const conflictingRun = view({
      run_id: 'run-2',
      workspace_scope: { ...view().workspace_scope, run_id: 'run-2' }
    })
    expect(() =>
      applyMaestroBootstrapProjection.call(database, anchor('run-2'), conflictingRun)
    ).toThrow('conflicts')
    expect(getMaestroProjection.call(database, HOME)).toMatchObject({
      runId: 'run-1',
      workspace: { executionHostId: 'local', workspaceKey: 'folder:home-1' }
    })
    database.close()
  })
})
