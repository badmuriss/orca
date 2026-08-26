// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyWorkspaceCanvasDocument } from '../../../../shared/maestro-workspace-document-state'
import type { Tab } from '../../../../shared/tab-types'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/runtime/runtime-maestro-workspace-client', () => ({
  getRuntimeMaestroWorkspaceCanvas: query,
  mutateRuntimeMaestroWorkspaceCanvas: vi.fn()
}))

import { getPinnedRuntimeTarget, MaestroSurface } from './MaestroSurface'

let root: Root | null = null
let container: HTMLDivElement | null = null

function makeMaestroTab(): Tab {
  return {
    id: 'maestro-1',
    entityId: 'maestro-1',
    groupId: 'group-1',
    worktreeId: 'worktree-1',
    contentType: 'maestro',
    label: 'Maestro',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    maestroExecutionHostId: 'local',
    maestroWorkspaceKey: 'worktree:worktree-1'
  }
}

function available() {
  return {
    status: 'available' as const,
    actor_id: 'actor-1',
    snapshot: {
      schema_version: 1 as const,
      protocol: 'workspace-surface-snapshot/v1' as const,
      execution_host_id: 'local',
      workspace_key: 'worktree:worktree-1',
      authority_revision: 1,
      authority_cursor: 'cursor-1',
      state: 'ready' as const,
      surfaces: {},
      unsupported: [],
      automatic_links: [],
      suggested_links: [],
      capability: { available: true, reason: null },
      harness_overlay: null
    },
    canvas: { revision: 0, document: emptyWorkspaceCanvasDocument(), updated_at: null }
  }
}

async function renderSurface(tab = makeMaestroTab()): Promise<void> {
  await act(async () => {
    root?.render(<MaestroSurface tab={tab} />)
    await Promise.resolve()
  })
}

beforeEach(() => {
  query.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('MaestroSurface', () => {
  it('queries the exact pinned workspace without requiring a Run', async () => {
    query.mockResolvedValue(available())
    await renderSurface()
    expect(query).toHaveBeenCalledWith(
      { kind: 'local' },
      { execution_host_id: 'local', workspace_key: 'worktree:worktree-1' }
    )
    expect(container?.textContent).toContain('No workspace resources yet')
    expect(container?.textContent).toContain('A Harness Run is optional')
  })

  it('renders an honest update-required state', async () => {
    query.mockResolvedValue({
      status: 'unavailable',
      reason: 'update-required',
      liveness: 'unverifiable'
    })
    await renderSurface()
    expect(container?.textContent).toContain('Workspace Canvas unavailable')
    expect(container?.textContent).toContain('Update the remote Orca host')
  })

  it('rejects a pinned tab without an exact workspace scope', async () => {
    await renderSurface({
      ...makeMaestroTab(),
      maestroExecutionHostId: undefined,
      maestroWorkspaceKey: undefined
    })
    expect(query).not.toHaveBeenCalled()
    expect(container?.textContent).toContain('Workspace Canvas scope is unavailable')
  })

  it('preserves local, SSH, and paired runtime routing', () => {
    expect(getPinnedRuntimeTarget('local')).toEqual({ kind: 'local' })
    expect(getPinnedRuntimeTarget('ssh:my%20host')).toEqual({ kind: 'local' })
    expect(getPinnedRuntimeTarget('runtime:visual-runtime')).toEqual({
      kind: 'environment',
      environmentId: 'visual-runtime'
    })
  })
})
