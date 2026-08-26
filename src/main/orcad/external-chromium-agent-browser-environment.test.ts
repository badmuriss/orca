import { describe, expect, it } from 'vitest'
import { AGENT_BROWSER_IDLE_TIMEOUT_MS } from '../browser/agent-browser-process-environment'
import { externalChromiumAgentBrowserEnvironment } from './external-chromium-browser-session'

const BASE = {
  executablePath: '/opt/orca/chromium',
  profilePath: '/state/browser-chromium',
  sessionName: 'orca-orcad-0123456789abcdef'
}

describe('orcad external-chromium agent-browser environment', () => {
  // Why: this daemon owns a real Chromium tree, so an unbounded daemon orphans a browser too.
  it('bounds the daemon that owns the Chromium tree', () => {
    const env = externalChromiumAgentBrowserEnvironment({ inheritedEnv: {}, ...BASE })

    expect(env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBe(String(AGENT_BROWSER_IDLE_TIMEOUT_MS))
    expect(env.AGENT_BROWSER_EXECUTABLE_PATH).toBe(BASE.executablePath)
    expect(env.AGENT_BROWSER_SESSION).toBe(BASE.sessionName)
  })

  it('honors an explicit idle timeout from the host environment', () => {
    const env = externalChromiumAgentBrowserEnvironment({
      inheritedEnv: { AGENT_BROWSER_IDLE_TIMEOUT_MS: '1234' },
      ...BASE
    })

    expect(env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBe('1234')
  })

  it('ignores a blank idle timeout rather than passing it through', () => {
    const env = externalChromiumAgentBrowserEnvironment({
      inheritedEnv: { AGENT_BROWSER_IDLE_TIMEOUT_MS: '  ' },
      ...BASE
    })

    expect(env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBe(String(AGENT_BROWSER_IDLE_TIMEOUT_MS))
  })

  it('keeps launch arguments joined for the daemon', () => {
    const env = externalChromiumAgentBrowserEnvironment({
      inheritedEnv: {},
      ...BASE,
      browserArgs: ['--headless=new', '--no-sandbox']
    })

    expect(env.AGENT_BROWSER_ARGS).toBe('--headless=new\n--no-sandbox')
  })
})
