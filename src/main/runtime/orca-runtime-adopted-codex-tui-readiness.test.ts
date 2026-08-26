import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionHandoffTransport } from '../native-chat/agent-session-wire/structured-agent-session-handoff-types'
import { OrcaRuntimeService } from './orca-runtime'

const {
  probeAgentSessionProcessIdentity,
  proveCodexTuiRollout,
  readStructuredTuiProcessIdentity,
  resolvePinnedCodexRolloutProof
} = vi.hoisted(() => ({
  probeAgentSessionProcessIdentity: vi.fn(),
  proveCodexTuiRollout: vi.fn(),
  readStructuredTuiProcessIdentity: vi.fn(),
  resolvePinnedCodexRolloutProof: vi.fn()
}))

vi.mock('./structured-tui-process-identity', () => ({ readStructuredTuiProcessIdentity }))
vi.mock('./agent-session-process-identity-probe', async (importOriginal) => ({
  ...(await importOriginal()),
  probeAgentSessionProcessIdentity
}))
vi.mock('../codex/codex-tui-rollout-proof', () => ({
  proveCodexTuiRollout,
  resolveLiveCodexTuiRollout: vi.fn(),
  resolvePinnedCodexRolloutProof
}))

const WORKTREE_ID = 'repo-1::/tmp/adopted-readiness'
const PANE_KEY = 'tab-adopt:leaf-adopt'
const THREAD_ID = '01a03a0d-acbd-74e0-86f2-2615984d3b37'
const SESSION_ID = 'session-adopt'
const TRANSCRIPT = '/tmp/codex-home/rollout.jsonl'
const READY_SHELL_TAIL = ['dev@host ~/repo %']

function returnToTerminalHarness(
  input: {
    settingsOverrides?: Record<string, unknown>
    processCommand?: string
  } = {}
) {
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({
      disabledTuiAgents: [],
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      ...input.settingsOverrides
    })
  } as never)
  const writeAgentSessionProof = vi.fn(() => true)
  runtime.setPtyController({
    writeAgentSessionProof,
    listProcesses: async () => [
      { id: 'pty-adopt', incarnationId: 'inc-adopt', rootProcessId: 31337 }
    ]
  } as never)

  const internal = runtime as unknown as {
    ptysById: Map<string, unknown>
    adoptedStructuredTuiOwners: Map<string, unknown>
    resolveTerminalWorkspaceLaunchScope(): Promise<unknown>
    createStructuredAgentSessionHandoffTransport(): StructuredAgentSessionHandoffTransport
  }
  internal.ptysById.set('pty-adopt', {
    ptyId: 'pty-adopt',
    connected: true,
    connectionId: null,
    wslDistro: null,
    tabId: 'tab-adopt',
    paneKey: PANE_KEY,
    worktreeId: WORKTREE_ID,
    incarnationId: 'inc-adopt',
    // These stale signals describe the shell left after TUI-to-native adoption.
    lastAgentStatus: 'idle',
    tailBuffer: READY_SHELL_TAIL,
    tailPartialLine: '',
    preview: READY_SHELL_TAIL.join('\n'),
    lastOutputAt: 1_700_000_000_000
  })
  internal.adoptedStructuredTuiOwners.set(SESSION_ID, {
    terminal: {
      handle: 'term-adopt',
      tabId: 'tab-adopt',
      paneKey: PANE_KEY,
      ptyId: 'pty-adopt'
    },
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 10, spawnToken: 'spawn-adopt' },
    link: {
      linkId: 'link-adopt',
      handle: { provider: 'codex', threadId: THREAD_ID },
      origin: 'adopted',
      mintedAtFence: 1,
      observedAt: 1
    },
    historySource: 'provider-resume',
    adoptedTerminal: true
  })
  internal.resolveTerminalWorkspaceLaunchScope = vi.fn(async () => ({
    id: WORKTREE_ID,
    path: '/tmp/adopted-readiness',
    connectionId: null,
    repo: null,
    folderWorkspace: null
  }))

  const processCommand =
    input.processCommand ??
    `node /opt/codex/bin/codex --dangerously-bypass-approvals-and-sandbox resume ${THREAD_ID}`
  readStructuredTuiProcessIdentity.mockImplementation(
    async (proof: {
      processCommandMatches?: (command: string) => boolean
      excludedProcessTreeRootIdentities?: readonly {
        pid: number
        processStartTimeMs: number | null
      }[]
    }) => {
      if (
        !proof.processCommandMatches?.(processCommand) ||
        proof.excludedProcessTreeRootIdentities?.[0]?.pid !== 4242 ||
        proof.excludedProcessTreeRootIdentities[0]?.processStartTimeMs !== 10
      ) {
        throw new Error('The resumed terminal did not expose one exact Codex child process.')
      }
      return {
        hostId: 'local',
        pid: 5252,
        processStartTimeMs: 20,
        spawnToken: 'spawn-adopt'
      }
    }
  )
  resolvePinnedCodexRolloutProof.mockResolvedValue(TRANSCRIPT)

  const launch = (): Promise<{ transcriptPath?: string }> =>
    internal.createStructuredAgentSessionHandoffTransport().launchTui({
      record: {
        sessionId: SESSION_ID,
        location: { workspaceId: WORKTREE_ID, executionHostId: 'local' },
        accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex-home' },
        options: null,
        providerHandleChain: [{ handle: { provider: 'codex', threadId: THREAD_ID }, observedAt: 1 }]
      } as never,
      fence: 3,
      spawnToken: 'spawn-adopt'
    }) as Promise<{ transcriptPath?: string }>

  return { launch, writeAgentSessionProof }
}

