import { describe, expect, it } from 'vitest'
import {
  createWorkspaceBootstrapReceipt,
  isWorkspaceBootstrapReceipt,
  parseWorkspaceBootstrapReceipt,
  workspaceIdentity
} from './workspace-bootstrap-receipt'

describe('workspace bootstrap receipt', () => {
  it('keeps separate home and execution identities with opaque keys', () => {
    const receipt = createWorkspaceBootstrapReceipt({
      repository_id: 'repo-1',
      canonical_root: '/srv/orchestration',
      execution_host: { id: 'ssh:box%3A22', boundary: 'remote' },
      orchestration_home: workspaceIdentity({
        executionHostId: 'runtime:local',
        workspaceKey: 'runtime:home-id',
        kind: 'folder',
        path: '/srv/orchestration'
      }),
      execution_workspace: workspaceIdentity({
        executionHostId: 'ssh:box%3A22',
        workspaceKey: 'ssh:workspace%3Aopaque',
        kind: 'git-worktree',
        path: '/srv/work',
        worktreePath: '/srv/work'
      }),
      base_revision: 'abc123',
      dirty_paths: ['src/file.ts'],
      issued_for_run_id: 'run-1'
    })
    expect(Object.keys(receipt)).toEqual([
      'schema_version',
      'repository_id',
      'canonical_root',
      'execution_host',
      'orchestration_home',
      'execution_workspace',
      'base_revision',
      'dirty_paths',
      'authority'
    ])
    expect(parseWorkspaceBootstrapReceipt(receipt)).toEqual(receipt)
    expect(isWorkspaceBootstrapReceipt(receipt)).toBe(true)
    expect(isWorkspaceBootstrapReceipt({ ...receipt, canonical_root: '/srv/other' })).toBe(false)
    expect(
      isWorkspaceBootstrapReceipt({
        ...receipt,
        execution_workspace: { ...receipt.execution_workspace, execution_host_id: 'runtime:other' }
      })
    ).toBe(false)
    expect(isWorkspaceBootstrapReceipt({ ...receipt, dirty_paths: ['/src/file.ts'] })).toBe(false)
    expect(
      isWorkspaceBootstrapReceipt({
        ...receipt,
        execution_workspace: { ...receipt.execution_workspace, worktree_path: '/srv/other' }
      })
    ).toBe(false)
  })

  it('rejects extra receipt fields and folder worktree paths', () => {
    expect(
      isWorkspaceBootstrapReceipt({
        schema_version: 1,
        repository_id: 'repo',
        canonical_root: '/repo',
        execution_host: { id: 'runtime:local', boundary: 'local' },
        orchestration_home: {
          execution_host_id: 'local',
          workspace_key: 'folder:f',
          kind: 'folder',
          path: '/repo',
          worktree_path: '/repo'
        },
        execution_workspace: {
          execution_host_id: 'local',
          workspace_key: 'folder:f',
          kind: 'folder',
          path: '/repo'
        },
        base_revision: 'head',
        dirty_paths: [],
        authority: { kind: 'orca', scope: 'run', issued_for_run_id: 'run' },
        extra: true
      })
    ).toBe(false)
  })

  it('rejects duplicate dirty paths and preserves opaque identifiers', () => {
    const receipt = {
      schema_version: 1,
      repository_id: 'repo-1',
      canonical_root: 'C:\\orca',
      execution_host: { id: 'ssh:host%3A22', boundary: 'remote' },
      orchestration_home: {
        execution_host_id: 'runtime:win32',
        workspace_key: 'runtime:home',
        kind: 'folder',
        path: 'C:\\orca'
      },
      execution_workspace: {
        execution_host_id: 'ssh:host%3A22',
        workspace_key: 'ssh:workspace',
        kind: 'folder',
        path: 'D:\\work'
      },
      base_revision: 'head',
      dirty_paths: ['src/file.ts', 'src/file.ts'],
      authority: { kind: 'orca', scope: 'run', issued_for_run_id: 'run-1' }
    }
    expect(isWorkspaceBootstrapReceipt(receipt)).toBe(false)
    expect(
      parseWorkspaceBootstrapReceipt({ ...receipt, dirty_paths: ['src/file.ts'] })
    ).toMatchObject({
      execution_host: { id: 'ssh:host%3A22' },
      orchestration_home: { execution_host_id: 'runtime:win32' },
      execution_workspace: { execution_host_id: 'ssh:host%3A22', workspace_key: 'ssh:workspace' }
    })
  })

  it('accepts the host-run authority shape with its required bindings', () => {
    const runId = 'host-run-12345678-1234-4123-8123-123456789abc'
    const receipt = createWorkspaceBootstrapReceipt({
      repository_id: runId,
      canonical_root: '/srv/orchestration',
      execution_host: { id: 'runtime:local', boundary: 'local' },
      orchestration_home: workspaceIdentity({
        executionHostId: 'runtime:local',
        workspaceKey: `folder:${runId}`,
        kind: 'folder',
        path: '/srv/orchestration'
      }),
      execution_workspace: workspaceIdentity({
        executionHostId: 'runtime:local',
        workspaceKey: `folder:${runId}`,
        kind: 'folder',
        path: '/srv/orchestration'
      }),
      base_revision: 'head',
      dirty_paths: [],
      issued_for_run_id: runId,
      authorityKind: 'host-run'
    })
    expect(receipt.authority.kind).toBe('host-run')
    expect(
      isWorkspaceBootstrapReceipt({
        ...receipt,
        execution_workspace: { ...receipt.execution_workspace, path: '/srv/other' }
      })
    ).toBe(false)
    expect(
      isWorkspaceBootstrapReceipt({
        ...receipt,
        orchestration_home: { ...receipt.orchestration_home, workspace_key: 'folder:another-run' }
      })
    ).toBe(false)
  })
})
