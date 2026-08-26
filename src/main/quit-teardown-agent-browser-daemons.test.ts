import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { settleTeardownWithinDeadline } from './quit-teardown-deadline'

/**
 * agent-browser forks a daemon per browser tab that Orca holds no handle on, and
 * `destroyAllSessions` closes each one by spawning another agent-browser child —
 * hundreds of ms apiece. Left off the will-quit barrier, `app.quit()` fired first and
 * every open tab's daemon outlived the app (#16367).
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

function teardownBarrierMembers(): string {
  const start = source.indexOf('settleTeardownWithinDeadline([')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('])', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('quit teardown of agent-browser daemons', () => {
  it('joins the will-quit teardown barrier', () => {
    expect(teardownBarrierMembers()).toContain(
      "{ name: 'agent-browser', promise: agentBrowserShutdown }"
    )
  })

  it('captures the destroyAllSessions promise instead of firing and forgetting', () => {
    expect(source).toMatch(
      /const agentBrowserShutdown =\s+runtime\?\.getAgentBrowserBridge\(\)\?\.destroyAllSessions\(\) \?\? Promise\.resolve\(\)/
    )
    // Why: a second, uncaptured call site is the pre-fix shape — it loses the race to app.quit().
    expect(source.match(/getAgentBrowserBridge\(\)\?\.destroyAllSessions\(\)/g)).toHaveLength(1)
  })

  it('holds quit open until the daemon closes settle', async () => {
    const order: string[] = []
    const daemonCloses = new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('sessions-destroyed')
        resolve()
      }, 30)
    })

    const pending = await settleTeardownWithinDeadline(
      [{ name: 'agent-browser', promise: daemonCloses }],
      5_000
    )
    order.push('quit')

    expect(pending).toEqual([])
    expect(order).toEqual(['sessions-destroyed', 'quit'])
  })

  it('still quits when a daemon close wedges', async () => {
    const pending = await settleTeardownWithinDeadline(
      [{ name: 'agent-browser', promise: new Promise<void>(() => {}) }],
      20
    )

    expect(pending).toEqual(['agent-browser'])
  })
})
