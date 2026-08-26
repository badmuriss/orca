import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyWebSessionTabsSnapshot, type WebSessionTabsSyncState } from './web-session-tabs-sync'
import {
  ENV,
  LEAF_ID,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'
import {
  recordStructuredTuiHandoffBinding,
  resetStructuredTuiHandoffBindingsForTests
} from './web-structured-tui-handoff'

vi.mock('../store', () => ({
  useAppStore: {
    setState: vi.fn()
  }
}))

describe('structured-created TUI terminal projection', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  it('projects the original structured session binding and forces terminal mode on first paint', () => {
    recordStructuredTuiHandoffBinding({
      environmentId: ENV,
      worktreeId: WT,
      hostTabId: 'host-tab-1',
      sessionId: 'codex-thread-1',
      agent: 'codex'
    })

    const patch = applyWebSessionTabsSnapshot(
      makeState(),
      makeSnapshot([
        {
          type: 'terminal',
          id: `host-tab-1::${LEAF_ID}`,
          title: 'Codex',
          parentTabId: 'host-tab-1',
          leafId: LEAF_ID,
          status: 'ready',
          terminal: 'terminal-1',
          viewMode: 'chat',
          isActive: true
        }
      ]),
      ENV,
      NOW
    )

    const tab = patch.unifiedTabsByWorktree?.[WT]?.find(
      (candidate) => candidate.contentType === 'terminal'
    )
    expect(tab).toMatchObject({
      structuredSessionId: 'codex-thread-1',
      agentSessionAgent: 'codex',
      viewMode: 'terminal'
    })
  })

  it('preserves the binding on later snapshots after the transient handoff record is gone', () => {
    recordStructuredTuiHandoffBinding({
      environmentId: ENV,
      worktreeId: WT,
      hostTabId: 'host-tab-1',
      sessionId: 'codex-thread-1',
      agent: 'codex'
    })
    const surface = {
      type: 'terminal' as const,
      id: `host-tab-1::${LEAF_ID}`,
      title: 'Codex',
      parentTabId: 'host-tab-1',
      leafId: LEAF_ID,
      status: 'ready' as const,
      terminal: 'terminal-1',
      viewMode: 'terminal' as const,
      isActive: true
    }
    const initial = makeState()
    const firstPatch = applyWebSessionTabsSnapshot(initial, makeSnapshot([surface]), ENV, NOW)
    const afterFirst = { ...initial, ...firstPatch } as WebSessionTabsSyncState
    resetStructuredTuiHandoffBindingsForTests()

    const secondPatch = applyWebSessionTabsSnapshot(
      afterFirst,
      makeSnapshot([surface], { snapshotVersion: 2 }),
      ENV,
      NOW + 1
    )

    expect(secondPatch.unifiedTabsByWorktree?.[WT]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          structuredSessionId: 'codex-thread-1',
          agentSessionAgent: 'codex',
          viewMode: 'terminal'
        })
      ])
    )
  })
})
