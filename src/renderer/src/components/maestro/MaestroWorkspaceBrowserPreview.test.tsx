// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeRpc } = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc }))

import { MaestroWorkspaceBrowserPreview } from './MaestroWorkspaceBrowserPreview'

const SCREENSHOT = { format: 'png', data: 'abc123' }

function previewImage(): Element | null {
  return document.querySelector('[data-browser-page-id="page-1"]')
}

describe('MaestroWorkspaceBrowserPreview', () => {
  afterEach(cleanup)
  beforeEach(() => {
    callRuntimeRpc.mockReset().mockResolvedValue(SCREENSHOT)
  })

  it('captures the exact page through the browser screenshot authority', async () => {
    render(
      <MaestroWorkspaceBrowserPreview
        target={{ kind: 'local' }}
        pageId="page-1"
        receiptRevision={1}
      />
    )
    await vi.waitFor(() => expect(previewImage()).not.toBeNull())
    expect(callRuntimeRpc).toHaveBeenCalledTimes(1)
    expect(callRuntimeRpc.mock.calls[0][1]).toBe('browser.screenshot')
    expect(callRuntimeRpc.mock.calls[0][2]).toEqual({ page: 'page-1', format: 'png' })
  })

  it('keeps the resolved capture when a layout mutation rebuilds equivalent props', async () => {
    const view = render(
      <MaestroWorkspaceBrowserPreview
        target={{ kind: 'local' }}
        pageId="page-1"
        receiptRevision={1}
      />
    )
    await vi.waitFor(() => expect(previewImage()).not.toBeNull())
    callRuntimeRpc.mockClear()
    view.rerender(
      <MaestroWorkspaceBrowserPreview
        target={{ kind: 'local' }}
        pageId="page-1"
        receiptRevision={1}
      />
    )
    expect(previewImage()).not.toBeNull()
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('captures again only when the receipt revision changes after resolution', async () => {
    const view = render(
      <MaestroWorkspaceBrowserPreview
        target={{ kind: 'local' }}
        pageId="page-1"
        receiptRevision={1}
      />
    )
    await vi.waitFor(() => expect(previewImage()).not.toBeNull())
    view.rerender(
      <MaestroWorkspaceBrowserPreview
        target={{ kind: 'local' }}
        pageId="page-1"
        receiptRevision={2}
      />
    )
    await vi.waitFor(() => expect(callRuntimeRpc).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(previewImage()).not.toBeNull())
  })
})
