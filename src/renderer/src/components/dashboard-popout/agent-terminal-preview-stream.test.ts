// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalPreviewDataPayload } from '../../../../shared/terminal-preview'
import { subscribeAgentTerminalPreviewStream } from './agent-terminal-preview-stream'

type PreviewTerminal = {
  options: Record<string, unknown>
  write: ReturnType<typeof vi.fn>
  writeCallbacks: (() => void)[]
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  textarea: HTMLTextAreaElement
}

const terminalHarness = vi.hoisted(() => ({ instances: [] as PreviewTerminal[] }))
const ownershipHarness = vi.hoisted(() => ({
  claimGrid: vi.fn(),
  createClipboardPaster: vi.fn(),
  installAppMenuClipboard: vi.fn(),
  installCompatibility: vi.fn(),
  installImeBridge: vi.fn(),
  installKeyHandler: vi.fn(),
  subscribeUserInput: vi.fn()
}))
const storeState = vi.hoisted(() => ({ settings: null, keybindings: {} }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    buffer = { active: { cursorY: 0 } }
    options: Record<string, unknown>
    textarea = document.createElement('textarea')
    element = document.createElement('div')
    unicode = { activeVersion: '6', versions: ['6', '11'], register: vi.fn() }
    writeCallbacks: (() => void)[] = []
    write = vi.fn((_data: string, callback?: () => void) => {
      if (callback) {
        this.writeCallbacks.push(callback)
      }
    })
    open = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    resize = vi.fn()
    reset = vi.fn()
    loadAddon = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = options
      terminalHarness.instances.push(this)
    }
  }
}))
vi.mock(import('@/lib/pane-manager/pane-terminal-options'), async (importOriginal) => ({
  ...(await importOriginal()),
  buildDefaultTerminalOptions: () => ({})
}))
vi.mock('@/components/terminal-pane/use-system-prefers-dark', () => ({
  useSystemPrefersDark: () => false
}))
vi.mock('@/lib/keyboard-layout/use-effective-mac-option-as-alt', () => ({
  useEffectiveMacOptionAsAlt: () => 'false'
}))
vi.mock('@/components/terminal-pane/terminal-user-input-signal', () => ({
  subscribeToTerminalUserInput: ownershipHarness.subscribeUserInput
}))
vi.mock('./preview-grid-claim', () => ({ createPreviewGridClaim: ownershipHarness.claimGrid }))
vi.mock('./preview-terminal-paste', () => ({
  createPreviewClipboardPaster: ownershipHarness.createClipboardPaster
}))
vi.mock('./preview-terminal-app-menu-clipboard', () => ({
  installPreviewTerminalAppMenuClipboard: ownershipHarness.installAppMenuClipboard
}))
vi.mock('./preview-terminal-compatibility', () => ({
  installPreviewTerminalCompatibility: ownershipHarness.installCompatibility
}))
vi.mock('./preview-terminal-ime-bridge', () => ({
  installPreviewImeBridge: ownershipHarness.installImeBridge
}))
vi.mock('./preview-terminal-key-handler', () => ({
  installPreviewTerminalKeyHandler: ownershipHarness.installKeyHandler
}))
vi.mock('@/store', () => {
  const useAppStore = (selector: (state: typeof storeState) => unknown): unknown =>
    selector(storeState)
  useAppStore.getState = (): typeof storeState => storeState
  return { useAppStore }
})

import { AgentTerminalPreview } from './AgentTerminalPreview'

