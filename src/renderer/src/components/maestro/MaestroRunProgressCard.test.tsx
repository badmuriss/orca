// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaestroRunProgressCard } from './MaestroRunProgressCard'

const node = {
  id: 'run-progress-run-1',
  title: 'Run progress',
  summary: 'Run run-1',
  status: 'active',
  position: { x: 48, y: 48 },
  projectedType: 'run-progress' as const,
  runProgress: {
    available: true as const,
    authority: {
      runId: 'run-1',
      workspace: { executionHostId: 'local', workspaceKey: 'worktree:one' },
      revision: 1
    },
    summary: {
      schema_version: 1 as const,
      state: 'active' as const,
      progress_percent: 20,
      task_counts: {
        approved: 1,
        running: 1,
        input_required: 0,
        blocked: 0,
        pending: 1,
        failed: 0
      },
      current_tasks: [{ task_id: 'ORC-04P', attempt_id: 'attempt-1', status: 'running' as const }],
      next_tasks: [{ task_id: 'ORC-05', attempt_id: null, status: 'pending' as const }],
      cleanup: {
        pending: { count: 0, ids: [], truncated: false },
        unverifiable: { count: 0, ids: [], truncated: false },
        failed: { count: 0, ids: [], truncated: false },
        retained: { count: 0, ids: [], truncated: false }
      },
      last_activity: { sequence: 3, timestamp: '2026-08-22T09:04:01Z', type: 'attempt_started' },
      blockers: [],
      material_findings: []
    }
  }
}

describe('MaestroRunProgressCard', () => {
  afterEach(cleanup)

  it('attaches focus and drag interactions to the full card root', () => {
    const nodeRef = vi.fn()
    const onPointerDown = vi.fn()
    const onClick = vi.fn()
    render(
      <MaestroRunProgressCard
        node={node}
        selected={false}
        nodeRef={nodeRef}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onKeyDown={vi.fn()}
        onInspectReference={vi.fn()}
      />
    )

    const card = screen.getByLabelText('Run Run run-1: active')
    expect(nodeRef).toHaveBeenCalledWith(card)
    fireEvent.pointerDown(card, { pointerId: 1 })
    fireEvent.click(card)
    expect(onPointerDown).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalled()
  })

  it('keeps identity links out of the root card click handler', () => {
    const onClick = vi.fn()
    const onInspectReference = vi.fn()
    render(
      <MaestroRunProgressCard
        node={node}
        selected={false}
        nodeRef={vi.fn()}
        onClick={onClick}
        onPointerDown={vi.fn()}
        onKeyDown={vi.fn()}
        onInspectReference={onInspectReference}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /ORC-04P/ }))
    expect(onInspectReference).toHaveBeenCalledWith({
      authority: node.runProgress.authority,
      reference: {
        task_id: 'ORC-04P',
        attempt_id: 'attempt-1',
        finding_ref: null,
        cleanup_id: null
      }
    })
    expect(onClick).not.toHaveBeenCalled()
  })
})
