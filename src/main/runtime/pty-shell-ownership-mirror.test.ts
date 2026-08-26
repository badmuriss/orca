import { describe, expect, it, vi } from 'vitest'
import { PtyShellOwnershipMirror } from './pty-shell-ownership-mirror'

describe('PtyShellOwnershipMirror', () => {
  it('arms the recovery trigger from a seeded alternate-screen state', async () => {
    const confirm = vi.fn(async () => true)
    const mirror = new PtyShellOwnershipMirror(confirm)

    // Restored bytes bypass scan(); the seed must carry the alt state or a
    // pane reattached mid-TUI never proves ownership after the TUI dies.
    mirror.seedOwner(undefined, { alternateScreen: true })
    mirror.scan('\x1b]133;D;137\x07')

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await mirror.settle()
    expect(mirror.owner).toBe('shell')
  })

  it('does not arm from a seed on the normal buffer', async () => {
    const confirm = vi.fn(async () => true)
    const mirror = new PtyShellOwnershipMirror(confirm)

    mirror.seedOwner(undefined, { alternateScreen: false })
    mirror.scan('\x1b]133;D;0\x07')

    expect(confirm).not.toHaveBeenCalled()
    expect(mirror.owner).toBeUndefined()
  })

  it('revokes a seeded owner on later TUI bytes', () => {
    const mirror = new PtyShellOwnershipMirror(async () => true)
    mirror.seedOwner('shell', { alternateScreen: false })
    expect(mirror.owner).toBe('shell')

    mirror.scan('\x1b[?1003h')
    expect(mirror.owner).toBeUndefined()
  })

  it('bounds settle() when a proof hangs', async () => {
    const mirror = new PtyShellOwnershipMirror(() => new Promise(() => {}))
    mirror.seedOwner(undefined, { alternateScreen: true })
    mirror.scan('\x1b]133;D;137\x07')

    const start = Date.now()
    await mirror.settle()
    expect(Date.now() - start).toBeLessThan(2000)
    expect(mirror.owner).toBeUndefined()
  })
})
