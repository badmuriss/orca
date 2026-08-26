import { beforeEach, describe, expect, it, vi } from 'vitest'

const runProcessMock = vi.fn()
vi.mock('../../shared/child-process/run-process', () => ({
  runProcess: (spec: unknown) => runProcessMock(spec)
}))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('')),
  rm: vi.fn(async () => undefined)
}))

import {
  ExternalChromiumBrowserSession,
  externalChromiumAgentBrowserEnvironment
} from './external-chromium-browser-session'

const BASE = {
  executablePath: '/opt/orca/chromium',
  profilePath: '/state/browser-chromium',
  sessionName: 'orca-orcad-0123456789abcdef'
}

type Spec = { args?: readonly string[]; env?: NodeJS.ProcessEnv }

function commands(): string[][] {
  return runProcessMock.mock.calls.map((call) => [...((call[0] as Spec).args ?? [])])
}

describe('orcad external-chromium agent-browser environment', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
  })

  // Why: this daemon owns the user's remote Chromium, so an idle bound would close a live browser.
  it('never bounds the daemon that owns the Chromium tree', () => {
    const env = externalChromiumAgentBrowserEnvironment({ inheritedEnv: {}, ...BASE })

    expect(env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBeUndefined()
    expect(env.AGENT_BROWSER_EXECUTABLE_PATH).toBe(BASE.executablePath)
    expect(env.AGENT_BROWSER_SESSION).toBe(BASE.sessionName)
  })

  it('passes an operator-set idle timeout through untouched', () => {
    const env = externalChromiumAgentBrowserEnvironment({
      inheritedEnv: { AGENT_BROWSER_IDLE_TIMEOUT_MS: '1234' },
      ...BASE
    })

    expect(env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBe('1234')
  })

  it('keeps launch arguments joined for the daemon', () => {
    const env = externalChromiumAgentBrowserEnvironment({
      inheritedEnv: {},
      ...BASE,
      browserArgs: ['--headless=new', '--no-sandbox']
    })

    expect(env.AGENT_BROWSER_ARGS).toBe('--headless=new\n--no-sandbox')
  })

  // Why: the session name is stable across runs, so without this a killed orcad's daemon is
  // reused on the next start, still holding the previous run's Chromium (#16367).
  it("closes the previous run's daemon before opening a page", async () => {
    runProcessMock.mockImplementation((spec: Spec) => {
      const data = spec.args?.includes('tab')
        ? { tabs: [{ active: true, tabId: 'tab-1', title: 'x', url: 'about:blank' }] }
        : {}
      return Promise.resolve({
        code: 0,
        signal: null,
        stdout: JSON.stringify({ success: true, data }),
        stderr: '',
        timedOut: false
      })
    })

    const session = new ExternalChromiumBrowserSession(
      '/opt/orca/agent-browser',
      { executablePath: BASE.executablePath, provider: 'chromium' },
      '/state'
    )
    await expect(session.start()).resolves.toBe('tab-1')

    const issued = commands().map((args) => args.filter((arg) => !arg.startsWith('-')))
    expect(issued[0]).toContain('close')
    expect(issued[1]).toContain('open')
  })
})
