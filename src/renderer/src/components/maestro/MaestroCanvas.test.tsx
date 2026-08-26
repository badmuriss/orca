// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyMaestroDocumentAuthoringMutation } from '@/runtime/runtime-maestro-client'
import { MaestroCanvas, type MaestroSpatialGraph } from './MaestroCanvas'

vi.mock('@/runtime/runtime-maestro-client', () => ({
  applyMaestroDocumentAuthoringMutation: vi.fn(),
  getMaestroDelegationCatalog: vi.fn().mockResolvedValue(null)
}))

const { mockedProjection } = vi.hoisted(() => ({
  mockedProjection: {
    state: 'ready' as const,
    projection: {
      source: 'snapshot' as const,
      change: 'change-1',
      repositoryId: 'repo-1',
      runId: 'run-1',
      revision: 1,
      workspace: { executionHostId: 'local', workspaceKey: 'worktree:one' },
      nodes: [],
      edges: [],
      runProgress: { available: false as const, state: 'outcome_unknown' as const }
    }
  }
}))

vi.mock('./useMaestroProjection', () => ({
  useMaestroProjection: () => mockedProjection
}))

const document = {
  nodes: {
    coordinator: { position: { x: 500, y: 400 } },
    worker: { position: { x: 800, y: 400 } }
  },
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
    },
    {
      id: 'worker',
      title: 'Worker',
      summary: 'Implements canvas',
      status: 'Queued',
      position: { x: 800, y: 400 }
    },
    {
      id: 'offscreen',
      title: 'Evidence worker',
      summary: 'Records evidence',
      status: 'Verified',
      position: { x: 4400, y: 400 }
    }
  ],
  edges: [{ id: 'coordinator-worker', sourceId: 'coordinator', targetId: 'worker' }]
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

function progressDetailGraph({
  workspaceKey = 'worktree:one',
  authorityRunId = 'run-1',
  reference = { task_id: null, attempt_id: null, finding_ref: 'finding-1', cleanup_id: null }
}: {
  workspaceKey?: string
  authorityRunId?: string
  reference?: {
    task_id: string | null
    attempt_id: string | null
    finding_ref: string | null
    cleanup_id: string | null
  }
} = {}): MaestroSpatialGraph {
  return {
    edges: [],
    nodes: [
      {
        id: 'run-progress-run-1',
        title: 'Run progress',
        summary: 'Run run-1',
        status: 'partial',
        position: { x: 48, y: 48 },
        projectedType: 'run-progress',
        runProgress: {
          available: true,
          authority: {
            runId: authorityRunId,
            workspace: { executionHostId: 'local', workspaceKey },
            revision: 1
          },
          summary: {
            schema_version: 1,
            state: 'partial',
            progress_percent: 82,
            task_counts: {
              approved: 1,
              running: 0,
              input_required: 0,
              blocked: 0,
              pending: 0,
              failed: 0
            },
            current_tasks: [],
            next_tasks: [],
            cleanup: {
              pending: { count: 1, ids: ['cleanup-1'], truncated: false },
              unverifiable: { count: 0, ids: [], truncated: false },
              failed: { count: 0, ids: [], truncated: false },
              retained: { count: 0, ids: [], truncated: false }
            },
            last_activity: null,
            blockers: [],
            material_findings: [reference]
          }
        }
      }
    ]
  }
}

