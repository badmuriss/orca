// @vitest-environment happy-dom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurfaceSnapshot } from '../../../../shared/maestro-workspace-canvas'
import { MaestroWorkspaceLinks } from './MaestroWorkspaceLinks'
import type { CanvasAgentTopology } from './maestro-agent-topology'

const document: WorkspaceCanvasDocument = {
  schema_version: 1,
  last_surface_revision: 0,
  placements: {},
  annotations: {},
  manual_links: [],
  suggestion_decisions: {},
  ui_preferences: { inspector_open: false, inspector_width: 320 }
}

const snapshot: WorkspaceSurfaceSnapshot = {
  schema_version: 1,
  protocol: 'workspace-surface-snapshot/v1',
  execution_host_id: 'local',
  workspace_key: 'folder:workspace',
  authority_revision: 1,
  authority_cursor: 'cursor-1',
  state: 'ready',
  surfaces: {},
  unsupported: [],
  automatic_links: [
    {
      id: 'automatic-parent',
      source_surface_key: 'worker',
      target_surface_key: 'coordinator',
      link_type: 'parent-child',
      authority_kind: 'parent-child-receipt',
      authority_id: 'run:edge',
      authority_revision: 1,
      observed_at: '2026-08-27T12:00:00.000Z',
      explanation_code: 'parent-child'
    }
  ],
  suggested_links: [],
  capability: { available: true, reason: null },
  harness_overlay: null
}

const topology: CanvasAgentTopology = {
  coordinatorSurfaceId: 'coordinator',
  nodes: [],
  relations: [
    {
      id: 'delegate',
      sourceSurfaceId: 'coordinator',
      targetSurfaceId: 'worker',
      kind: 'delegates',
      provenance: 'orca-orchestration'
    }
  ]
}

describe('MaestroWorkspaceLinks', () => {
  it('deduplicates a reversed automatic parent link from its delegate relation', () => {
    const view = render(
      <MaestroWorkspaceLinks
        snapshot={snapshot}
        document={document}
        topology={topology}
        placements={{
          coordinator: {
            position: { x: 0, y: 0 },
            size: { width: 760, height: 530 },
            collapsed: false,
            z_order: 1
          },
          worker: {
            position: { x: 900, y: 0 },
            size: { width: 760, height: 530 },
            collapsed: false,
            z_order: 2
          }
        }}
      />
    )

    expect(view.container.querySelectorAll('[data-link-kind="delegates"]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-link-kind="automatic"]')).toHaveLength(0)
  })
})