describe('agent terminal preview stream', () => {
  const disposeGlobalListener = vi.fn()
  const onData = vi.fn()
  const connect = vi.fn()
  const input = vi.fn(async () => true)
  const fit = vi.fn(async (_ptyId: string, cols: number, rows: number) => ({ cols, rows }))
  const ack = vi.fn(async () => undefined)
  const unsubscribe = vi.fn(async () => undefined)
  let emit: ((payload: TerminalPreviewDataPayload) => void) | null = null

  beforeEach(() => {
    terminalHarness.instances.length = 0
    emit = null
    connect.mockResolvedValue({
      snapshot: { data: '', cols: 80, rows: 24, seq: 1 },
      replay: []
    })
    onData.mockImplementation((listener: (payload: TerminalPreviewDataPayload) => void) => {
      emit = listener
      return disposeGlobalListener
    })
    Object.assign(window, {
      api: {
        terminalPreview: { ack, connect, fit, input, onData, unsubscribe }
      }
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('routes payloads only to listeners for the exact PTY', () => {
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const disposeFirst = subscribeAgentTerminalPreviewStream('pty-1', firstListener)
    const disposeSecond = subscribeAgentTerminalPreviewStream('pty-2', secondListener)

    expect(onData).toHaveBeenCalledOnce()
    emit?.({ type: 'data', ptyId: 'pty-2', data: 'two', bytes: 3 })

    expect(firstListener).not.toHaveBeenCalled()
    expect(secondListener).toHaveBeenCalledExactlyOnceWith({
      type: 'data',
      ptyId: 'pty-2',
      data: 'two',
      bytes: 3
    })

    disposeFirst()
    expect(disposeGlobalListener).not.toHaveBeenCalled()
    disposeSecond()
    expect(disposeGlobalListener).toHaveBeenCalledOnce()
  })

  it('fans one PTY payload out to every exact listener', () => {
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const disposeFirst = subscribeAgentTerminalPreviewStream('pty-1', firstListener)
    const disposeSecond = subscribeAgentTerminalPreviewStream('pty-1', secondListener)

    emit?.({ type: 'resync', ptyId: 'pty-1' })

    expect(firstListener).toHaveBeenCalledExactlyOnceWith({ type: 'resync', ptyId: 'pty-1' })
    expect(secondListener).toHaveBeenCalledExactlyOnceWith({ type: 'resync', ptyId: 'pty-1' })
    disposeFirst()
    disposeSecond()
  })

  it('releases memberships idempotently and reinstalls the global listener after teardown', () => {
    const disposeFirst = subscribeAgentTerminalPreviewStream('pty-1', vi.fn())

    disposeFirst()
    disposeFirst()
    expect(disposeGlobalListener).toHaveBeenCalledOnce()

    const disposeSecond = subscribeAgentTerminalPreviewStream('pty-2', vi.fn())
    expect(onData).toHaveBeenCalledTimes(2)
    disposeSecond()
    expect(disposeGlobalListener).toHaveBeenCalledTimes(2)
  })

  it('renders live output passively without interactive terminal ownership', async () => {
    connect.mockResolvedValue({
      snapshot: { data: 'initial', cols: 80, rows: 24, seq: 1 },
      replay: []
    })
    const view = render(
      createElement(AgentTerminalPreview, { ptyId: 'pty-1', mode: 'passive', autoFocus: true })
    )
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!

    expect(terminal.options.disableStdin).toBe(true)
    expect(terminal.focus).not.toHaveBeenCalled()
    expect(terminal.textarea.getAttribute('tabindex')).toBe('-1')
    expect(view.container.querySelector('[data-terminal-preview-mode="passive"]')).not.toBeNull()
    expect(view.container.querySelector('.origin-bottom-left')).toHaveClass('pointer-events-none')
    expect(ownershipHarness.claimGrid).not.toHaveBeenCalled()
    expect(ownershipHarness.createClipboardPaster).not.toHaveBeenCalled()
    expect(ownershipHarness.installAppMenuClipboard).not.toHaveBeenCalled()
    expect(ownershipHarness.installCompatibility).not.toHaveBeenCalled()
    expect(ownershipHarness.installImeBridge).not.toHaveBeenCalled()
    expect(ownershipHarness.installKeyHandler).not.toHaveBeenCalled()
    expect(ownershipHarness.subscribeUserInput).not.toHaveBeenCalled()

    act(() => emit?.({ type: 'data', ptyId: 'pty-1', data: 'live', bytes: 4 }))
    expect(terminal.write).toHaveBeenCalledWith('live', expect.any(Function))
    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    expect(ack).toHaveBeenCalledExactlyOnceWith('pty-1', 4)
    expect(input).not.toHaveBeenCalled()
    expect(fit).not.toHaveBeenCalled()

    view.unmount()
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith('pty-1')
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })

  it('fits passive output after snapshots, not live writes, and cancels teardown work', async () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId
      frameCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelFrame = vi.fn((frameId: number) => frameCallbacks.delete(frameId))
    const disconnectResizeObserver = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = disconnectResizeObserver
      }
    )
    connect
      .mockResolvedValueOnce({
        snapshot: { data: 'first', cols: 80, rows: 24, seq: 1 },
        replay: []
      })
      .mockResolvedValueOnce({
        snapshot: { data: 'second', cols: 100, rows: 30, seq: 2 },
        replay: []
      })

    const view = render(createElement(AgentTerminalPreview, { ptyId: 'pty-1', mode: 'passive' }))
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    expect(requestFrame).toHaveBeenCalledOnce()

    const firstFrame = frameCallbacks.get(1)!
    frameCallbacks.delete(1)
    act(() => firstFrame(0))
    act(() => emit?.({ type: 'data', ptyId: 'pty-1', data: 'live', bytes: 4 }))
    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    expect(requestFrame).toHaveBeenCalledOnce()

    act(() => emit?.({ type: 'resync', ptyId: 'pty-1' }))
    await waitFor(() => expect(terminal.resize).toHaveBeenCalledWith(100, 30))
    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    expect(requestFrame).toHaveBeenCalledTimes(2)

    view.unmount()
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(2)
    expect(disconnectResizeObserver).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith('pty-1')
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })
})
