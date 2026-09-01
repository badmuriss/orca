import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitExecFileAsync } from '../../../../src/main/git/runner'
import { settleRunOwnedChildWorktrees } from '../../../../src/main/runtime/orchestration/run-owned-child-worktree-settlement'
import { collectRunOwnedChildWorktrees } from '../../../../src/shared/runtime-worktree-contracts'
import type { RuntimeWorktreePsSummary } from '../../../../src/shared/runtime-worktree-contracts'

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await gitExecFileAsync(args, { cwd })).stdout.trim()
}

export async function exerciseSettledChildWorktreeCleanup(): Promise<{
  selectedWorktreeCount: number
  firstDisposition: string
  replayDisposition: string
  childAbsent: boolean
  branchPreserved: boolean
}> {
  const root = mkdtempSync(join(tmpdir(), 'orca-omr-cleanup-'))
  const repoPath = join(root, 'repo')
  const childPath = join(root, 'child')
  mkdirSync(repoPath)
  await git(repoPath, 'init')
  await git(repoPath, 'config', 'user.email', 'omr@example.test')
  await git(repoPath, 'config', 'user.name', 'OMR fixture')
  writeFileSync(join(repoPath, 'README.md'), 'bounded cleanup fixture\n')
  await git(repoPath, 'add', 'README.md')
  await git(repoPath, 'commit', '-m', 'fixture')
  await git(repoPath, 'worktree', 'add', '-b', 'omr-child', childPath)

  const worktreeId = `omr-fixture::${childPath}`
  const owned = collectRunOwnedChildWorktrees([
    {
      effects: JSON.stringify([
        {
          kind: 'worktree',
          action: 'created_child',
          id: worktreeId,
          executionHostId: 'local',
          worktreeInstanceId: 'omr-fixture-instance'
        },
        { kind: 'worktree', action: 'created_top_level', id: 'omr-fixture::top' },
        { kind: 'worktree', action: 'reused', id: 'omr-fixture::reused' },
        { kind: 'folder', action: 'created_child', id: 'folder::foreign' }
      ])
    }
  ])
  let orcaRegistered = true

  const assertAbsent = async (): Promise<void> => {
    const gitRegistered = (await git(repoPath, 'worktree', 'list', '--porcelain')).includes(
      childPath
    )
    if (existsSync(childPath) || gitRegistered || orcaRegistered) {
      throw new Error('The checkout remains present in filesystem, Git, or Orca state.')
    }
  }
  const processEvidence = {
    queriedHostIds: new Set(['local' as const]),
    summaries: [
      {
        worktreeId,
        hostId: 'local',
        worktreeInstanceId: 'omr-fixture-instance',
        status: 'inactive',
        agents: [],
        liveTerminalCount: 1,
        hasAttachedPty: true
      } as RuntimeWorktreePsSummary
    ]
  }

  try {
    const selected = owned.worktrees[0]
    if (!selected || selected.worktreeId !== worktreeId || selected.executionHostId !== 'local') {
      throw new Error('The durable Run effect did not select the exact host-qualified child.')
    }
    const first = await settleRunOwnedChildWorktrees({
      runId: 'run-omr-cleanup',
      worktrees: owned.worktrees,
      unreadableEffectRows: owned.unreadableEffectRows,
      processEvidence,
      authority: {
        assertAbsent,
        retentionCause: () => undefined,
        remove: async () => {
          await git(repoPath, 'worktree', 'remove', '--force', childPath)
          orcaRegistered = false
          return { wasRegistered: true, reportedOk: false }
        }
      }
    })
    await assertAbsent()
    const replay = await settleRunOwnedChildWorktrees({
      runId: 'run-omr-cleanup',
      worktrees: owned.worktrees,
      unreadableEffectRows: owned.unreadableEffectRows,
      processEvidence: { ...processEvidence, summaries: [] },
      authority: {
        assertAbsent,
        retentionCause: () => undefined,
        remove: async () => {
          throw new Error('Replay must not repeat checkout removal.')
        }
      }
    })
    return {
      selectedWorktreeCount: owned.worktrees.length,
      firstDisposition: first.worktrees[0]?.disposition ?? 'pending',
      replayDisposition: replay.worktrees[0]?.disposition ?? 'pending',
      childAbsent: true,
      branchPreserved: (await git(repoPath, 'branch', '--list', 'omr-child')) === 'omr-child'
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
