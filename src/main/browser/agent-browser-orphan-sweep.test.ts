import { beforeEach, describe, expect, it, vi } from 'vitest'

const runProcessMock = vi.fn()
vi.mock('../../shared/child-process/run-process', () => ({
  runProcess: (spec: unknown) => runProcessMock(spec)
}))

import { sweepOrphanedAgentBrowserSessions } from './agent-browser-orphan-sweep'

type Spec = { args?: readonly string[] }

const BIN = '/opt/orca/agent-browser'
const SCOPED_ENV = { AGENT_BROWSER_SOCKET_DIR: '/tmp/orca-ab-0123456789abcdef' }

function respond(sessions: string[]): void {
  runProcessMock.mockImplementation((spec: Spec) => {
    if (spec.args?.[0] === 'session') {
      return Promise.resolve({
        code: 0,
        signal: null,
        stdout: JSON.stringify({ success: true, data: { sessions } }),
        stderr: '',
        timedOut: false
      })
    }
    return Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false })
  })
}

function closedArgs(): string[][] {
  return runProcessMock.mock.calls
    .map((call) => [...((call[0] as Spec).args ?? [])])
    .filter((args) => args.includes('close'))
}

describe('agent-browser orphan sweep', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
  })

  it('closes tab daemons left by a previous run', async () => {
    respond(['orca-tab-aaa', 'orca-tab-bbb'])

    const closed = await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })

    expect(closed).toEqual(['orca-tab-aaa', 'orca-tab-bbb'])
    expect(closedArgs()).toEqual([
      ['--session', 'orca-tab-aaa', 'close'],
      ['--session', 'orca-tab-bbb', 'close']
    ])
  })

  it('never closes a daemon outside Orca tab naming', async () => {
    respond(['default', 'agent1', 'orca-orcad-deadbeef', 'orca-tab-aaa'])

    await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })

    expect(closedArgs()).toEqual([['--session', 'orca-tab-aaa', 'close']])
  })

  it('leaves sessions this run already owns alone', async () => {
    respond(['orca-tab-live', 'orca-tab-orphan'])

    await sweepOrphanedAgentBrowserSessions({
      binaryPath: BIN,
      env: SCOPED_ENV,
      isSessionLive: (name) => name === 'orca-tab-live'
    })

    expect(closedArgs()).toEqual([['--session', 'orca-tab-orphan', 'close']])
  })

  // Why: without a private socket dir (Windows named pipes) `session list` is machine-wide,
  // so a sweep could close a daemon another process owns. Idle timeout bounds Windows instead.
  it('does not enumerate when the socket directory cannot prove ownership', async () => {
    respond(['orca-tab-aaa'])

    const closed = await sweepOrphanedAgentBrowserSessions({
      binaryPath: BIN,
      env: { PATH: 'C:\\Windows' }
    })

    expect(closed).toEqual([])
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('closes nothing when the listing is unusable', async () => {
    runProcessMock.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: 'not json',
      stderr: 'boom',
      timedOut: false
    })

    await expect(
      sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })
    ).resolves.toEqual([])
    expect(closedArgs()).toEqual([])
  })

  it('survives a listing that never returns', async () => {
    runProcessMock.mockRejectedValue(new Error('ENOENT'))

    await expect(
      sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })
    ).resolves.toEqual([])
  })

  it('keeps sweeping after one close fails', async () => {
    runProcessMock.mockImplementation((spec: Spec) => {
      if (spec.args?.[0] === 'session') {
        return Promise.resolve({
          code: 0,
          signal: null,
          stdout: JSON.stringify({ data: { sessions: ['orca-tab-aaa', 'orca-tab-bbb'] } }),
          stderr: '',
          timedOut: false
        })
      }
      if (spec.args?.[1] === 'orca-tab-aaa') {
        return Promise.reject(new Error('spawn failed'))
      }
      return Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false })
    })

    const closed = await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })

    expect(closed).toEqual(['orca-tab-bbb'])
  })

  it('bounds every child it starts', async () => {
    respond(['orca-tab-aaa'])

    await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, env: SCOPED_ENV })

    for (const call of runProcessMock.mock.calls) {
      expect((call[0] as { timeoutMs?: number | null }).timeoutMs).toBeGreaterThan(0)
    }
  })
})
