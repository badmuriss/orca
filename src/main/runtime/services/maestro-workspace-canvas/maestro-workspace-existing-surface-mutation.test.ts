import { describe, expect, it, vi } from 'vitest'
import { workspaceSurfaceKey } from '../../../../shared/maestro-workspace-canvas'
import { mutateExistingMaestroWorkspaceSurface } from './maestro-workspace-existing-surface-mutation'

vi.mock('../../orchestration/db/maestro-workspace-canvas/maestro-workspace-canvas-store', () => ({
  writeWorkspaceCanvasDocument: vi.fn(() => ({ revision: 8 }))
}))

describe('existing Maestro workspace surface mutations', () => {
  it('focuses the exact existing Browser tab through its acknowledged owner', async () => {
    const scope = { execution_host_id: 'local', workspace_key: 'workspace-1' }
    const surfaceId = { ...scope, unified_tab_id: 'browser-unified-1' }
    const surfaceKey = workspaceSurfaceKey(surfaceId)
    const commandMaestroWorkspaceTab = vi.fn().mockResolvedValue({
      tabId: surfaceId.unified_tab_id
    })
    const activateMobileSessionTab = vi.fn()

    await mutateExistingMaestroWorkspaceSurface({
      runtime: { commandMaestroWorkspaceTab, activateMobileSessionTab } as never,
      database: {} as never,
      selector: 'id:workspace-1',
      request: {
        action: 'focus',
        scope,
        actor_id: 'actor-1',
        expected_authority_revision: 4,
        expected_canvas_revision: 7,
        idempotency_key: 'focus-browser-1',
        surface_id: surfaceId
      },
      before: {
        status: 'available',
        actor_id: 'actor-1',
        snapshot: {
          authority_revision: 4,
          surfaces: {
            [surfaceKey]: {
              id: surfaceId,
              content_type: 'browser',
              entity_id: 'browser-workspace-1',
              group_id: 'group-1',
              title: 'Browser',
              revision: 4,
              availability: 'available',
              binding: {
                kind: 'browser',
                browser_workspace_id: 'browser-workspace-1',
                browser_page_id: 'browser-page-1',
                profile_id: null,
                partition_id: null,
                authority_revision: 4,
                live_frame: null,
                immutable_capture: null
              }
            }
          }
        },
        canvas: {
          revision: 7,
          document: {
            placements: {
              [surfaceKey]: {
                position: { x: 10, y: 20 },
                size: { width: 320, height: 220 },
                z_order: 1
              }
            }
          }
        }
      } as never
    })

    expect(commandMaestroWorkspaceTab).toHaveBeenCalledWith({
      kind: 'focus',
      worktreeId: 'workspace-1',
      tabId: 'browser-unified-1'
    })
    expect(activateMobileSessionTab).not.toHaveBeenCalled()
  })
})
