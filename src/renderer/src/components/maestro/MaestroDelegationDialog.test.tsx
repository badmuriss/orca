// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MaestroDelegationCatalog } from '../../../../shared/maestro-delegation'
import { MaestroDelegationDialog } from './MaestroDelegationDialog'

const catalog: MaestroDelegationCatalog = {
  agents: [
    {
      id: 'codex',
      label: 'Codex',
      enabled: true,
      disabled_reason: null,
      permission_mode: 'yolo',
      models: [{ id: 'gpt-5', label: 'GPT-5', efforts: ['low', 'medium', 'high'] }]
    },
    {
      id: 'claude',
      label: 'Claude',
      enabled: false,
      disabled_reason: 'Disabled in Orca agent settings.',
      permission_mode: 'manual',
      models: []
    }
  ],
  permission_mode: {
    value: 'yolo',
    display_only: true,
    reason: 'Permission mode is owned by Orca settings and cannot be changed by a Canvas request.'
  },
  placements: [
    {
      placement: { kind: 'current-workspace' },
      label: 'Current workspace',
      enabled: true,
      disabled_reason: null
    },
    {
      placement: {
        kind: 'create-child-worktree',
        execution_host_id: 'local',
        parent_workspace_key: 'folder:folder-1',
        name_hint: 'delegated-work'
      },
      label: 'Child worktree under current workspace',
      enabled: true,
      disabled_reason: null
    }
  ]
}

describe('MaestroDelegationDialog', () => {
  afterEach(cleanup)

  it('requires explicit paths and a check before submitting', () => {
    const onSubmit = vi.fn()
    render(
      <MaestroDelegationDialog
        open
        workspace={{
          repository_id: 'repo-1',
          execution_host_id: 'local',
          workspace_key: 'folder:folder-1',
          run_id: 'run-1'
        }}
        catalog={catalog}
        source={{ kind: 'canvas-point', position: { x: 10, y: 20 } }}
        parentTasks={[{ id: 'task-1', label: 'Active task' }]}
        parentTaskId="task-1"
        paths={[]}
        check=""
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Purpose' }), {
      target: { value: 'Bounded work' }
    })
    expect(screen.getByRole('button', { name: /Request delegation/ })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Paths' }), {
      target: { value: 'src/file.ts' }
    })
    expect(screen.getByRole('button', { name: /Request delegation/ })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Check' }), {
      target: { value: 'pnpm test' }
    })
    expect(screen.getByRole('button', { name: /Request delegation/ })).not.toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps submit disabled for a parent outside the authoritative active options', () => {
    render(
      <MaestroDelegationDialog
        open
        workspace={{
          repository_id: 'repo-1',
          execution_host_id: 'local',
          workspace_key: 'folder:folder-1',
          run_id: 'run-1'
        }}
        catalog={catalog}
        source={{ kind: 'canvas-point', position: { x: 10, y: 20 } }}
        parentTasks={[{ id: 'task-active', label: 'Active task' }]}
        parentTaskId="task-stale"
        paths={['src/feature.ts']}
        check="pnpm test"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Purpose' }), {
      target: { value: 'Bounded work' }
    })

    expect(screen.getByRole('button', { name: /Request delegation/ })).toBeDisabled()
  })
})
