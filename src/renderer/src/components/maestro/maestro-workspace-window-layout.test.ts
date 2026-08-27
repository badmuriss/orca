import { describe, expect, it } from 'vitest'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import {
  createMaestroSurfaceAdditionTracker,
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

function surface(kind: 'terminal' | 'annotation'): WorkspaceSurface {
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

  it('creates terminals and annotations at readable working sizes', () => {
    expect(
      workspaceWindowPlacement('terminal', 0, emptyDocument, surface('terminal')).size
    ).toEqual({ width: 760, height: 530 })
    expect(
      workspaceWindowPlacement('annotation', 1, emptyDocument, surface('annotation')).size
    ).toEqual({ width: 440, height: 360 })
  })
})
