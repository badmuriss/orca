import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serveSignalExitError } from './serve-signal-exit-diagnostic'
import {
  SERVE_CHILD_FORCE_KILL_GRACE_MS,
  superviseForegroundServe
} from './serve-update-supervisor'
import { RuntimeClientError } from './types'
import { WILL_QUIT_TEARDOWN_DEADLINE_MS } from '../../shared/quit-teardown-deadline'

class FakeChildProcess extends EventEmitter {
  kill = vi.fn()
  pid = 5150
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function superviseUntilExit(code: number | null, signal: NodeJS.Signals | null): Promise<number> {
  const child = new FakeChildProcess()
  const supervised = superviseChild(child)
  child.emit('exit', code, signal)
  return supervised
}

function superviseChild(child: FakeChildProcess): Promise<number> {
  return superviseForegroundServe({
    executable: '/Applications/Orca.app/Contents/MacOS/Orca',
    childArgs: ['--serve'],
    spawnOptions: {},
    spawnChild: vi.fn() as never,
    handoffPath: null,
    child: child as never,
    expectedHandoff: null
  })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.useRealTimers()
})

describe('serveSignalExitError', () => {
  it('explains the macOS window-server abort on darwin SIGABRT', () => {
    const error = serveSignalExitError('SIGABRT', 'darwin')

    expect(error).toBeInstanceOf(RuntimeClientError)
    expect(error.code).toBe('runtime_serve_failed')
    expect(error.message).toContain('aborted with SIGABRT on macOS')
    expect(error.message).toContain('macOS window server')
    expect(error.data).toMatchObject({
      nextSteps: [
        expect.stringContaining('macOS desktop login'),
        expect.stringContaining('~/Library/Logs/DiagnosticReports/Orca-*.ips')
      ]
    })
  })

  it('does not claim the macOS cause off darwin', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const error = serveSignalExitError('SIGABRT', platform)

      expect(error.message).toBe('Orca serve exited via SIGABRT.')
      expect(error.data).toBeUndefined()
    }
  })

  it('does not claim the macOS cause for other darwin signals', () => {
    const error = serveSignalExitError('SIGKILL', 'darwin')

    expect(error.message).toBe('Orca serve exited via SIGKILL.')
    expect(error.data).toBeUndefined()
  })

  it('stays clear when neither a code nor a signal is reported', () => {
    expect(serveSignalExitError(null, 'darwin').message).toBe(
      'Orca serve exited without reporting an exit code or signal.'
    )
  })
})

describe('superviseForegroundServe signal exits', () => {
  it('lets the Electron quit barrier finish before force-killing serve', () => {
    expect(SERVE_CHILD_FORCE_KILL_GRACE_MS).toBeGreaterThan(WILL_QUIT_TEARDOWN_DEADLINE_MS)
    expect(SERVE_CHILD_FORCE_KILL_GRACE_MS).toBeLessThanOrEqual(30_000)
  })

  it('lets a shared-console Windows child handle Ctrl-C gracefully', async () => {
    setPlatform('win32')
    vi.useFakeTimers()
    const child = new FakeChildProcess()
    const supervised = superviseChild(child)

    process.emit('SIGINT', 'SIGINT')
    expect(child.kill).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)

    child.emit('exit', 0, null)
    await expect(supervised).resolves.toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('throws the macOS diagnostic when the child aborts on darwin', async () => {
    setPlatform('darwin')

    await expect(superviseUntilExit(null, 'SIGABRT')).rejects.toThrow(
      /aborted with SIGABRT on macOS/
    )
  })

  it('reports the plain signal on linux', async () => {
    setPlatform('linux')

    await expect(superviseUntilExit(null, 'SIGABRT')).rejects.toThrow(
      'Orca serve exited via SIGABRT.'
    )
  })

  it('returns numeric exit codes unchanged', async () => {
    setPlatform('darwin')

    await expect(superviseUntilExit(0, null)).resolves.toBe(0)
    await expect(superviseUntilExit(7, null)).resolves.toBe(7)
  })
})
