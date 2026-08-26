import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStructuredAgentSessionOperationId } from '../../shared/structured-agent-session-mutation'
import type * as SessionFileResolver from '../native-chat/session-file-resolver'
import { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { ClaudeTranscriptTailIncompleteError } from '../claude/claude-transcript-branch-proof'
import { AgentSessionRecordStore } from './agent-session-record-store'
import { agentSessionPtyWriteGate } from './agent-session-pty-write-gate'
import { createStructuredAgentSessionOwnerProbe } from './structured-agent-session-runtime'
import { OrcaRuntimeService } from './orca-runtime'

const { readStructuredTuiProcessIdentity } = vi.hoisted(() => ({
  readStructuredTuiProcessIdentity: vi.fn()
}))
const { readClaudeTranscriptLeafUuid, resolveSessionFilePath } = vi.hoisted(() => ({
  readClaudeTranscriptLeafUuid:
    vi.fn<
      (
        transcriptPath: string,
        providerSessionId: string,
        previousLeafUuid?: string | null
      ) => Promise<string>
    >(),
  resolveSessionFilePath: vi.fn<typeof SessionFileResolver.resolveSessionFilePath>()
}))
vi.mock('./structured-tui-process-identity', () => ({ readStructuredTuiProcessIdentity }))
vi.mock('../native-chat/session-file-resolver', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionFileResolver>()),
  readClaudeTranscriptLeafUuid,
  resolveSessionFilePath
}))

const WORKTREE_ID = 'repo-claude::/tmp/claude-adoption'
const PTY_ID = 'pty-claude-adopt'
const PANE_KEY = 'tab-claude-adopt:leaf-claude-adopt'
const PROVIDER_SESSION_ID = 'claude-session-adopt'
const LEAF_UUID = 'leaf-current'
const SESSION_ID = 'orca-claude-adopt'

let root: string
let accountHome: string
let transcriptPath: string
let rows: AgentStatusIpcPayload[]
let runtime: OrcaRuntimeService
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost

async function writeTranscript(leafUuid = LEAF_UUID): Promise<void> {
  await mkdir(join(accountHome, 'projects', 'repo'), { recursive: true })
  const records = leafUuid
    ? [
        {
          type: 'assistant',
          uuid: leafUuid,
          parentUuid: null,
          sessionId: PROVIDER_SESSION_ID
        },
        { type: 'last-prompt', leafUuid, sessionId: PROVIDER_SESSION_ID }
      ]
    : [{ type: 'last-prompt', leafUuid, sessionId: PROVIDER_SESSION_ID }]
  await writeFile(
    transcriptPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8'
  )
}

function providerRow(overrides: Partial<AgentStatusIpcPayload> = {}): AgentStatusIpcPayload {
  return {
    paneKey: PANE_KEY,
    agentType: 'claude',
    connectionId: null,
    receivedAt: Date.now(),
    stateStartedAt: Date.now(),
    state: 'done',
    prompt: '',
    updatedAt: Date.now(),
    providerSession: {
      key: 'session_id',
      id: PROVIDER_SESSION_ID,
      transcriptPath
    },
    launchToken: 'pane-launch',
    ...overrides
  } as AgentStatusIpcPayload
}

function adoptInput(overrides: Record<string, unknown> = {}) {
  return {
    envelope: {
      sessionId: SESSION_ID,
      clientOperationId: createStructuredAgentSessionOperationId(() => randomUUID()),
      expectedRuntimeFence: null as null,
      payloadFingerprint: 'c'.repeat(64)
    },
    worktree: `id:${WORKTREE_ID}`,
    tabId: 'tab-claude-adopt',
    paneKey: PANE_KEY,
    ptyId: PTY_ID,
    agent: 'claude' as const,
    providerSessionId: PROVIDER_SESSION_ID,
    ...overrides
  }
}

