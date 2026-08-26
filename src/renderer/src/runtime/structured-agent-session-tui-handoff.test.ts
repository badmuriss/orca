import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callStructuredAgentSession: vi.fn(),
  callRuntimeRpc: vi.fn(),
  getActiveRuntimeTarget: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  getState: vi.fn(),
  recordBinding: vi.fn(),
  clearBinding: vi.fn(),
  applyStructuredSessionTabSnapshots: vi.fn()
}))

vi.mock('./structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.callStructuredAgentSession
}))

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc,
  getActiveRuntimeTarget: mocks.getActiveRuntimeTarget
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: mocks.getState }
}))

vi.mock('./web-structured-tui-handoff', () => ({
  clearStructuredTuiHandoffBinding: mocks.clearBinding,
  recordStructuredTuiHandoffBinding: mocks.recordBinding
}))

vi.mock('./local-structured-session-tabs-sync', () => ({
  applyStructuredSessionTabSnapshots: mocks.applyStructuredSessionTabSnapshots
}))

import { showStructuredAgentSessionTerminal } from './structured-agent-session-tui-handoff'
import { structuredAgentSessionPayloadFingerprint } from '../../../shared/structured-agent-session-mutation'

const SESSION_ID = 'codex-session-1'
const WORKTREE_ID = 'worktree-1'
const LOCAL_TARGET = { kind: 'local' as const }
const REMOTE_TARGET = { kind: 'environment' as const, environmentId: 'ssh-runtime-1' }
const TUI_STATUS = {
  owner: 'tui' as const,
  direction: 'to-tui' as const,
  phase: 'idle' as const,
  stage: null,
  operationId: 'handoff-op-1',
  terminal: {
    handle: 'terminal-handle-1',
    tabId: 'terminal-tab-1',
    paneKey: 'terminal-tab-1:terminal-pane-1',
    ptyId: 'pty-1'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getState.mockReturnValue({})
  mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue(null)
  mocks.getActiveRuntimeTarget.mockImplementation(
    ({ activeRuntimeEnvironmentId }: { activeRuntimeEnvironmentId: string | null }) =>
      activeRuntimeEnvironmentId
        ? { kind: 'environment', environmentId: activeRuntimeEnvironmentId }
        : LOCAL_TARGET
  )
  mocks.callRuntimeRpc.mockResolvedValue({ snapshots: [] })
  mocks.recordBinding.mockImplementation(() => {})
  mocks.clearBinding.mockImplementation(() => {})
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' })
  mocks.callStructuredAgentSession.mockImplementation(async (_target: unknown, method: string) => {
    if (method === 'agentSession.history') {
      return { ok: true, page: { fence: 42 } }
    }
    if (method === 'agentSession.handoff') {
      return {
        ok: true,
        replayed: false,
        fence: 42,
        cursor: {},
        value: { status: TUI_STATUS }
      }
    }
    if (method === 'agentSession.handoffStatus') {
      return TUI_STATUS
    }
    throw new Error(`unexpected method ${method}`)
  })
})