describe('MaestroCanvas', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps background panning separate from node dragging and releases SVG capture', () => {
    stubCanvasBounds()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onPositionChange = vi.fn()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        onPositionChange={onPositionChange}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(canvas, {
      setPointerCapture,
      releasePointerCapture,
      hasPointerCapture: () => true
    })
    const worker = screen.getByRole('button', { name: /Worker, Queued/ })

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 140, clientY: 100 })
    act(() => frames.shift()?.(0))
    expect(onPositionChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(worker, { pointerId: 2, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 240, clientY: 200 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 240, clientY: 200 })
    expect(setPointerCapture).toHaveBeenCalledWith(2)
    expect(releasePointerCapture).toHaveBeenCalledWith(2)
    expect(onPositionChange).toHaveBeenCalledWith('worker', { x: 840, y: 400 })
  })

  it('drags a run-progress card from its full card root', () => {
    stubCanvasBounds()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onPositionChange = vi.fn()
    const { container } = render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        onPositionChange={onPositionChange}
        graph={{
          edges: [],
          nodes: [
            {
              id: 'run-progress-run-1',
              title: 'Run progress',
              summary: 'Run run-1',
              status: 'active',
              position: { x: 48, y: 48 },
              projectedType: 'run-progress',
              runProgress: {
                available: true,
                authority: {
                  runId: 'run-1',
                  workspace: { executionHostId: 'local', workspaceKey: 'worktree:one' },
                  revision: 1
                },
                summary: {
                  schema_version: 1,
                  state: 'active',
                  progress_percent: 20,
                  task_counts: {
                    approved: 1,
                    running: 1,
                    input_required: 0,
                    blocked: 0,
                    pending: 1,
                    failed: 0
                  },
                  current_tasks: [],
                  next_tasks: [],
                  cleanup: {
                    pending: { count: 0, ids: [], truncated: false },
                    unverifiable: { count: 0, ids: [], truncated: false },
                    failed: { count: 0, ids: [], truncated: false },
                    retained: { count: 0, ids: [], truncated: false }
                  },
                  last_activity: null,
                  blockers: [],
                  material_findings: []
                }
              }
            }
          ]
        }}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true
    })
    const card = screen.getByLabelText('Run Run run-1: active')

    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 140, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 140, clientY: 100 })

    expect(onPositionChange).toHaveBeenCalledWith('run-progress-run-1', { x: 88, y: 48 })
  })

  it('opens exact finding and cleanup identities in the Inspector', () => {
    stubCanvasBounds()
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={progressDetailGraph()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'finding-1' }))
    const findingInspector = screen.getByRole('complementary', { name: 'Selected node details' })
    expect(within(findingInspector).getByRole('heading', { name: 'Finding' })).toBeInTheDocument()
    expect(within(findingInspector).getByText('finding-1')).toBeInTheDocument()
    expect(within(findingInspector).getByText('run-1')).toBeInTheDocument()
    expect(within(findingInspector).queryByText('Run progress')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'cleanup-1' }))
    const cleanupInspector = screen.getByRole('complementary', { name: 'Selected node details' })
    expect(within(cleanupInspector).getByRole('heading', { name: 'Cleanup' })).toBeInTheDocument()
    expect(within(cleanupInspector).getByText('cleanup-1')).toBeInTheDocument()
    expect(within(cleanupInspector).queryByText('Run progress')).not.toBeInTheDocument()
  })

  it('rejects progress detail identities from another workspace', () => {
    stubCanvasBounds()
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={progressDetailGraph({ workspaceKey: 'worktree:other' })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'finding-1' }))
    expect(
      screen.queryByRole('complementary', { name: 'Selected node details' })
    ).not.toBeInTheDocument()
  })

  it('rejects a forged progress identity authority', () => {
    stubCanvasBounds()
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={progressDetailGraph({ authorityRunId: 'run-2' })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'finding-1' }))
    expect(
      screen.queryByRole('complementary', { name: 'Selected node details' })
    ).not.toBeInTheDocument()
  })

  it('opens a no-node attempt identity without calling it cleanup', () => {
    stubCanvasBounds()
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={progressDetailGraph({
          reference: {
            task_id: 'task-missing',
            attempt_id: 'attempt-missing',
            finding_ref: null,
            cleanup_id: null
          }
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /task-missing/ }))
    const inspector = screen.getByRole('complementary', { name: 'Selected node details' })
    expect(within(inspector).getByRole('heading', { name: 'Attempt' })).toBeInTheDocument()
    expect(within(inspector).getByText('attempt-missing')).toBeInTheDocument()
  })

  it('keeps a colliding task from another workspace out of the Inspector selection', () => {
    stubCanvasBounds()
    const progress = progressDetailGraph({
      reference: {
        task_id: 'task-collision',
        attempt_id: null,
        finding_ref: null,
        cleanup_id: null
      }
    })
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={{
          ...progress,
          nodes: [
            ...progress.nodes,
            {
              id: 'remote-task-collision',
              title: 'Remote collision',
              summary: 'Must not be selected',
              status: 'Approved',
              position: { x: 440, y: 48 },
              projectedType: 'task',
              taskId: 'task-collision',
              executionHostId: 'ssh:remote',
              workspaceKey: 'worktree:other',
              runId: 'run-1',
              revision: 1
            }
          ]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /task-collision/ }))
    const inspector = screen.getByRole('complementary', { name: 'Selected node details' })
    expect(within(inspector).getByRole('heading', { name: 'Task' })).toBeInTheDocument()
    expect(within(inspector).queryByText('Remote collision')).not.toBeInTheDocument()
  })

  it('keeps a same-workspace collision without run metadata out of the Inspector selection', () => {
    stubCanvasBounds()
    const progress = progressDetailGraph({
      reference: {
        task_id: 'task-metadata-collision',
        attempt_id: null,
        finding_ref: null,
        cleanup_id: null
      }
    })
    render(
      <MaestroCanvas
        document={document}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        graph={{
          ...progress,
          nodes: [
            ...progress.nodes,
            {
              id: 'metadata-collision',
              title: 'Metadata collision',
              summary: 'Must not be selected',
              status: 'Approved',
              position: { x: 440, y: 48 },
              projectedType: 'task',
              taskId: 'task-metadata-collision',
              executionHostId: 'local',
              workspaceKey: 'worktree:one'
            }
          ]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /task-metadata-collision/ }))
    const inspector = screen.getByRole('complementary', { name: 'Selected node details' })
    expect(within(inspector).getByRole('heading', { name: 'Task' })).toBeInTheDocument()
    expect(within(inspector).queryByText('Metadata collision')).not.toBeInTheDocument()
  })

  it('searches, centers, renders, and focuses an initially offscreen node', () => {
    stubCanvasBounds()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    expect(screen.queryByRole('button', { name: /Evidence worker/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search graph' }), {
      target: { value: 'Evidence' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Evidence worker' }))
    act(() => frames.shift()?.(0))
    act(() => frames.shift()?.(0))
    expect(screen.getByRole('button', { name: /Evidence worker, Verified/ })).toHaveFocus()
  })

  it('uses only explicit typed edges and keeps the inspector contextual', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    expect(container.querySelectorAll('[data-maestro-edge-layer] path')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Coordinator, Working/ }))
    expect(screen.getByRole('complementary', { name: 'Selected node details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(
      screen.queryByRole('complementary', { name: 'Selected node details' })
    ).not.toBeInTheDocument()
  })

  it('overlays persisted node positions onto projected graph nodes', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={{
          ...document,
          nodes: { ...document.nodes, worker: { position: { x: 840, y: 410 } } }
        }}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    expect(container.querySelector('foreignObject[x="840"][y="410"]')).toBeInTheDocument()
  })

  it('rehydrates a pinned snapshot only onto the declared context note', () => {
    stubCanvasBounds()
    render(
      <MaestroCanvas
        document={{
          nodes: {
            source: {
              kind: 'note',
              position: { x: 100, y: 100 },
              title: 'Source note',
              markdown: '# Source',
              note_revision: 2
            },
            target: {
              kind: 'note',
              position: { x: 340, y: 100 },
              title: 'Target note',
              markdown: '# Target',
              note_revision: 1
            }
          },
          edges: [
            {
              id: 'context-edge',
              source_id: 'source',
              target_id: 'target',
              type: 'context_for',
              direction: 'forward',
              projected: false,
              context_note_id: 'source',
              context_snapshot_id: 'snapshot-1'
            }
          ],
          authoring_history: { undo_stack: [], redo_stack: [] }
        }}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Source note, Saved/ }), { detail: 2 })
    expect(screen.getByText('Pinned context snapshot-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss note editor' }))
    fireEvent.click(screen.getByRole('button', { name: /^Target note, Saved/ }), { detail: 2 })
    expect(screen.queryByText('Pinned context snapshot-1')).not.toBeInTheDocument()
  })

  it('opens the canvas menu at the right-click pointer and restores SVG focus', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    fireEvent.contextMenu(canvas, { clientX: 520, clientY: 310, button: 2 })
    const menu = screen.getByRole('menu', { name: 'Canvas actions' })
    expect(menu).toHaveStyle({ left: '520px', top: '310px' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Canvas actions' })).not.toBeInTheDocument()
    expect(canvas).toHaveFocus()
  })

  it('opens the centered canvas menu from the native ContextMenu key and restores SVG focus', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'ContextMenu' })
    const menu = screen.getByRole('menu', { name: 'Canvas actions' })
    expect(menu).toHaveStyle({ left: '400px', top: '300px' })
    expect(screen.getByRole('menuitem', { name: 'New Markdown note' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Canvas actions' })).not.toBeInTheDocument()
    expect(canvas).toHaveFocus()
  })

  it('opens the centered canvas menu from Shift+F10 and restores SVG focus', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Canvas actions' })
    expect(menu).toHaveStyle({ left: '400px', top: '300px' })
    expect(screen.getByRole('menuitem', { name: 'New Markdown note' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Canvas actions' })).not.toBeInTheDocument()
    expect(canvas).toHaveFocus()
  })

  it('keeps the clicked world point when the viewport changes before note creation', async () => {
    stubCanvasBounds()
    const applyAuthoringMutation = vi.mocked(applyMaestroDocumentAuthoringMutation)
    applyAuthoringMutation.mockReset()
    applyAuthoringMutation.mockResolvedValue({ outcome: 'applied', revision: 1, affectedIds: [] })
    render(
      <MaestroCanvas
        document={document}
        revision={0}
        runtimeTarget={{ kind: 'local' }}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const canvas = screen.getByLabelText('Maestro graph')
    fireEvent.contextMenu(canvas, { clientX: 520, clientY: 310, button: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Markdown note' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await Promise.resolve()
    })
    expect(applyAuthoringMutation.mock.calls[0]?.[1].operation).toMatchObject({
      kind: 'create-note',
      position: { x: 770, y: 452 }
    })
    expect(applyAuthoringMutation.mock.calls[0]?.[1].scope).toEqual({
      repository_id: 'repo-1',
      execution_host_id: 'local',
      workspace_key: 'worktree:one',
      run_id: 'run-1'
    })
  })

  it('marks a new note unsaved, enables Save, and supports explicit dismissal', () => {
    stubCanvasBounds()
    const { container } = render(
      <MaestroCanvas
        document={document}
        graph={graph}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    const canvas = container.querySelector<SVGSVGElement>('[aria-label="Maestro graph"]')!
    fireEvent.keyDown(canvas, { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Markdown note' }))
    expect(screen.getByText('New note · Unsaved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Link context' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss note editor' }))
    expect(screen.queryByRole('region', { name: 'Maestro note editor' })).not.toBeInTheDocument()
  })

  it('resets note editor drafts when switching between note nodes', () => {
    stubCanvasBounds()
    const notes = {
      nodes: {
        first: {
          kind: 'note' as const,
          position: { x: 100, y: 100 },
          title: 'First note',
          markdown: '# First',
          note_revision: 1
        },
        second: {
          kind: 'note' as const,
          position: { x: 340, y: 100 },
          title: 'Second note',
          markdown: '# Second',
          note_revision: 1
        }
      },
      edges: [],
      authoring_history: { undo_stack: [], redo_stack: [] }
    }
    render(
      <MaestroCanvas
        document={notes}
        documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^First note, Saved/ }), { detail: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Changed first' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^Second note, Saved/ }), { detail: 2 })
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Second note')
  })

  describe('window selection', () => {
    // A drag captures the pointer on the board, and a captured pointer retargets the
    // following click to the board, so a click-only selection never reaches the window.
    it('selects a window on pointer-down rather than on the click that follows', () => {
      stubCanvasBounds()
      render(
        <MaestroCanvas
          document={document}
          graph={graph}
          documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        />
      )
      fireEvent.pointerDown(screen.getByRole('button', { name: /Coordinator, Working/ }), {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100
      })
      expect(
        screen.getByRole('complementary', { name: 'Selected node details' })
      ).toBeInTheDocument()
    })

    it('extends a shift selection instead of toggling it back on the following click', () => {
      stubCanvasBounds()
      render(
        <MaestroCanvas
          document={document}
          graph={graph}
          documentKey={{ executionHostId: 'local', workspaceKey: 'worktree:one' }}
        />
      )
      const coordinator = screen.getByRole('button', { name: /Coordinator, Working/ })
      const worker = screen.getByRole('button', { name: /Worker, Queued/ })
      fireEvent.pointerDown(coordinator, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.click(coordinator)
      fireEvent.pointerDown(worker, {
        pointerId: 2,
        button: 0,
        shiftKey: true,
        clientX: 200,
        clientY: 100
      })
      fireEvent.click(worker, { shiftKey: true })
      expect(coordinator).toHaveAttribute('aria-pressed', 'true')
      expect(worker).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
