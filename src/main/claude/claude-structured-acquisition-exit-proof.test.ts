import { describe, expect, it, vi } from 'vitest'

import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import type {
  ClaudeStreamJsonConnection,
  ClaudeStreamJsonConnectionHandlers,
  openClaudeStreamJsonConnection
} from './claude-stream-json-connection'
import { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'

const PROVIDER_SESSION_ID = '819cf9f8-e43c-4ad7-b50f-54aa158a726a'
const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  agent: 'claude',
  providerHandle: { kind: 'claude', sessionId: PROVIDER_SESSION_ID, leafUuid: null }
}

function openConnectionWithExitProof(
  close: () => Promise<boolean>
): typeof openClaudeStreamJsonConnection {
  return async (_launch, handlers: ClaudeStreamJsonConnectionHandlers = {}) => {
    const connection: ClaudeStreamJsonConnection = {
      pid: 4321,
      closed: false,
      send: async () => undefined,
      request: async (subtype) => {
        if (subtype === 'initialize') {
          handlers.onMessage?.({
            type: 'system',
            subtype: 'init',
            session_id: PROVIDER_SESSION_ID,
            uuid: 'init-uuid',
            model: 'claude-sonnet-5',
            effortLevel: 'high',
            apiKeySource: 'none'
          })
          return { models: [] }
        }
        return {}
      },
      respond: async () => undefined,
      respondWithError: async () => undefined,
      close
    }
    return connection
  }
}

function adapter(
  close: () => Promise<boolean>,
  readProcessStartTime: (pid: number) => Promise<number | null>
): ClaudeStructuredSessionAdapter {
  return new ClaudeStructuredSessionAdapter({
    resolveLaunch: async () => ({
      command: 'claude',
      args: ['-p'],
      cwd: '/work/repo',
      claudeConfigDir: '/accounts/claude',
      providerSessionId: PROVIDER_SESSION_ID,
      resumeLeafUuid: null,
      resumed: false
    }),
    openConnection: openConnectionWithExitProof(close),
    proveTranscriptCursor: async () => 'transcript-leaf',
    readProcessStartTime
  })
}

describe('Claude failed-acquisition exit proof', () => {
  it('retains an uncommitted child until a later close proves exit', async () => {
    const close = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const sessionAdapter = adapter(close, async () => null)

    await expect(
      sessionAdapter.acquire({ identity: IDENTITY, fence: 7, spawnToken: 'spawn-9' })
    ).rejects.toThrow('agent_session_acquisition_exit_unproven')
    await expect(sessionAdapter.releaseAcquisition({ sessionId: 'session-1' })).resolves.toBe(true)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('keeps closeAll blocked by an unproven canceled acquisition', async () => {
    const processStart = Promise.withResolvers<number | null>()
    const readStarted = Promise.withResolvers<void>()
    const close = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const sessionAdapter = adapter(close, () => {
      readStarted.resolve()
      return processStart.promise
    })
    const acquiring = sessionAdapter.acquire({
      identity: IDENTITY,
      fence: 7,
      spawnToken: 'spawn-9'
    })
    await readStarted.promise

    await expect(sessionAdapter.closeAll()).rejects.toThrow(
      'claude structured session shutdown could not prove every child stopped'
    )
    processStart.resolve(null)
    await expect(acquiring).rejects.toThrow('agent_session_acquisition_exit_unproven')
    expect(close).toHaveBeenCalledTimes(4)
  })

  it('retains a child that opens after closeAll starts when exit remains unproven', async () => {
    const openStarted = Promise.withResolvers<void>()
    const releaseOpen = Promise.withResolvers<void>()
    const close = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const baseOpen = openConnectionWithExitProof(close)
    const sessionAdapter = new ClaudeStructuredSessionAdapter({
      resolveLaunch: async () => ({
        command: 'claude',
        args: ['-p'],
        cwd: '/work/repo',
        claudeConfigDir: '/accounts/claude',
        providerSessionId: PROVIDER_SESSION_ID,
        resumeLeafUuid: null,
        resumed: false
      }),
      openConnection: async (...args) => {
        openStarted.resolve()
        await releaseOpen.promise
        return baseOpen(...args)
      },
      proveTranscriptCursor: async () => 'transcript-leaf',
      readProcessStartTime: async () => 1_700_000_000_000
    })
    const acquiring = sessionAdapter.acquire({
      identity: IDENTITY,
      fence: 7,
      spawnToken: 'spawn-9'
    })
    await openStarted.promise

    const closing = sessionAdapter.closeAll()
    releaseOpen.resolve()

    await expect(closing).rejects.toThrow(
      'claude structured session shutdown could not prove every child stopped'
    )
    await expect(acquiring).rejects.toThrow('agent_session_acquisition_exit_unproven')
    expect(close).toHaveBeenCalledTimes(4)
  })
})