describe('returning an adopted Codex session to its terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    probeAgentSessionProcessIdentity.mockResolvedValue({
      outcome: 'identity-matched',
      matchedOn: ['process-start-time']
    })
  })

  it('returns the TUI owner when Codex resumes the expected thread before its first turn', async () => {
    const rig = returnToTerminalHarness()

    await expect(rig.launch()).resolves.toMatchObject({ transcriptPath: TRANSCRIPT })
  })

  it('rejects a Codex child resumed onto another thread', async () => {
    const rig = returnToTerminalHarness({
      processCommand: 'node /opt/codex/bin/codex resume thread-other'
    })

    await expect(rig.launch()).rejects.toThrow('one exact Codex child process')
  })

  it('rejects a generic Codex child even when the old rollout still exists', async () => {
    const rig = returnToTerminalHarness({
      processCommand: 'node /opt/codex/bin/codex --dangerously-bypass-approvals-and-sandbox'
    })

    await expect(rig.launch()).rejects.toThrow('one exact Codex child process')
    expect(resolvePinnedCodexRolloutProof).not.toHaveBeenCalled()
  })

  it('rejects when the exact resumed process exits before the pinned rollout is accepted', async () => {
    const rig = returnToTerminalHarness()
    probeAgentSessionProcessIdentity.mockResolvedValueOnce({
      outcome: 'pid-absent',
      matchedOn: []
    })

    await expect(rig.launch()).rejects.toThrow('resumed Codex process could not be re-proved')
    expect(resolvePinnedCodexRolloutProof).toHaveBeenCalledWith('/tmp/codex-home', THREAD_ID)
  })

  it('does not depend on agent status hooks for idle resume proof', async () => {
    const rig = returnToTerminalHarness({ settingsOverrides: { agentStatusHooksEnabled: false } })

    await expect(rig.launch()).resolves.toMatchObject({ transcriptPath: TRANSCRIPT })
    expect(rig.writeAgentSessionProof).toHaveBeenCalledOnce()
  })

  it('never types an interactive screen probe at the pane', async () => {
    const rig = returnToTerminalHarness()
    await rig.launch()

    const written = rig.writeAgentSessionProof.mock.calls.map(
      (call) => (call as unknown as [string, string])[1]
    )
    expect(written).toHaveLength(1)
    expect(written[0]).toContain(`'resume' '${THREAD_ID}'`)
    expect(written[0]).not.toContain('/status')
    expect(written[0]).not.toContain('\u001b[200~')
    expect(written[0]).not.toContain('\u001b[13u')
    expect(proveCodexTuiRollout).not.toHaveBeenCalled()
  })
})
