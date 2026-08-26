// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMaestroDelegationCatalog,
  getMaestroDelegationIntent,
  requestMaestroDelegationIntent
} from '@/runtime/runtime-maestro-client'
import type {
  MaestroDelegationCatalog,
  MaestroDelegationIntent,
  MaestroDelegationRequest
} from '../../../../shared/maestro-delegation'
import {
  delegationParentOptions,
  getMaestroCanvasPointDelegationContext,
  getMaestroNodeDelegationContext
} from './MaestroCanvas'
import { MaestroDelegationDialog } from './MaestroDelegationDialog'
import { useMaestroDelegation } from './useMaestroDelegation'

vi.mock('@/runtime/runtime-maestro-client', () => ({
  getMaestroDelegationCatalog: vi.fn(),
  getMaestroDelegationIntent: vi.fn(),
  requestMaestroDelegationIntent: vi.fn()
}))

const workspace = {
  repository_id: 'repo-1',
  execution_host_id: 'local',
  workspace_key: 'folder:folder-1',
  run_id: 'run-1'
} as const
const target = { kind: 'local' } as const

const pollingRequest: MaestroDelegationRequest = {
  schema_version: 1,
  protocol: 'maestro-delegation/v1',
  intent_id: 'intent-1',
  workspace,
  source: { kind: 'canvas-point', position: { x: 1, y: 2 } },
  parent_task_id: null,
  parent_attempt_id: null,
  purpose: 'Ship the bounded polling repair',
  role: 'implementation',
  requested: { lane: 'balanced', agent: null, model: null, effort: null },
  placement_request: { kind: 'current-workspace' },
  context_refs: [],
  paths: ['src/initial.ts'],
  check: 'pnpm test -- initial'
}

function requestIntent(
  request: MaestroDelegationRequest,
  state: MaestroDelegationIntent['state']
): MaestroDelegationIntent {
  return {
    ...request,
    actor: {
      actor_id: 'user-1',
      kind: 'user',
      authenticated: true,
      session_id: 'session-1'
    },
    coordinator_generation: 1,
    resolved: {
      agent: null,
      model: null,
      effort: null,
      permission_mode: 'manual',
      placement: {
        kind: 'current-workspace',
        execution_host_id: 'local',
        workspace_key: workspace.workspace_key
      }
    },
    state,
    spawned_by: null
  }
}

