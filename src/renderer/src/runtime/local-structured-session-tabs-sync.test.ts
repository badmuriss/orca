import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { Tab } from '../../../shared/tab-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { buildPersistedUnifiedTabSessionData } from '../lib/workspace-session-unified-tabs'
import { buildHydratedTabState } from '../store/slices/tabs-hydration'
import {
  LOCAL_STRUCTURED_SESSION_OWNER,
  projectLocalStructuredSessionTabs
} from './local-structured-session-tabs-sync'
import { applyWebSessionTabsSnapshot, type WebSessionTabsSyncState } from './web-session-tabs-sync'
import {
  recordWebSessionFocusIntent,
  resetWebSessionFocusIntentForTests
} from './web-session-focus-intent'
import {
  recordStructuredTuiHandoffBinding,
  resetStructuredTuiHandoffBindingsForTests
} from './web-structured-tui-handoff'

const WORKTREE_ID = 'repo-1::worktree-1'
const TERMINAL_ID = 'terminal-1'
const STRUCTURED_ID = 'structured-agent-session-codex-1'
const PRIMARY_GROUP = 'primary-group'
const SECONDARY_GROUP = 'secondary-group'

afterEach(() => {
  resetWebSessionFocusIntentForTests()
  resetStructuredTuiHandoffBindingsForTests()
})

function createSnapshot(): WebSessionTabsSyncState {
  const tabs: Tab[] = [
    {
      id: TERMINAL_ID,
      entityId: TERMINAL_ID,
      groupId: PRIMARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'terminal',
      label: 'Terminal',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    },
    {
      id: STRUCTURED_ID,
      entityId: 'codex-1',
      groupId: SECONDARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Codex Chat',
      customLabel: null,
      color: null,
      sortOrder: 1,
      createdAt: 2
    }
  ]
  return {
    activeBrowserTabId: null,
    activeBrowserTabIdByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeGroupIdByWorktree: { [WORKTREE_ID]: SECONDARY_GROUP },
    activeTabId: STRUCTURED_ID,
    activeTabIdByWorktree: { [WORKTREE_ID]: STRUCTURED_ID },
    activeTabType: 'agent-session',
    activeTabTypeByWorktree: { [WORKTREE_ID]: 'agent-session' },
    activeWorktreeId: WORKTREE_ID,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    browserCertificateFailuresByPageId: {},
    browserPagesByWorkspace: {},
    browserTabsByWorktree: {},
    groupsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: PRIMARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: TERMINAL_ID,
          tabOrder: [TERMINAL_ID]
        },
        {
          id: SECONDARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: STRUCTURED_ID,
          tabOrder: [STRUCTURED_ID]
        }
      ]
    },
    layoutByWorktree: {
      [WORKTREE_ID]: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: PRIMARY_GROUP },
        second: { type: 'leaf', groupId: SECONDARY_GROUP }
      }
    },
    openFiles: [],
    ptyIdsByTabId: { [TERMINAL_ID]: ['pty-1'] },
    remoteBrowserPageHandlesByPageId: {},
    tabBarOrderByWorktree: { [WORKTREE_ID]: [TERMINAL_ID, STRUCTURED_ID] },
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabsByWorktree: { [WORKTREE_ID]: tabs },
    unreadTerminalTabs: {},
    sortEpoch: 0
  }
}

function expectExactSplit(state: {
  unifiedTabsByWorktree: Record<string, Tab[]>
  groupsByWorktree: WebSessionTabsSyncState['groupsByWorktree']
  layoutByWorktree: WebSessionTabsSyncState['layoutByWorktree']
  activeGroupIdByWorktree: Record<string, string>
}): void {
  expect(state.layoutByWorktree[WORKTREE_ID]).toEqual({
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: PRIMARY_GROUP },
    second: { type: 'leaf', groupId: SECONDARY_GROUP }
  })
  expect(state.groupsByWorktree[WORKTREE_ID]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: PRIMARY_GROUP,
        activeTabId: TERMINAL_ID,
        tabOrder: [TERMINAL_ID]
      }),
      expect.objectContaining({
        id: SECONDARY_GROUP,
        activeTabId: STRUCTURED_ID,
        tabOrder: [STRUCTURED_ID]
      })
    ])
  )
  expect(state.groupsByWorktree[WORKTREE_ID]).toHaveLength(2)
  expect(state.unifiedTabsByWorktree[WORKTREE_ID]).toEqual([
    expect.objectContaining({ id: TERMINAL_ID, groupId: PRIMARY_GROUP, contentType: 'terminal' }),
    expect.objectContaining({
      id: STRUCTURED_ID,
      groupId: SECONDARY_GROUP,
      contentType: 'agent-session'
    })
  ])
  expect(state.activeGroupIdByWorktree[WORKTREE_ID]).toBe(SECONDARY_GROUP)
}