beforeEach(async () => {
  const actualSessionFileResolver = await vi.importActual<typeof SessionFileResolver>(
    '../native-chat/session-file-resolver'
  )
  readClaudeTranscriptLeafUuid.mockReset()
  readClaudeTranscriptLeafUuid.mockImplementation(
    actualSessionFileResolver.readClaudeTranscriptLeafUuid
  )
  resolveSessionFilePath.mockReset()
  resolveSessionFilePath.mockImplementation(actualSessionFileResolver.resolveSessionFilePath)
  root = await mkdtemp(join(tmpdir(), 'orca-claude-adoption-'))
  accountHome = join(root, 'claude-account')
  transcriptPath = join(accountHome, 'projects', 'repo', `${PROVIDER_SESSION_ID}.jsonl`)
  await writeTranscript()
  rows = [providerRow()]
  store = await AgentSessionRecordStore.open({
    directory: join(root, 'agent-sessions'),
    hostId: 'local'
  })
  agentSessionPtyWriteGate.attachRecordLookup((sessionId) => store.getRecord(sessionId))
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      supportsCreate: () => true,
      acquire: vi.fn(),
      dispatch: vi.fn(),
      cancelTurn: vi.fn(),
      answerPrompt: vi.fn(),
      setOption: vi.fn(),
      historyFilePath: vi.fn(async () => transcriptPath)
    },
    journalRoot: join(root, 'journals'),
    claimKeyId: 'claude-key',
    probeOwner: createStructuredAgentSessionOwnerProbe(
      'local',
      async () => ({ outcome: 'identity-matched', matchedOn: ['process-start-time'] }),
      async () => []
    )
  })
  setStructuredAgentSessionHost(host)
  runtime = new OrcaRuntimeService(
    { getSettings: () => ({ agentDefaultEnv: {} }) } as never,
    undefined,
    {
      getAgentProviderSessionRowsForPane: (paneKey) => rows.filter((row) => row.paneKey === paneKey)
    }
  )
  const ptyRecord = {
    ptyId: PTY_ID,
    connected: true,
    connectionId: null,
    wslDistro: null,
    tabId: 'tab-claude-adopt',
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    incarnationId: 'inc-claude-adopt',
    launchAgent: 'claude',
    launchToken: 'pane-launch',
    launchConfig: { agentArgs: '', agentEnv: { CLAUDE_CONFIG_DIR: accountHome } },
    tailBuffer: [],
    tailPartialLine: '',
    preview: '',
    lastOutputAt: 1_000
  }
  const internal = runtime as unknown as {
    ptysById: Map<string, unknown>
    resolveRuntimeFileTarget(): Promise<unknown>
    resolveStructuredAgentSessionAdoptionIntent(input: { envelope: unknown }): Promise<unknown>
    issueStructuredTuiPtyHandle(): string
  }
  internal.ptysById.set(PTY_ID, ptyRecord)
  internal.resolveRuntimeFileTarget = vi.fn(async () => ({
    connectionId: null,
    worktree: { id: WORKTREE_ID }
  }))
  internal.resolveStructuredAgentSessionAdoptionIntent = vi.fn(
    async ({ envelope }: { envelope: unknown }) => ({
      envelope,
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: WORKTREE_ID,
        workspaceKind: 'git-worktree'
      },
      provider: 'claude',
      agent: 'claude',
      accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: accountHome },
      runtimeKind: 'native'
    })
  )
  internal.issueStructuredTuiPtyHandle = vi.fn(() => 'term-claude-adopt')
  runtime.setPtyController({
    listProcesses: async () => [
      { id: PTY_ID, incarnationId: 'inc-claude-adopt', rootProcessId: 31337 }
    ]
  } as never)
  readStructuredTuiProcessIdentity.mockImplementation(
    async (input: { hostId: string; spawnToken: string }) => ({
      hostId: input.hostId,
      pid: 5252,
      processStartTimeMs: 1_700_000_000_000,
      spawnToken: input.spawnToken
    })
  )
})