describe('MaestroCanvas delegation', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('retains active exact task, attempt, note revision, and empty-point sources', () => {
    const activeTask = {
      id: 'task-node',
      title: 'Task',
      summary: '',
      status: 'Ready',
      rawStatus: 'running',
      position: { x: 0, y: 0 },
      projectedType: 'task' as const,
      taskId: 'task-42',
      executionHostId: 'local',
      workspaceKey: 'folder:folder-1',
      runId: 'run-1'
    }
    const activeAttempt = {
      id: 'attempt-node',
      title: 'Attempt',
      summary: '',
      status: 'Ready',
      rawStatus: 'running',
      position: { x: 0, y: 0 },
      projectedType: 'attempt' as const,
      attemptId: 'attempt-42',
      taskId: 'task-42',
      executionHostId: 'local',
      workspaceKey: 'folder:folder-1',
      runId: 'run-1'
    }
    expect(
      getMaestroNodeDelegationContext(activeTask, [activeTask, activeAttempt], workspace)
    ).toMatchObject({ source: { kind: 'task', task_id: 'task-42' }, parentTaskId: 'task-42' })
    expect(
      getMaestroNodeDelegationContext(activeAttempt, [activeTask, activeAttempt], workspace)
    ).toMatchObject({
      source: { kind: 'attempt', attempt_id: 'attempt-42' },
      parentTaskId: 'task-42',
      parentAttemptId: 'attempt-42'
    })
    expect(
      getMaestroNodeDelegationContext({
        id: 'note-1',
        title: 'Note',
        summary: '',
        status: 'Saved',
        position: { x: 0, y: 0 },
        kind: 'note',
        noteRevision: 7
      })
    ).toMatchObject({ source: { kind: 'note', note_id: 'note-1', revision: '7' } })
    expect(
      getMaestroNodeDelegationContext({
        id: 'note-2',
        title: 'Note',
        summary: '',
        status: 'Saved',
        position: { x: 0, y: 0 },
        kind: 'note'
      })
    ).toBeNull()
    expect(getMaestroCanvasPointDelegationContext({ x: 12, y: 20 })).toEqual({
      source: { kind: 'canvas-point', position: { x: 12, y: 20 } }
    })
  })

  it('excludes completed and unknown status parents before dialog submission', () => {
    const activeTask = {
      id: 'task-active',
      title: 'Active task',
      summary: '',
      status: 'Ready',
      rawStatus: 'active',
      position: { x: 0, y: 0 },
      projectedType: 'task' as const,
      taskId: 'task-active',
      executionHostId: 'local',
      workspaceKey: 'folder:folder-1',
      runId: 'run-1'
    }
    const completedTask = {
      ...activeTask,
      id: 'task-completed',
      taskId: 'task-completed',
      rawStatus: 'completed'
    }
    const pendingTask = {
      ...activeTask,
      id: 'task-pending',
      taskId: 'task-pending',
      rawStatus: 'pending'
    }
    const passedTask = {
      ...activeTask,
      id: 'task-passed',
      taskId: 'task-passed',
      rawStatus: 'pass'
    }
    const gradedTask = {
      ...activeTask,
      id: 'task-graded',
      taskId: 'task-graded',
      rawStatus: 'graded'
    }
    const missingStatusTask = {
      ...activeTask,
      id: 'task-missing',
      taskId: 'task-missing',
      rawStatus: undefined
    }
    const activeAttempt = {
      id: 'attempt-active',
      title: 'Active attempt',
      summary: '',
      status: 'Ready',
      rawStatus: 'running',
      position: { x: 0, y: 0 },
      projectedType: 'attempt' as const,
      attemptId: 'attempt-active',
      taskId: 'task-active',
      executionHostId: 'local',
      workspaceKey: 'folder:folder-1',
      runId: 'run-1'
    }
    const staleAttempt = {
      ...activeAttempt,
      id: 'attempt-stale',
      attemptId: 'attempt-stale',
      taskId: 'task-completed',
      rawStatus: 'completed'
    }
    const pendingAttempt = {
      ...activeAttempt,
      id: 'attempt-pending',
      attemptId: 'attempt-pending',
      rawStatus: 'pending'
    }
    const passedAttempt = {
      ...activeAttempt,
      id: 'attempt-passed',
      attemptId: 'attempt-passed',
      rawStatus: 'pass'
    }
    const gradedAttempt = {
      ...activeAttempt,
      id: 'attempt-graded',
      attemptId: 'attempt-graded',
      rawStatus: 'graded'
    }
    const nodes = [
      activeTask,
      completedTask,
      pendingTask,
      passedTask,
      gradedTask,
      missingStatusTask,
      activeAttempt,
      staleAttempt,
      pendingAttempt,
      passedAttempt,
      gradedAttempt
    ]

    expect(getMaestroNodeDelegationContext(completedTask, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(pendingTask, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(passedTask, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(gradedTask, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(missingStatusTask, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(staleAttempt, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(pendingAttempt, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(passedAttempt, nodes, workspace)).toBeNull()
    expect(getMaestroNodeDelegationContext(gradedAttempt, nodes, workspace)).toBeNull()
    expect(delegationParentOptions(nodes, workspace)).toEqual({
      tasks: [{ id: 'task-active', label: 'Active task' }],
      attempts: [{ id: 'attempt-active', taskId: 'task-active', label: 'Active attempt' }]
    })
  })

  it('refreshes status from the runtime and cancels polling on unmount', async () => {
    vi.useFakeTimers()
    const catalog: MaestroDelegationCatalog = {
      agents: [],
      permission_mode: {
        value: 'manual',
        display_only: true,
        reason: 'Owned by settings.'
      },
      placements: [
        {
          placement: { kind: 'current-workspace' },
          label: 'Current workspace',
          enabled: true,
          disabled_reason: null
        }
      ]
    }
    vi.mocked(getMaestroDelegationCatalog).mockResolvedValue(catalog)
    vi.mocked(requestMaestroDelegationIntent).mockImplementation(async (_target, request) =>
      requestIntent(request, 'pending')
    )
    const getIntentMock = vi.mocked(getMaestroDelegationIntent)
    getIntentMock
      .mockResolvedValueOnce(requestIntent(pollingRequest, 'claimed'))
      .mockResolvedValueOnce(requestIntent(pollingRequest, 'succeeded'))

    function Harness(): React.JSX.Element {
      const controller = useMaestroDelegation({ target: { kind: 'local' }, workspace })
      return (
        <>
          <button
            type="button"
            onClick={() =>
              controller.openDelegation({
                source: { kind: 'canvas-point', position: { x: 1, y: 2 } }
              })
            }
          >
            Open delegation
          </button>
          <output>{controller.intent?.state ?? 'empty'}</output>
          {controller.dialogOpen && controller.context && controller.catalog ? (
            <MaestroDelegationDialog
              open
              workspace={workspace}
              catalog={controller.catalog}
              source={controller.context.source}
              parentTasks={[{ id: 'task-1', label: 'Active task' }]}
              parentTaskId="task-1"
              paths={['src/initial.ts']}
              check="pnpm test -- initial"
              onOpenChange={controller.onDialogOpenChange}
              onSubmit={controller.submitDelegation}
              intent={controller.intent}
            />
          ) : null}
        </>
      )
    }

    const rendered = render(<Harness />)
    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Open delegation' }))
    await act(async () => undefined)
    fireEvent.change(screen.getByRole('textbox', { name: 'Purpose' }), {
      target: { value: pollingRequest.purpose }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request delegation' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(requestMaestroDelegationIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paths: pollingRequest.paths,
        check: pollingRequest.check,
        source: pollingRequest.source
      })
    )
    expect(rendered.container.querySelector('output')).toHaveTextContent('pending')
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })
    expect(getIntentMock).toHaveBeenCalledTimes(1)
    expect(rendered.container.querySelector('output')).toHaveTextContent('claimed')
    const calls = getIntentMock.mock.calls.length
    rendered.unmount()
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(getIntentMock).toHaveBeenCalledTimes(calls)
  })

  it('preserves the poll deadline for equal workspaces and clears it on identity changes', async () => {
    vi.useFakeTimers()
    const catalog: MaestroDelegationCatalog = {
      agents: [],
      permission_mode: { value: 'manual', display_only: true, reason: 'Owned by settings.' },
      placements: []
    }
    vi.mocked(getMaestroDelegationCatalog).mockResolvedValue(catalog)
    vi.mocked(requestMaestroDelegationIntent).mockResolvedValue(
      requestIntent(pollingRequest, 'pending')
    )
    const getIntentMock = vi
      .mocked(getMaestroDelegationIntent)
      .mockResolvedValue(requestIntent(pollingRequest, 'pending'))
    getIntentMock.mockClear()

    function Harness({ runId }: { runId: string }): React.JSX.Element {
      const currentWorkspace = { ...workspace, run_id: runId }
      const controller = useMaestroDelegation({
        target: { ...target },
        workspace: currentWorkspace
      })
      return (
        <>
          <button
            type="button"
            onClick={() =>
              controller.openDelegation({
                source: { kind: 'canvas-point', position: { x: 1, y: 2 } }
              })
            }
          >
            Open delegation
          </button>
          <button
            type="button"
            disabled={!controller.dialogOpen}
            onClick={() =>
              void controller.submitDelegation({ ...pollingRequest, workspace: currentWorkspace })
            }
          >
            Submit delegation
          </button>
          <output data-testid="dialog-state">{controller.dialogOpen ? 'open' : 'closed'}</output>
          <output data-testid="context-state">{controller.context ? 'set' : 'empty'}</output>
          <output data-testid="intent-state">{controller.intent?.intent_id ?? 'empty'}</output>
        </>
      )
    }

    const rendered = render(<Harness runId={workspace.run_id} />)
    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Open delegation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit delegation' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    rendered.rerender(<Harness runId={workspace.run_id} />)
    await act(async () => {
      vi.advanceTimersByTime(249)
      await Promise.resolve()
    })
    expect(getIntentMock).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(getIntentMock).toHaveBeenCalledTimes(1)
    expect(getIntentMock).toHaveBeenLastCalledWith(target, pollingRequest.intent_id, workspace)

    const changedWorkspace = { ...workspace, run_id: 'run-2' }
    rendered.rerender(<Harness runId={changedWorkspace.run_id} />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()
    })
    expect(getIntentMock).toHaveBeenCalledTimes(1)
    expect(getIntentMock).not.toHaveBeenCalledWith(
      target,
      pollingRequest.intent_id,
      changedWorkspace
    )
    expect(screen.getByTestId('dialog-state')).toHaveTextContent('closed')
    expect(screen.getByTestId('context-state')).toHaveTextContent('empty')
    expect(screen.getByTestId('intent-state')).toHaveTextContent('empty')
  })

  it('does not project a submit resolved after the authority changes', async () => {
    const catalog: MaestroDelegationCatalog = {
      agents: [],
      permission_mode: { value: 'manual', display_only: true, reason: 'Owned by settings.' },
      placements: []
    }
    vi.mocked(getMaestroDelegationCatalog).mockResolvedValue(catalog)
    let resolveSubmit: ((value: MaestroDelegationIntent) => void) | undefined
    vi.mocked(requestMaestroDelegationIntent).mockImplementation(
      () =>
        new Promise<MaestroDelegationIntent>((resolve) => {
          resolveSubmit = resolve
        })
    )

    function Harness({ runId }: { runId: string }): React.JSX.Element {
      const currentWorkspace = { ...workspace, run_id: runId }
      const controller = useMaestroDelegation({
        target: { ...target },
        workspace: currentWorkspace
      })
      return (
        <>
          <button
            type="button"
            onClick={() =>
              controller.openDelegation({
                source: { kind: 'canvas-point', position: { x: 1, y: 2 } }
              })
            }
          >
            Open delegation
          </button>
          <button
            type="button"
            disabled={!controller.dialogOpen}
            onClick={() =>
              void controller.submitDelegation({ ...pollingRequest, workspace: currentWorkspace })
            }
          >
            Submit delegation
          </button>
          <output data-testid="dialog-state">{controller.dialogOpen ? 'open' : 'closed'}</output>
          <output data-testid="context-state">{controller.context ? 'set' : 'empty'}</output>
          <output data-testid="intent-state">{controller.intent?.intent_id ?? 'empty'}</output>
        </>
      )
    }

    const rendered = render(<Harness runId="run-1" />)
    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Open delegation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit delegation' }))
    await act(async () => undefined)

    rendered.rerender(<Harness runId="run-2" />)
    await act(async () => {
      if (!resolveSubmit) {
        throw new Error('Submit promise was not created.')
      }
      resolveSubmit(requestIntent(pollingRequest, 'pending'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('dialog-state')).toHaveTextContent('closed')
    expect(screen.getByTestId('context-state')).toHaveTextContent('empty')
    expect(screen.getByTestId('intent-state')).toHaveTextContent('empty')
  })

  it('loads the catalog once per exact workspace identity', async () => {
    const catalog: MaestroDelegationCatalog = {
      agents: [],
      permission_mode: { value: 'manual', display_only: true, reason: 'Owned by settings.' },
      placements: []
    }
    const catalogMock = vi.mocked(getMaestroDelegationCatalog).mockResolvedValue(catalog)
    catalogMock.mockClear()

    function Harness({ runId }: { runId: string }): React.JSX.Element {
      const controller = useMaestroDelegation({
        target,
        workspace: { ...workspace, run_id: runId }
      })
      return <output>{controller.catalog ? 'loaded' : 'loading'}</output>
    }

    const rendered = render(<Harness runId={workspace.run_id} />)
    await act(async () => undefined)
    expect(screen.getByText('loaded')).toBeInTheDocument()
    expect(catalogMock).toHaveBeenCalledTimes(1)

    rendered.rerender(<Harness runId="run-2" />)
    await act(async () => undefined)
    expect(catalogMock).toHaveBeenCalledTimes(2)
  })
})
