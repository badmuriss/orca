// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaestroTerminalInspector, hasLiveTerminal } from './MaestroTerminalInspector'
import type { MaestroCanvasNode } from './MaestroCanvas'

vi.mock('@/components/dashboard-popout/AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({ ptyId }: { ptyId: string }) => (
    <div data-testid="terminal-preview" data-pty-id={ptyId} />
  )
}))

const node: MaestroCanvasNode = {
  id: 'attempt-1',
  title: 'Worker',
  summary: 'Worker',
  status: 'Running',
  position: { x: 0, y: 0 },
  terminalId: 'pty-1',
  live: true
}

describe('Maestro terminal inspector', () => {
  afterEach(cleanup)

  it('mounts the interactive terminal only for a proven live receipt', () => {
    const view = render(<MaestroTerminalInspector node={node} onClose={vi.fn()} />)

    expect(hasLiveTerminal(node)).toBe(true)
    expect(screen.getByTestId('terminal-preview')).toHaveAttribute('data-pty-id', 'pty-1')

    view.rerender(<MaestroTerminalInspector node={{ ...node, live: false }} onClose={vi.fn()} />)
    expect(hasLiveTerminal({ ...node, live: false })).toBe(false)
    expect(screen.queryByTestId('terminal-preview')).not.toBeInTheDocument()
    expect(screen.getByText(/Output is unavailable/)).toBeInTheDocument()
  })

  it('keeps inspector close view-only and exposes lifecycle-specific actions', () => {
    const onClose = vi.fn()
    const onRetain = vi.fn()
    const onHandoffAndRelease = vi.fn()
    render(
      <MaestroTerminalInspector
        node={{ ...node, role: 'coordinator', status: 'Active' }}
        onClose={onClose}
        onRetain={onRetain}
        onHandoffAndRelease={onHandoffAndRelease}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onRetain).not.toHaveBeenCalled()
    expect(onHandoffAndRelease).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Release terminal' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Handoff and release' })).toBeEnabled()
  })

  it('offers exact release only after a worker settles', () => {
    const onRelease = vi.fn()
    render(
      <MaestroTerminalInspector
        node={{ ...node, role: 'worker', status: 'Settled' }}
        onClose={vi.fn()}
        onRelease={onRelease}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Release terminal' }))
    expect(onRelease).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Handoff and release' })).not.toBeInTheDocument()
  })
})
