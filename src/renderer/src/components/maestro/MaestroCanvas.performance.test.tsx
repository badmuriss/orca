// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MaestroCanvas } from './MaestroCanvas'

describe('MaestroCanvas performance', () => {
  const frames: FrameRequestCallback[] = []

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
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
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    frames.length = 0
  })

  it('bounds panning updates and omits offscreen graph work', () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 240 }, (_, index) => [
        `node-${index}`,
        { summary: `Node ${index}`, position: { x: index * 260, y: 400 } }
      ])
    )
    const edges = Array.from({ length: 239 }, (_, index) => ({
      id: `edge-${index}`,
      source_id: `node-${index}`,
      target_id: `node-${index + 1}`,
      type: 'depends_on' as const,
      direction: 'forward' as const,
      projected: false as const
    }))
    const { container } = render(
      <MaestroCanvas
        document={{ nodes, edges, authoring_history: { undo_stack: [], redo_stack: [] } }}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const graph = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    Object.assign(graph, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(graph, { pointerId: 1, button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(graph, { pointerId: 1, clientX: 60, clientY: 20 })
    fireEvent.pointerMove(graph, { pointerId: 1, clientX: 100, clientY: 20 })

    expect(frames).toHaveLength(1)
    act(() => frames.shift()?.(0))
    expect(container.querySelectorAll('[data-maestro-node]').length).toBeLessThan(20)
    const renderedEdges = [...container.querySelectorAll<SVGGElement>('[data-maestro-edge-id]')]
    expect(renderedEdges).not.toHaveLength(0)
    expect(renderedEdges).toHaveLength(
      container.querySelectorAll('[data-maestro-edge-layer] path').length
    )
    for (const edge of renderedEdges) {
      const sourceId = edge.dataset.maestroEdgeSourceId
      const targetId = edge.dataset.maestroEdgeTargetId
      expect(sourceId).toBeTruthy()
      expect(targetId).toBeTruthy()
      expect(container.querySelector(`[data-maestro-node="${sourceId}"]`)).not.toBeNull()
      expect(container.querySelector(`[data-maestro-node="${targetId}"]`)).not.toBeNull()
    }
  })
})
