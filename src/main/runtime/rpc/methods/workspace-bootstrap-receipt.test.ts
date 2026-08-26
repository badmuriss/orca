import { describe, expect, it, vi } from 'vitest'
import { issueWorkspaceBootstrapReceipt } from './workspace-bootstrap-receipt'
import { OrcaRuntimeService } from '../../orca-runtime'

function runtimeWith(
  worktreesBySelector: Record<string, { id: string; repoId: string; path: string; hostId: string }>,
  status: { head: string | null; entries: { path: string }[] } | (() => never)
): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockImplementation(async (selector) => {
    const worktree = worktreesBySelector[selector]
    if (!worktree) {
      throw new Error(`selector_not_found: ${selector}`)
    }
    return worktree as never
  })
  vi.spyOn(runtime, 'getRuntimeGitStatus').mockImplementation(async () => {
    if (typeof status === 'function') {
      return status()
    }
    return status as never
  })
  return runtime
}

describe('issueWorkspaceBootstrapReceipt', () => {
  it('rejects a request with no validated run ID', async () => {
    const runtime = runtimeWith({}, { head: 'abc123', entries: [] })
    await expect(
      issueWorkspaceBootstrapReceipt(runtime, {
        runId: '',
        orchestrationHomeSelector: 'id:home',
        executionWorkspaceSelector: 'id:home',
        executionHostId: 'local'
      })
    ).rejects.toThrow('validated run ID')
  })

  it('preserves the exact folder:<id> workspace_key and derives repository_id from it, not by id-equality guessing', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'folder:folder-1',
          repoId: 'folder-workspace:pg-1',
          path: '/home/user/projects/folder-1',
          hostId: 'local'
        }
      },
      { head: 'abc123def', entries: [] }
    )

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:home',
      executionHostId: 'local'
    })

    expect(receipt.repository_id).toBe('folder-1')
    expect(receipt.orchestration_home).toMatchObject({
      kind: 'folder',
      workspace_key: 'folder:folder-1',
      path: '/home/user/projects/folder-1'
    })
    expect(receipt.orchestration_home.worktree_path).toBeUndefined()
    expect(receipt.canonical_root).toBe('/home/user/projects/folder-1')
    expect(receipt.execution_host).toEqual({ id: 'local', boundary: 'local' })
    expect(receipt.authority).toEqual({ kind: 'orca', scope: 'run', issued_for_run_id: 'run-1' })
  })

  it('preserves the exact worktree:<repoId>::<path> workspace_key for a git worktree', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        }
      },
      { head: 'deadbeef', entries: [] }
    )

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:home',
      executionHostId: 'local'
    })

    expect(receipt.repository_id).toBe('repo-1')
    expect(receipt.orchestration_home).toMatchObject({
      kind: 'git-worktree',
      workspace_key: 'worktree:repo-1::worktree-1',
      path: '/home/user/repos/repo-1/worktree-1',
      worktree_path: '/home/user/repos/repo-1/worktree-1'
    })
  })

  it('keeps a Windows canonical_root path intact', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: 'C:\\Users\\dev\\repo-1\\worktree-1',
          hostId: 'local'
        }
      },
      { head: 'deadbeef', entries: [] }
    )

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:home',
      executionHostId: 'local'
    })

    expect(receipt.canonical_root).toBe('C:\\Users\\dev\\repo-1\\worktree-1')
  })

  it('keeps a local orchestration home distinct from a remote SSH execution workspace, reading status from the remote selector', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        },
        'id:remote': {
          id: 'repo-2::remote-worktree',
          repoId: 'repo-2',
          path: '/home/remote/repo-2/remote-worktree',
          hostId: 'ssh:target-1'
        }
      },
      { head: 'cafef00d', entries: [] }
    )
    const statusSpy = vi.mocked(runtime.getRuntimeGitStatus)

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:remote',
      executionHostId: 'ssh:target-1'
    })

    expect(receipt.orchestration_home.workspace_key).toBe('worktree:repo-1::worktree-1')
    expect(receipt.execution_workspace.workspace_key).toBe('worktree:repo-2::remote-worktree')
    expect(receipt.execution_host).toEqual({ id: 'ssh:target-1', boundary: 'remote' })
    expect(receipt.orchestration_home).not.toEqual(receipt.execution_workspace)
    // Why: the git-status probe must run against the remote execution
    // workspace's own selector, never against the (distinct) local home.
    expect(statusSpy).toHaveBeenCalledExactlyOnceWith('id:remote')
  })

  it('treats a runtime-owned peer host as remote, not just ssh hosts', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        },
        'id:peer': {
          id: 'repo-3::peer-worktree',
          repoId: 'repo-3',
          path: '/home/peer/repo-3/peer-worktree',
          hostId: 'runtime:11111111-1111-4111-8111-111111111111'
        }
      },
      { head: 'cafef00d', entries: [] }
    )

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:peer',
      executionHostId: 'runtime:11111111-1111-4111-8111-111111111111'
    })

    expect(receipt.execution_host).toEqual({
      id: 'runtime:11111111-1111-4111-8111-111111111111',
      boundary: 'remote'
    })
  })

  it('rejects an orchestration home that resolves to a remote host', async () => {
    const runtime = runtimeWith(
      {
        'id:remote-home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/remote/repo-1/worktree-1',
          hostId: 'ssh:target-1'
        }
      },
      { head: 'cafef00d', entries: [] }
    )

    await expect(
      issueWorkspaceBootstrapReceipt(runtime, {
        runId: 'run-1',
        orchestrationHomeSelector: 'id:remote-home',
        executionWorkspaceSelector: 'id:remote-home',
        executionHostId: 'ssh:target-1'
      })
    ).rejects.toThrow('orchestration-home workspace must be local')
  })

  it('rejects a caller-supplied executionHostId that mismatches the resolved host, without probing status', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        },
        'id:remote': {
          id: 'repo-2::remote-worktree',
          repoId: 'repo-2',
          path: '/home/remote/repo-2/remote-worktree',
          hostId: 'ssh:target-1'
        }
      },
      { head: 'cafef00d', entries: [] }
    )
    const statusSpy = vi.mocked(runtime.getRuntimeGitStatus)

    await expect(
      issueWorkspaceBootstrapReceipt(runtime, {
        runId: 'run-1',
        orchestrationHomeSelector: 'id:home',
        executionWorkspaceSelector: 'id:remote',
        // Why: caller expects a different host (stale cache, wrong target)
        // than what the host itself actually resolves for this selector.
        executionHostId: 'ssh:wrong-target'
      })
    ).rejects.toThrow('Execution host mismatch')
    expect(statusSpy).not.toHaveBeenCalled()
  })

  it('sorts and dedupes dirty_paths for a deterministic receipt', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        }
      },
      {
        head: 'cafef00d',
        entries: [{ path: 'src/z.ts' }, { path: 'src/a.ts' }, { path: 'src/a.ts' }]
      }
    )

    const receipt = await issueWorkspaceBootstrapReceipt(runtime, {
      runId: 'run-1',
      orchestrationHomeSelector: 'id:home',
      executionWorkspaceSelector: 'id:home',
      executionHostId: 'local'
    })

    expect(receipt.dirty_paths).toEqual(['src/a.ts', 'src/z.ts'])
  })

  it('fails typed instead of fabricating a snapshot when the execution host is unobservable', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        }
      },
      () => {
        throw new Error('SSH Git provider is not registered for this connection')
      }
    )

    await expect(
      issueWorkspaceBootstrapReceipt(runtime, {
        runId: 'run-1',
        orchestrationHomeSelector: 'id:home',
        executionWorkspaceSelector: 'id:home',
        executionHostId: 'local'
      })
    ).rejects.toThrow('Could not observe Git status')
  })

  it('fails typed when the execution workspace has no committed HEAD', async () => {
    const runtime = runtimeWith(
      {
        'id:home': {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: '/home/user/repos/repo-1/worktree-1',
          hostId: 'local'
        }
      },
      { head: null, entries: [] }
    )

    await expect(
      issueWorkspaceBootstrapReceipt(runtime, {
        runId: 'run-1',
        orchestrationHomeSelector: 'id:home',
        executionWorkspaceSelector: 'id:home',
        executionHostId: 'local'
      })
    ).rejects.toThrow('no committed HEAD')
  })
})
