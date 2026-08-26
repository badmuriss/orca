// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMaestroDocumentLayoutMutation } from '@/runtime/runtime-maestro-client'
import { MaestroCanvas, type MaestroSpatialGraph } from './MaestroCanvas'

vi.mock('@/runtime/runtime-maestro-client', () => ({
  applyMaestroDocumentLayoutMutation: vi.fn()
}))

const document = {
  nodes: { coordinator: { position: { x: 500, y: 400 } } },
  edges: [],
  authoring_history: { undo_stack: [], redo_stack: [] },
  viewport: { center: { x: 650, y: 442 }, zoom: 1 }
}

const graph: MaestroSpatialGraph = {
  nodes: [
    {
      id: 'coordinator',
      title: 'Coordinator',
      summary: 'Coordinates work',
      status: 'Working',
      position: { x: 500, y: 400 },
      agent: 'codex'
    }
  ],
  edges: []
}

function stubCanvasBounds(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({})
  })
}

describe('MaestroCanvas viewport persistence', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('commits a discrete action without a later interaction', async () => {
    stubCanvasBounds()
    const applyMutation = vi.mocked(applyMaestroDocumentLayoutMutation)
    applyMutation.mockReset()
    applyMutation.mockResolvedValue({ outcome: 'applied', revision: 8, affectedIds: [] })
    render(
      <MaestroCanvas
        document={document}
        revision={7}
        runtimeTarget={{ kind: 'local' }}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    await act(async () => undefined)

    expect(applyMutation).toHaveBeenCalledTimes(1)
    expect(applyMutation.mock.calls[0]?.[1].operation).toEqual({
      kind: 'set-viewport',
      viewport: { center: { x: 650, y: 442 }, zoom: 0.8 }
    })
  })

  it('serializes rapid commits with the applied revision', async () => {
    stubCanvasBounds()
    let releaseFirst!: () => void
    const firstMutation = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const applyMutation = vi.mocked(applyMaestroDocumentLayoutMutation)
    applyMutation.mockReset()
    applyMutation
      .mockImplementationOnce(async () => {
        await firstMutation
        return { outcome: 'applied', revision: 8, affectedIds: [] }
      })
      .mockImplementationOnce(async (_target, mutation) => ({
        outcome: 'applied',
        revision: mutation.expected_revision + 1,
        affectedIds: []
      }))
    render(
      <MaestroCanvas
        document={document}
        revision={7}
        runtimeTarget={{ kind: 'local' }}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await act(async () => undefined)
    releaseFirst()
    await act(async () => undefined)
    await act(async () => undefined)

    expect(applyMutation).toHaveBeenCalledTimes(2)
    expect(applyMutation.mock.calls[1]?.[1].expected_revision).toBe(8)
  })
})