describe('local structured session tab projection', () => {
  it('drops terminal topology while retaining structured tabs', () => {
    const snapshot = {
      worktree: 'workspace-1',
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session',
      tabGroups: [
        {
          id: 'terminal-group',
          activeTabId: 'terminal-1',
          tabOrder: ['terminal-1']
        },
        {
          id: 'structured-group',
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabGroupLayout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: 'terminal-group' },
        second: { type: 'leaf', groupId: 'structured-group' }
      },
      tabs: [
        {
          type: 'terminal',
          id: 'terminal-1',
          parentTabId: 'terminal-1',
          leafId: 'leaf-1',
          title: 'Terminal',
          status: 'ready',
          terminal: 'term-1',
          ptyId: 'pty-1',
          isActive: false
        },
        {
          type: 'agent-session',
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex',
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    expect(projectLocalStructuredSessionTabs(snapshot)).toMatchObject({
      tabGroups: [
        {
          id: 'structured-group',
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabGroupLayout: undefined,
      tabs: [expect.objectContaining({ type: 'agent-session', agent: 'codex' })]
    })
  })

  it('keeps only the handoff-bound terminal surface beside the structured tab', () => {
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session' as const,
      tabs: [
        {
          type: 'terminal' as const,
          id: TERMINAL_ID,
          parentTabId: TERMINAL_ID,
          leafId: 'leaf-1',
          title: 'Codex TUI',
          status: 'ready' as const,
          terminal: 'term-1',
          isActive: false
        },
        {
          type: 'agent-session' as const,
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex' as const,
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult
    recordStructuredTuiHandoffBinding({
      environmentId: LOCAL_STRUCTURED_SESSION_OWNER,
      worktreeId: WORKTREE_ID,
      hostTabId: TERMINAL_ID,
      sessionId: 'codex-1',
      agent: 'codex'
    })

    expect(projectLocalStructuredSessionTabs(snapshot).tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'terminal', parentTabId: TERMINAL_ID }),
        expect.objectContaining({ type: 'agent-session', sessionId: 'codex-1' })
      ])
    )
  })

  it('re-admits a terminal published before the renderer learned its handoff binding', () => {
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: `${TERMINAL_ID}::leaf-1`,
      activeTabType: 'terminal' as const,
      tabs: [
        {
          type: 'terminal' as const,
          id: `${TERMINAL_ID}::leaf-1`,
          parentTabId: TERMINAL_ID,
          leafId: 'leaf-1',
          title: 'Codex TUI',
          status: 'ready' as const,
          terminal: 'term-1',
          isActive: true
        },
        {
          type: 'agent-session' as const,
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex' as const,
          isActive: false
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    expect(projectLocalStructuredSessionTabs(snapshot).tabs).toEqual([
      expect.objectContaining({ type: 'agent-session', sessionId: 'codex-1' })
    ])

    recordStructuredTuiHandoffBinding({
      environmentId: LOCAL_STRUCTURED_SESSION_OWNER,
      worktreeId: WORKTREE_ID,
      hostTabId: TERMINAL_ID,
      sessionId: 'codex-1',
      agent: 'codex'
    })

    expect(projectLocalStructuredSessionTabs(snapshot)).toMatchObject({
      activeTabId: `${TERMINAL_ID}::leaf-1`,
      activeTabType: 'terminal',
      tabs: expect.arrayContaining([
        expect.objectContaining({ type: 'terminal', parentTabId: TERMINAL_ID }),
        expect.objectContaining({ type: 'agent-session', sessionId: 'codex-1' })
      ])
    })
  })

  it('retains host group topology for a handoff-bound terminal surface', () => {
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session' as const,
      tabGroups: [
        {
          id: 'terminal-group',
          activeTabId: TERMINAL_ID,
          tabOrder: [TERMINAL_ID]
        },
        {
          id: 'structured-group',
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabs: [
        {
          type: 'terminal' as const,
          id: `${TERMINAL_ID}::leaf-1`,
          parentTabId: TERMINAL_ID,
          leafId: 'leaf-1',
          title: 'Codex TUI',
          status: 'ready' as const,
          terminal: 'term-1',
          isActive: false
        },
        {
          type: 'agent-session' as const,
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex' as const,
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult
    recordStructuredTuiHandoffBinding({
      environmentId: LOCAL_STRUCTURED_SESSION_OWNER,
      worktreeId: WORKTREE_ID,
      hostTabId: TERMINAL_ID,
      sessionId: 'codex-1',
      agent: 'codex'
    })

    expect(projectLocalStructuredSessionTabs(snapshot).tabGroups).toEqual([
      {
        id: 'terminal-group',
        activeTabId: TERMINAL_ID,
        tabOrder: [TERMINAL_ID]
      },
      {
        id: 'structured-group',
        activeTabId: 'agent-session:codex-1',
        tabOrder: ['agent-session:codex-1']
      }
    ])
  })

  it('normalizes a stale structured active marker when the bound TUI surface is active', () => {
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 1,
      activeGroupId: 'structured-group',
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session' as const,
      tabGroups: [
        {
          id: 'structured-group',
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabs: [
        {
          type: 'terminal' as const,
          id: `${TERMINAL_ID}::leaf-1`,
          parentTabId: TERMINAL_ID,
          leafId: 'leaf-1',
          title: 'Codex TUI',
          status: 'ready' as const,
          terminal: 'term-1',
          isActive: true
        },
        {
          type: 'agent-session' as const,
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex' as const,
          isActive: false
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult
    recordStructuredTuiHandoffBinding({
      environmentId: LOCAL_STRUCTURED_SESSION_OWNER,
      worktreeId: WORKTREE_ID,
      hostTabId: TERMINAL_ID,
      sessionId: 'codex-1',
      agent: 'codex'
    })

    expect(projectLocalStructuredSessionTabs(snapshot)).toMatchObject({
      activeTabId: `${TERMINAL_ID}::leaf-1`,
      activeTabType: 'terminal',
      activeGroupId: 'structured-group',
      tabGroups: [
        {
          id: 'structured-group',
          activeTabId: TERMINAL_ID,
          tabOrder: ['agent-session:codex-1', TERMINAL_ID]
        }
      ]
    })
  })

  it('preserves the exact local split through apply, persistence, and hydration', () => {
    const state = createSnapshot()
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 2,
      activeGroupId: SECONDARY_GROUP,
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session',
      tabGroups: [
        { id: PRIMARY_GROUP, activeTabId: TERMINAL_ID, tabOrder: [TERMINAL_ID] },
        {
          id: SECONDARY_GROUP,
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabGroupLayout: state.layoutByWorktree[WORKTREE_ID],
      tabs: [
        {
          type: 'terminal',
          id: TERMINAL_ID,
          parentTabId: TERMINAL_ID,
          leafId: 'leaf-1',
          title: 'Terminal',
          status: 'ready',
          terminal: 'term-1',
          ptyId: 'pty-1',
          isActive: false
        },
        {
          type: 'agent-session',
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex',
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    const projected = projectLocalStructuredSessionTabs(snapshot)
    const patch = applyWebSessionTabsSnapshot(
      state,
      projected,
      'local-structured-session',
      1_700_000_000_000,
      { preserveLocalLayout: true }
    )
    const applied = { ...state, ...patch } as WebSessionTabsSyncState

    expectExactSplit(applied)

    const session: WorkspaceSessionState = {
      activeRepoId: null,
      activeWorktreeId: WORKTREE_ID,
      activeTabId: STRUCTURED_ID,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      ...buildPersistedUnifiedTabSessionData(applied)
    }
    const hydrated = buildHydratedTabState(session, new Set([WORKTREE_ID]))

    expectExactSplit(hydrated)
  })

  it('honors the focus intent for a newly published local structured tab', () => {
    const initial = createSnapshot()
    const state: WebSessionTabsSyncState = {
      ...initial,
      activeGroupIdByWorktree: { [WORKTREE_ID]: PRIMARY_GROUP },
      activeTabId: TERMINAL_ID,
      activeTabIdByWorktree: { [WORKTREE_ID]: TERMINAL_ID },
      activeTabType: 'terminal',
      activeTabTypeByWorktree: { [WORKTREE_ID]: 'terminal' },
      groupsByWorktree: {
        [WORKTREE_ID]: initial.groupsByWorktree[WORKTREE_ID]!.map((group) =>
          group.id === PRIMARY_GROUP ? { ...group, activeTabId: TERMINAL_ID } : group
        )
      }
    }
    const snapshot = {
      worktree: WORKTREE_ID,
      publicationEpoch: 'structured:epoch-1',
      snapshotVersion: 1,
      activeGroupId: SECONDARY_GROUP,
      activeTabId: 'agent-session:codex-1',
      activeTabType: 'agent-session' as const,
      tabGroups: [
        { id: PRIMARY_GROUP, activeTabId: TERMINAL_ID, tabOrder: [TERMINAL_ID] },
        {
          id: SECONDARY_GROUP,
          activeTabId: 'agent-session:codex-1',
          tabOrder: ['agent-session:codex-1']
        }
      ],
      tabs: [
        {
          type: 'agent-session' as const,
          id: 'agent-session:codex-1',
          title: 'Codex Chat',
          sessionId: 'codex-1',
          agent: 'codex' as const,
          isActive: true
        }
      ]
    } satisfies RuntimeMobileSessionTabsResult

    recordWebSessionFocusIntent(
      { environmentId: 'local-structured-session' },
      WORKTREE_ID,
      'agent-session:codex-1',
      undefined,
      TERMINAL_ID
    )
    const patch = applyWebSessionTabsSnapshot(
      state,
      snapshot,
      'local-structured-session',
      1_700_000_000_000,
      { preserveLocalLayout: true }
    )
    const applied = { ...state, ...patch } as WebSessionTabsSyncState

    expect(applied.activeTabIdByWorktree[WORKTREE_ID]).toBe(STRUCTURED_ID)
    expect(applied.activeTabTypeByWorktree[WORKTREE_ID]).toBe('agent-session')
    expect(applied.groupsByWorktree[WORKTREE_ID]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: SECONDARY_GROUP, activeTabId: STRUCTURED_ID })
      ])
    )
  })
})
