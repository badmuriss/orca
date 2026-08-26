// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/components/dashboard-popout/AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({ ptyId }: { ptyId: string }) => (
    <input aria-label="Exact terminal input" data-terminal-preview={ptyId} />
  )
}))
vi.mock('./MaestroWorkspaceBrowserPreview', () => ({
  MaestroWorkspaceBrowserPreview: ({ pageId }: { pageId: string }) => (
    <img data-browser-preview={pageId} />
  )
}))

import { MaestroWorkspaceWindow } from './MaestroWorkspaceWindow'

const scope = { execution_host_id: 'local', workspace_key: 'folder:workspace-1' }
const placement = {
  position: { x: 0, y: 0 },
  size: { width: 320, height: 220 },
  collapsed: false,
  z_order: 0
}
const callbacks = {
  onSelect: vi.fn(),
  onEdit: vi.fn(),
  onLinkPointerDown: vi.fn(),
  onFocus: vi.fn(),
  onClose: vi.fn(),
  onMove: vi.fn(),
  onResize: vi.fn(),
  onMoveCommit: vi.fn(),
  onResizeCommit: vi.fn(),
  onUpdateAnnotationTone: vi.fn()
}

function terminal(): WorkspaceSurface {
  return {
    id: { ...scope, unified_tab_id: 'tab-1' },
    content_type: 'terminal',
    entity_id: 'terminal-tab-1',
    group_id: 'group-1',
    title: 'Build',
    revision: 2,
    availability: 'available',
    binding: {
      kind: 'terminal',
      terminal_tab_id: 'terminal-tab-1',
      pane_key: 'pane-1',
      session_id: 'pty-1',
      pty_incarnation: 'incarnation-1',
      liveness: 'live',
      authority_revision: 2
    }
  }
}

describe('MaestroWorkspaceWindow', () => {
  beforeEach(() => Object.values(callbacks).forEach((callback) => callback.mockClear()))
  afterEach(cleanup)

  it('keeps real terminal output visible without selecting the window', () => {
    render(
      <TooltipProvider>
        <MaestroWorkspaceWindow
          {...callbacks}
          surfaceKey="terminal-1"
          surface={terminal()}
          placement={placement}
          selected={false}
          pending={false}
          linkTarget={false}
          runtimeTarget={{ kind: 'local' }}
        />
      </TooltipProvider>
    )
    expect(document.querySelector('[data-terminal-preview="pty-1"]')).not.toBeNull()
  })

  it('lets terminal input receive pointer and focus without a Canvas focus mutation', () => {
    render(
      <TooltipProvider>
        <MaestroWorkspaceWindow
          {...callbacks}
          surfaceKey="terminal-1"
          surface={terminal()}
          placement={placement}
          selected
          pending={false}
          linkTarget={false}
          runtimeTarget={{ kind: 'local' }}
        />
      </TooltipProvider>
    )
    const input = screen.getByLabelText('Exact terminal input')
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
    input.dispatchEvent(pointer)
    input.focus()
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(pointer.defaultPrevented).toBe(false)
    expect(callbacks.onSelect).not.toHaveBeenCalled()
    expect(callbacks.onEdit).not.toHaveBeenCalled()
    expect(callbacks.onFocus).not.toHaveBeenCalled()
  })

  it('avoids committing placement when a header click has no movement', () => {
    render(
      <TooltipProvider>
        <MaestroWorkspaceWindow
          {...callbacks}
          surfaceKey="terminal-1"
          surface={terminal()}
          placement={placement}
          selected={false}
          pending={false}
          linkTarget={false}
          runtimeTarget={{ kind: 'local' }}
        />
      </TooltipProvider>
    )
    const header = screen.getByText('Build').closest('header')
    expect(header).not.toBeNull()
    fireEvent.pointerDown(header!, { pointerId: 1, clientX: 40, clientY: 20 })
    fireEvent.pointerUp(header!, { pointerId: 1, clientX: 40, clientY: 20 })

    expect(callbacks.onSelect).toHaveBeenCalledOnce()
    expect(callbacks.onMove).not.toHaveBeenCalled()
    expect(callbacks.onMoveCommit).not.toHaveBeenCalled()
  })

  it('renders the exact existing Browser page through the capture preview', () => {
    const surface: WorkspaceSurface = {
      id: { ...scope, unified_tab_id: 'tab-2' },
      content_type: 'browser',
      entity_id: 'browser-workspace-1',
      group_id: 'group-1',
      title: 'Docs',
      revision: 2,
      availability: 'available',
      binding: {
        kind: 'browser',
        browser_workspace_id: 'browser-workspace-1',
        browser_page_id: 'page-1',
        profile_id: null,
        partition_id: null,
        authority_revision: 2,
        live_frame: null,
        immutable_capture: null
      }
    }
    render(
      <TooltipProvider>
        <MaestroWorkspaceWindow
          {...callbacks}
          surfaceKey="browser-1"
          surface={surface}
          placement={placement}
          selected={false}
          pending={false}
          linkTarget={false}
          runtimeTarget={{ kind: 'local' }}
        />
      </TooltipProvider>
    )
    const windowElement = document.querySelector('[data-maestro-workspace-surface="browser-1"]')
    expect(windowElement?.getAttribute('data-maestro-workspace-tab-id')).toBe('tab-2')
    expect(windowElement?.getAttribute('data-maestro-workspace-content-type')).toBe('browser')
    expect(windowElement?.getAttribute('data-maestro-browser-page-id')).toBe('page-1')
    expect(document.querySelector('[data-browser-preview="page-1"]')).not.toBeNull()
  })
})
