import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: [] as { webContents: MockWebContents }[],
  BrowserWindow: vi.fn(),
  finishLoads: true
}))

class MockWebContents extends EventEmitter {
  readonly id: number

  constructor(id: number) {
    super()
    this.id = id
  }

  loadURL(): Promise<void> {
    if (mocks.finishLoads) {
      queueMicrotask(() => this.emit('did-finish-load'))
    }
    return Promise.resolve()
  }
}

class MockBrowserWindow {
  readonly webContents: MockWebContents
  private destroyed = false

  constructor() {
    this.webContents = new MockWebContents(mocks.windows.length + 1)
    mocks.windows.push(this)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.webContents.emit('destroyed')
  }
}

vi.mock('electron', () => ({ BrowserWindow: mocks.BrowserWindow }))
vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    getDefaultProfile: vi.fn(() => ({ id: 'default', partition: 'persist:orca-browser' }))
  }
}))

import { OffscreenBrowserBackend } from './offscreen-browser-backend'

describe('OffscreenBrowserBackend lifecycle', () => {
  beforeEach(() => {
    mocks.windows.length = 0
    mocks.finishLoads = true
    mocks.BrowserWindow.mockImplementation(
      function BrowserWindowMock(this: {
        webContents: MockWebContents
        isDestroyed: () => boolean
        destroy: () => void
      }) {
        const window = new MockBrowserWindow()
        this.webContents = window.webContents
        this.isDestroyed = window.isDestroyed.bind(window)
        this.destroy = window.destroy.bind(window)
      }
    )
  })

  it('settles a pending load and removes its waiters when the page is destroyed', async () => {
    vi.useFakeTimers()
    mocks.finishLoads = false
    const browserManager = {
      registerOffscreenGuest: vi.fn(),
      unregisterGuest: vi.fn()
    }
    const backend = new OffscreenBrowserBackend(browserManager as never)

    await backend.createTab({
      browserPageId: 'page-1',
      url: 'https://example.com',
      worktreeId: 'wt'
    })
    const webContents = mocks.windows[0].webContents
    expect(webContents.listenerCount('did-finish-load')).toBe(1)
    expect(webContents.listenerCount('did-fail-load')).toBe(1)

    await backend.closeTab('page-1')
    expect(webContents.listenerCount('did-finish-load')).toBe(0)
    expect(webContents.listenerCount('did-fail-load')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  // Why: headless serve closes pages only here, so without this the page's agent-browser daemon
  // survives every close and is reclaimed only by its own idle timer (#16367).
  it('retires the page agent-browser daemon before dropping the guest', async () => {
    const order: string[] = []
    const browserManager = {
      registerOffscreenGuest: vi.fn(),
      unregisterGuest: vi.fn(() => order.push('unregister-guest'))
    }
    const onPageClosed = vi.fn(async (pageId: string) => {
      order.push(`retire:${pageId}`)
    })
    const backend = new OffscreenBrowserBackend(browserManager as never, () => ({ onPageClosed }))

    await backend.createTab({ browserPageId: 'page-1', url: 'about:blank', worktreeId: 'wt' })
    await backend.closeTab('page-1')

    expect(onPageClosed).toHaveBeenCalledWith('page-1')
    // Why order matters: unregisterGuest clears the id the bridge would otherwise resolve through.
    expect(order).toEqual(['retire:page-1', 'unregister-guest'])
  })

  it('retires the daemon when the page is destroyed out from under the backend', async () => {
    const browserManager = { registerOffscreenGuest: vi.fn(), unregisterGuest: vi.fn() }
    const onPageClosed = vi.fn(async () => {})
    const backend = new OffscreenBrowserBackend(browserManager as never, () => ({ onPageClosed }))

    await backend.createTab({ browserPageId: 'page-1', url: 'about:blank', worktreeId: 'wt' })
    mocks.windows[0].webContents.emit('destroyed')

    expect(onPageClosed).toHaveBeenCalledWith('page-1')
  })

  it('closes the page even when daemon retirement throws', async () => {
    const browserManager = { registerOffscreenGuest: vi.fn(), unregisterGuest: vi.fn() }
    const backend = new OffscreenBrowserBackend(browserManager as never, () => ({
      onPageClosed: vi.fn(async () => {
        throw new Error('daemon gone')
      })
    }))

    await backend.createTab({ browserPageId: 'page-1', url: 'about:blank', worktreeId: 'wt' })
    await expect(backend.closeTab('page-1')).resolves.toBeUndefined()
    expect(browserManager.unregisterGuest).toHaveBeenCalledWith('page-1')
  })
})