describe('showStructuredAgentSessionTerminal', () => {
  it('proves the fence, requests a handoff, and activates the published terminal leaf', async () => {
    await expect(
      showStructuredAgentSessionTerminal({
        worktreeId: WORKTREE_ID,
        sessionId: SESSION_ID,
        target: LOCAL_TARGET
      })
    ).resolves.toEqual(TUI_STATUS)

    expect(mocks.callStructuredAgentSession).toHaveBeenNthCalledWith(
      1,
      LOCAL_TARGET,
      'agentSession.history',
      { sessionId: SESSION_ID, direction: 'tail', limit: 1 }
    )
    const expectedFingerprint = structuredAgentSessionPayloadFingerprint({
      method: 'agentSession.requestHandoff',
      sessionId: SESSION_ID,
      fields: { direction: 'to-tui', mode: 'now', action: 'start' }
    })
    expect(mocks.callStructuredAgentSession).toHaveBeenNthCalledWith(
      2,
      LOCAL_TARGET,
      'agentSession.handoff',
      {
        envelope: expect.objectContaining({
          sessionId: SESSION_ID,
          expectedRuntimeFence: 42,
          payloadFingerprint: expectedFingerprint,
          clientOperationId: expect.stringMatching(/^\d{13}-[0-9a-f]{32}$/)
        }),
        direction: 'to-tui',
        mode: 'now',
        action: 'start'
      }
    )
    expect(mocks.callStructuredAgentSession).toHaveBeenNthCalledWith(
      3,
      LOCAL_TARGET,
      'agentSession.handoffStatus',
      { sessionId: SESSION_ID }
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(LOCAL_TARGET, 'session.tabs.activate', {
      worktree: 'id:worktree-1',
      tabId: 'terminal-tab-1',
      leafId: 'terminal-pane-1'
    })
  })

  it('surfaces a provider refusal without activating a terminal', async () => {
    mocks.callStructuredAgentSession.mockImplementationOnce(async () => ({
      ok: true,
      page: { fence: 42 }
    }))
    mocks.callStructuredAgentSession.mockImplementationOnce(async () => ({
      ok: false,
      refusal: { code: 'handoff_busy', message: 'A terminal handoff is already in progress.' }
    }))

    await expect(
      showStructuredAgentSessionTerminal({
        worktreeId: WORKTREE_ID,
        sessionId: SESSION_ID,
        target: LOCAL_TARGET
      })
    ).rejects.toThrow('A terminal handoff is already in progress.')
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('keeps structured calls and terminal activation on the paired runtime', async () => {
    mocks.getRuntimeEnvironmentIdForWorktree.mockReturnValue('ssh-runtime-1')

    await expect(
      showStructuredAgentSessionTerminal({
        worktreeId: WORKTREE_ID,
        sessionId: SESSION_ID,
        target: REMOTE_TARGET
      })
    ).resolves.toEqual(TUI_STATUS)

    expect(mocks.callStructuredAgentSession).toHaveBeenNthCalledWith(
      1,
      REMOTE_TARGET,
      'agentSession.history',
      { sessionId: SESSION_ID, direction: 'tail', limit: 1 }
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      REMOTE_TARGET,
      'session.tabs.activate',
      expect.objectContaining({ worktree: 'id:worktree-1', tabId: 'terminal-tab-1' })
    )
  })

  it('binds before the refresh snapshot can project away the new terminal', async () => {
    const order: string[] = []
    mocks.recordBinding.mockImplementation(() => order.push('binding'))
    mocks.callRuntimeRpc.mockImplementation(async (_target: unknown, method: string) => {
      order.push(method)
      if (method === 'session.tabs.listAll') {
        return { snapshots: [{ worktree: WORKTREE_ID, tabs: [] }] }
      }
      return undefined
    })

    await showStructuredAgentSessionTerminal({
      worktreeId: WORKTREE_ID,
      sessionId: SESSION_ID,
      target: LOCAL_TARGET
    })

    expect(order).toEqual([
      'binding',
      'session.tabs.setTabProps',
      'session.tabs.listAll',
      'session.tabs.activate'
    ])
    expect(mocks.applyStructuredSessionTabSnapshots).toHaveBeenCalledOnce()
    expect(mocks.applyStructuredSessionTabSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ worktree: WORKTREE_ID })
    ])
  })

  it('fails closed when the resumed owner does not publish a terminal identity', async () => {
    mocks.callStructuredAgentSession.mockImplementation(
      async (_target: unknown, method: string) => {
        if (method === 'agentSession.history') {
          return { ok: true, page: { fence: 42 } }
        }
        if (method === 'agentSession.handoff') {
          return { ok: true, replayed: false, fence: 42, cursor: {}, value: { status: {} } }
        }
        return { ...TUI_STATUS, terminal: undefined }
      }
    )

    await expect(
      showStructuredAgentSessionTerminal({
        worktreeId: WORKTREE_ID,
        sessionId: SESSION_ID,
        target: LOCAL_TARGET
      })
    ).rejects.toThrow('did not publish a tab identity')
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('surfaces a failed handoff status and does not activate the old tab', async () => {
    mocks.callStructuredAgentSession.mockImplementation(
      async (_target: unknown, method: string) => {
        if (method === 'agentSession.history') {
          return { ok: true, page: { fence: 42 } }
        }
        if (method === 'agentSession.handoff') {
          return { ok: true, replayed: false, fence: 42, cursor: {}, value: { status: {} } }
        }
        return {
          owner: 'native',
          direction: 'to-tui',
          phase: 'failed',
          stage: 'launching-tui',
          operationId: 'handoff-op-1',
          error: {
            message: 'The terminal could not be started.',
            details: 'Provider launch exited before the handshake.',
            recoverableOwner: 'native'
          }
        }
      }
    )

    await expect(
      showStructuredAgentSessionTerminal({
        worktreeId: WORKTREE_ID,
        sessionId: SESSION_ID,
        target: LOCAL_TARGET
      })
    ).rejects.toThrow('Provider launch exited before the handshake.')
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
