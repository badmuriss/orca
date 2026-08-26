import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSurfaceId } from '../../../shared/maestro-workspace-canvas'
import {
  runMaestroWorkspaceTabAction,
  type ExactWorkspaceTabAuthority
} from './maestro-workspace-tab-actions'

const id: WorkspaceSurfaceId = {
  execution_host_id: 'ssh:server',
  workspace_key: 'worktree:workspace-a',
  unified_tab_id: 'tab-7'
}

function authority(): ExactWorkspaceTabAuthority {
  return {
    create: vi.fn(),
    focus: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    change: vi.fn(),
    close: vi.fn()
  }
}

describe('Maestro workspace tab actions', () => {
  it('routes every command through the exact unified tab identity', () => {
    const target = authority()
    runMaestroWorkspaceTabAction(target, {
      kind: 'create',
      id,
      idempotencyKey: 'create:tab-7',
      contentType: 'terminal',
      groupId: 'group-a'
    })
    runMaestroWorkspaceTabAction(target, { kind: 'focus', id })
    runMaestroWorkspaceTabAction(target, { kind: 'rename', id, title: 'Build' })
    runMaestroWorkspaceTabAction(target, { kind: 'move', id, groupId: 'group-b', index: 2 })
    runMaestroWorkspaceTabAction(target, { kind: 'change', id, change: { color: 'blue' } })
    runMaestroWorkspaceTabAction(target, { kind: 'close', id })

    expect(target.create).toHaveBeenCalledWith(
      expect.objectContaining({ id, idempotencyKey: 'create:tab-7' })
    )
    expect(target.focus).toHaveBeenCalledWith(id)
    expect(target.rename).toHaveBeenCalledWith(id, 'Build')
    expect(target.move).toHaveBeenCalledWith(id, 'group-b', 2)
    expect(target.change).toHaveBeenCalledWith(id, { color: 'blue' })
    expect(target.close).toHaveBeenCalledWith(id)
  })
})
