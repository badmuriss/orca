import { describe, expect, it, vi } from 'vitest'
import { stopPtyProcessTree, TerminalSessionTeardown } from './terminal-session-teardown'
import type { ProcessTableCapture } from '../pty-descendant-termination'
import type { Session } from './session'

const ROOT_STARTED_AT = 'Mon Aug 24 08:00:00 2026'
const CHILD_STARTED_AT = 'Mon Aug 24 08:00:01 2026'
const INCARNATION = '11111111-1111-4111-8111-111111111111'

function createPlainShellSession(overrides: Partial<Session> = {}): Session {
  return {
    launchAgent: undefined,
    pid: 4242,
    isAlive: true,
    forceKillAndWaitForExit: vi.fn(async () => {}),
    beginTermination: vi.fn(() => true),
    kill: vi.fn(),
    terminateOwnedTree: vi.fn(() => 'terminated' as const),
    scheduleForceDisposeFallback: vi.fn(),
    signalTerminationRoot: vi.fn(),
    ...overrides
  } as unknown as Session
}

function capture(rows: ProcessTableCapture['rows']): ProcessTableCapture {
  return { rows, capturedAtMs: Date.parse('2026-08-24T08:01:00Z') }
}

describe('stopPtyProcessTree', () => {
  it('proves every pre-stop POSIX identity absent before returning exited', async () => {
    const readTable = vi
      .fn()
      .mockResolvedValueOnce(
        capture([
          { pid: 41, ppid: 1, pgid: 41, startedAt: ROOT_STARTED_AT },
          { pid: 42, ppid: 41, pgid: 99, startedAt: CHILD_STARTED_AT }
        ])
      )
      .mockResolvedValueOnce(capture([]))
      .mockResolvedValueOnce(capture([]))
    const sendSignal = vi.fn()
    const killRoot = vi.fn()

    const result = await stopPtyProcessTree(41, killRoot, {
      platform: 'linux',
      graceMs: 0,
      readTable,
      sendSignal
    })

    expect(sendSignal).toHaveBeenCalledWith(42, 'SIGTERM')
    expect(killRoot).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ verdict: 'exited', processTreeVerified: true })
    expect(result.observations.map(({ status }) => status)).toEqual(['absent', 'absent'])
  })

  it('fails closed when the pre-stop snapshot is unavailable', async () => {
    const killRoot = vi.fn()
    const result = await stopPtyProcessTree(41, killRoot, {
      platform: 'linux',
      readTable: vi.fn().mockRejectedValue(new Error('ps failed'))
    })

    expect(killRoot).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ verdict: 'unverifiable', processTreeVerified: false })
  })

  it('returns capability_limited on Windows after the identity-gated tree kill', async () => {
    const killRoot = vi.fn()
    const killWindowsTree = vi.fn().mockResolvedValue(undefined)
    const result = await stopPtyProcessTree(41, killRoot, {
      platform: 'win32',
      verifyTreeKillTarget: vi.fn().mockResolvedValue('own'),
      killWindowsTree
    })

    expect(killWindowsTree).toHaveBeenCalledWith(41)
    expect(killRoot).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ verdict: 'capability_limited', processTreeVerified: false })
  })
})

describe('TerminalSessionTeardown', () => {
  it('does not invent a receipt when termination ownership is unavailable', () => {
    const session = {
      pid: 41,
      incarnationId: INCARNATION,
      terminalHandle: 'terminal-1',
      isAlive: true,
      beginTermination: vi.fn(() => false)
    } as unknown as Session
    const teardown = new TerminalSessionTeardown(new Map([['pty-1', session]]))

    expect(() => teardown.killSession('pty-1', session, true)).toThrow(
      'stop identity is unavailable'
    )
    expect(session.beginTermination).toHaveBeenCalledOnce()
  })
})

describe('pty job ownership reaches the daemon teardown path', () => {
  // Why this test exists: worktree delete runs here, not in local-pty-provider
  // (measured in #11047). A job wired only into the provider would never engage,
  // so the detached grandchild that holds the worktree cwd survives the delete.
  let platformDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    killWithDescendantSweepMock.mockReset()
    killWithDescendantSweepMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  function sweepTerminateOwnedTree(): () => string {
    const deps = killWithDescendantSweepMock.mock.calls[0][2] as {
      terminateOwnedTree?: () => string
    }
    expect(deps.terminateOwnedTree, 'sweep ran without job ownership').toBeTypeOf('function')
    return deps.terminateOwnedTree!
  }

  it.each([
    ['plain shell', undefined],
    ['agent session', { agent: 'claude' } as unknown as Session['launchAgent']]
  ])("hands the sweep this session's job on %s teardown", async (_case, launchAgent) => {
    const session = createPlainShellSession({ launchAgent })
    const teardown = new TerminalSessionTeardown(new Map([['s1', session]]))

    await teardown.killSession('s1', session, true)

    expect(sweepTerminateOwnedTree()()).toBe('terminated')
    expect(session.terminateOwnedTree).toHaveBeenCalled()
  })
})