afterEach(async () => {
  agentSessionPtyWriteGate.unbindPty(PTY_ID)
  agentSessionPtyWriteGate.detachRecordLookup()
  setStructuredAgentSessionHost(null)
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

describe('structured Claude legacy adoption', () => {
  it('adopts the exact provider session and leaf from the live pane', async () => {
    const result = await runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
      callerKey: 'renderer-claude'
    })

    expect(result).toMatchObject({ ok: true })
    expect(store.getRecord(SESSION_ID)).toMatchObject({
      providerHandleChain: [
        {
          origin: 'adopted',
          handle: { provider: 'claude', sessionId: PROVIDER_SESSION_ID, leafUuid: LEAF_UUID }
        }
      ],
      lease: { runtimeKind: 'tui', claimStatus: 'live' }
    })
    const processProof = readStructuredTuiProcessIdentity.mock.calls[0]?.[0] as {
      processCommandMatches?: (command: string) => boolean
    }
    expect(processProof.processCommandMatches?.(`claude --resume ${PROVIDER_SESSION_ID}`)).toBe(
      true
    )
    expect(processProof.processCommandMatches?.('claude --resume stale-session')).toBe(false)
  }, 20_000)

  it('retries only a torn Claude transcript tail and preserves a completed diagnostic', async () => {
    readClaudeTranscriptLeafUuid
      .mockRejectedValueOnce(new ClaudeTranscriptTailIncompleteError())
      .mockRejectedValueOnce(new Error('Claude transcript branch proof failed: malformed JSONL'))

    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('malformed JSONL')
    expect(readClaudeTranscriptLeafUuid).toHaveBeenCalledTimes(2)
    expect(agentSessionPtyWriteGate.boundSessionId(PTY_ID)).toBeNull()
  })

  it('surfaces Claude ancestry errors immediately without retrying the transcript read', async () => {
    readClaudeTranscriptLeafUuid.mockRejectedValue(
      new Error('Claude transcript branch proof failed: latest marker is on a sibling branch')
    )

    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('sibling branch')
    expect(readClaudeTranscriptLeafUuid).toHaveBeenCalledTimes(1)
    expect(agentSessionPtyWriteGate.boundSessionId(PTY_ID)).toBeNull()
  })

  it('rejects a provider row from a prior launch before ownership is attached', async () => {
    rows = [providerRow({ launchToken: 'old-launch' })]

    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('stale provider session identity')
    expect(store.getRecord(SESSION_ID)?.lease.ownerProcess).toBeNull()
    expect(agentSessionPtyWriteGate.boundSessionId(PTY_ID)).toBeNull()
  })

  it('rejects a transcript leaf that is absent or outside the pane account root', async () => {
    await writeTranscript('')
    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('invalid last-prompt marker')
    expect(agentSessionPtyWriteGate.boundSessionId(PTY_ID)).toBeNull()

    const outsidePath = join(root, 'outside.jsonl')
    await writeFile(
      outsidePath,
      `${JSON.stringify({ type: 'last-prompt', leafUuid: LEAF_UUID })}\n`,
      'utf8'
    )
    rows = [
      providerRow({
        providerSession: {
          key: 'session_id',
          id: PROVIDER_SESSION_ID,
          transcriptPath: outsidePath
        }
      })
    ]
    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('transcript outside its account root')
  })

  it('rejects a process that changes while Claude history is being proved', async () => {
    readStructuredTuiProcessIdentity
      .mockImplementationOnce(async (input: { hostId: string; spawnToken: string }) => ({
        hostId: input.hostId,
        pid: 5252,
        processStartTimeMs: 1_700_000_000_000,
        spawnToken: input.spawnToken
      }))
      .mockImplementationOnce(async (input: { hostId: string; spawnToken: string }) => ({
        hostId: input.hostId,
        pid: 5253,
        processStartTimeMs: 1_700_000_000_001,
        spawnToken: input.spawnToken
      }))

    await expect(
      runtime.adoptStructuredAgentSessionTerminal(adoptInput(), {
        callerKey: 'renderer-claude'
      })
    ).rejects.toThrow('process changed during conversation proof')
    expect(agentSessionPtyWriteGate.boundSessionId(PTY_ID)).toBeNull()
  })

  it('requires a fresh provider observation while accepting an advanced transcript leaf', async () => {
    const internal = runtime as unknown as {
      getLivePtyForHandle(): { pty: { connected: boolean; paneKey: string; launchAgent: string } }
      waitForStructuredClaudeTuiProof(input: {
        handle: string
        paneKey: string
        sessionId: string
        previousLeafUuid: string | null
        projectsDir: string
        spawnToken: string
        minimumProviderSessionReceivedAt: number
      }): Promise<{ leafUuid: string }>
    }
    const pty = { connected: true, paneKey: PANE_KEY, launchAgent: 'claude' }
    internal.getLivePtyForHandle = vi.fn(() => ({ pty }))
    const staleAt = Date.now() - 1_000
    await writeTranscript('leaf-advanced')
    rows = [providerRow({ launchToken: 'new-launch', receivedAt: staleAt })]
    const proof = internal.waitForStructuredClaudeTuiProof({
      handle: 'term-claude-adopt',
      paneKey: PANE_KEY,
      sessionId: PROVIDER_SESSION_ID,
      previousLeafUuid: null,
      projectsDir: join(accountHome, 'projects'),
      spawnToken: 'new-launch',
      minimumProviderSessionReceivedAt: Date.now()
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    rows = [providerRow({ launchToken: 'new-launch', receivedAt: Date.now() })]
    await expect(proof).resolves.toMatchObject({ leafUuid: 'leaf-advanced' })
  }, 5_000)

  it('retries a transient torn final transcript line during launch proof', async () => {
    const internal = runtime as unknown as {
      getLivePtyForHandle(): { pty: { connected: boolean; paneKey: string; launchAgent: string } }
      waitForStructuredClaudeTuiProof(input: {
        handle: string
        paneKey: string
        sessionId: string
        previousLeafUuid: string | null
        projectsDir: string
      }): Promise<{ leafUuid: string }>
    }
    internal.getLivePtyForHandle = vi.fn(() => ({
      pty: { connected: true, paneKey: PANE_KEY, launchAgent: 'claude' }
    }))
    resolveSessionFilePath.mockResolvedValue(transcriptPath)
    readClaudeTranscriptLeafUuid
      .mockRejectedValueOnce(new ClaudeTranscriptTailIncompleteError())
      .mockResolvedValueOnce('leaf-after-retry')

    await expect(
      internal.waitForStructuredClaudeTuiProof({
        handle: 'term-claude-adopt',
        paneKey: PANE_KEY,
        sessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: null,
        projectsDir: join(accountHome, 'projects')
      })
    ).resolves.toMatchObject({ leafUuid: 'leaf-after-retry' })
    expect(readClaudeTranscriptLeafUuid).toHaveBeenCalledTimes(2)
  })

  it('fails closed with the malformed transcript diagnostic after the proof deadline', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_800_000_000_000)
      const internal = runtime as unknown as {
        getLivePtyForHandle(): { pty: { connected: boolean; paneKey: string; launchAgent: string } }
        waitForStructuredClaudeTuiProof(input: {
          handle: string
          paneKey: string
          sessionId: string
          previousLeafUuid: string | null
          projectsDir: string
        }): Promise<{ leafUuid: string }>
      }
      internal.getLivePtyForHandle = vi.fn(() => ({
        pty: { connected: true, paneKey: PANE_KEY, launchAgent: 'claude' }
      }))
      resolveSessionFilePath.mockResolvedValue(transcriptPath)
      readClaudeTranscriptLeafUuid.mockRejectedValue(new ClaudeTranscriptTailIncompleteError())
      const proof = internal.waitForStructuredClaudeTuiProof({
        handle: 'term-claude-adopt',
        paneKey: PANE_KEY,
        sessionId: PROVIDER_SESSION_ID,
        previousLeafUuid: null,
        projectsDir: join(accountHome, 'projects')
      })
      const rejection = expect(proof).rejects.toThrow('malformed JSONL')

      await vi.advanceTimersByTimeAsync(15_100)
      await rejection
      expect(readClaudeTranscriptLeafUuid.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
