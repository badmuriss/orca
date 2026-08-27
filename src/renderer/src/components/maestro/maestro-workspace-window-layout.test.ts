import { describe, expect, it } from 'vitest'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import {
  createMaestroSurfaceAdditionTracker,
  findWorkspaceWindowPlacementNearPosition,
  placeWorkspaceWindowNearViewport,
  workspaceWindowPlacementsOverlap,
  workspaceWindowPlacement
} from './maestro-workspace-window-layout'

const emptyDocument = {
  schema_version: 1 as const,
  last_surface_revision: 0,
  placements: {},
  annotations: {},
  manual_links: [],
  suggestion_decisions: {},
  ui_preferences: { inspector_open: false, inspector_width: 320 }
}

function surface(kind: 'terminal' | 'browser' | 'annotation'): WorkspaceSurface {
  const id = {
    execution_host_id: 'local',
    workspace_key: 'folder:workspace',
    unified_tab_id: kind
  }
  if (kind === 'terminal') {
    return {
      id,
      content_type: 'terminal',
      entity_id: 'terminal',
      group_id: 'group',
      title: 'Terminal',
      revision: 1,
      availability: 'available',
      binding: {
        kind: 'terminal',
        terminal_tab_id: 'terminal',
        pane_key: 'pane',
        session_id: 'session',
        liveness: 'live',
        pty_incarnation: '1',
        authority_revision: 1
      }
    }
  }
  if (kind === 'browser') {
    return {
      id,
      content_type: 'browser',
      entity_id: 'browser-workspace',
      group_id: 'group',
      title: 'Browser',
      revision: 1,
      availability: 'available',
      binding: {
        kind: 'browser',
        browser_workspace_id: 'browser-workspace',
        browser_page_id: 'page',
        profile_id: null,
        partition_id: null,
        authority_revision: 1,
        live_frame: null,
        immutable_capture: null
      }
    }
  }
  return {
    id,
    content_type: 'editor',
    entity_id: 'note',
    group_id: 'group',
    title: 'Note',
    revision: 1,
    availability: 'available',
    binding: {
      kind: 'content',
      entity_id: 'note',
      content_type: 'editor',
      model_revision: '1',
      owner_principal: 'runtime',
      read_only: false,
      source: {
        relative_path: 'note.md',
        language: 'markdown',
        mode: 'edit',
        diff_source: null,
        is_dirty: false
      },
      annotation: { relative_path: 'note.md', tone: 'observation' }
    }
  }
}

describe('Maestro workspace window layout', () => {
  it('tracks additions across Canvas remounts without treating the first snapshot as new', () => {
    const tracker = createMaestroSurfaceAdditionTracker()

    expect(tracker.observe('local:workspace', ['terminal'])).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'])).toEqual(['browser'])
    expect(tracker.observe('remote:workspace', ['content'])).toEqual([])
  })

  it('defers consuming additions until the Canvas viewport is measurable', () => {
    const tracker = createMaestroSurfaceAdditionTracker()

    expect(tracker.observe('local:workspace', ['terminal'])).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], false)).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], true)).toEqual(['browser'])
  })

  it('keeps the first unmeasured snapshot as the placement baseline', () => {
    const tracker = createMaestroSurfaceAdditionTracker()

    expect(tracker.observe('local:workspace', [], false)).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], false)).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], true)).toEqual([
      'browser',
      'terminal'
    ])
  })

  it('creates terminal, Browser, and annotation surfaces at readable working sizes', () => {
    expect(
      workspaceWindowPlacement('terminal', 0, emptyDocument, surface('terminal')).size
    ).toEqual({ width: 760, height: 530 })
    expect(workspaceWindowPlacement('browser', 1, emptyDocument, surface('browser')).size).toEqual({
      width: 680,
      height: 480
    })
    expect(
      workspaceWindowPlacement('annotation', 2, emptyDocument, surface('annotation')).size
    ).toEqual({ width: 440, height: 360 })
  })

  it('places new windows in a predictable two-column cluster without overlap', () => {
    const base = workspaceWindowPlacement('terminal', 0, emptyDocument, surface('terminal'))
    const first = placeWorkspaceWindowNearViewport(
      base,
      [],
      { center: { x: 1000, y: 500 }, zoom: 0.5 },
      { width: 1600, height: 900 },
      { top: 64, right: 344, bottom: 16, left: 16 }
    )
    const second = placeWorkspaceWindowNearViewport(
      base,
      [first],
      { center: { x: 1000, y: 500 }, zoom: 0.5 },
      { width: 1600, height: 900 },
      { top: 64, right: 344, bottom: 16, left: 16 }
    )

    expect(first.position).toEqual({ x: -108, y: 283 })
    expect(second.position).toEqual({ x: 692, y: 283 })
    expect(first.position.x + first.size.width).toBeLessThan(second.position.x)
  })

  it('scans around a preferred position using the candidate window dimensions', () => {
    const occupied = {
      position: { x: 0, y: 0 },
      size: { width: 360, height: 260 },
      collapsed: false,
      z_order: 4
    }
    const preferred = {
      position: { x: 120, y: 80 },
      size: { width: 760, height: 530 },
      collapsed: false,
      z_order: 0
    }

    const attempt = findWorkspaceWindowPlacementNearPosition(preferred, [occupied], {
      x: 120,
      y: 80
    })

    expect(attempt.collisionFree).toBe(true)
    expect(attempt.placement.size).toEqual(preferred.size)
    expect(attempt.placement.z_order).toBe(5)
    expect(workspaceWindowPlacementsOverlap(attempt.placement, occupied)).toBe(false)
  })
})
