// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaestroBrowserSurfaceReceiptSchema } from '../../../../shared/maestro-browser-surface'
import { MaestroBrowserSurfaceInspector } from './MaestroBrowserSurfaceInspector'

const receipt = MaestroBrowserSurfaceReceiptSchema.parse({
  schema_version: 1,
  protocol: 'maestro-browser-surface/v1',
  surface_id: 'browser-surface-1',
  request_id: 'request-1',
  run_id: 'run-1',
  task_id: 'ORC-07B',
  attempt_id: 'attempt-1',
  agent_id: 'agent-1',
  owner_principal: 'coordinator-1',
  ownership: 'harness',
  execution_host_id: 'local',
  workspace_key: 'folder:workspace-1',
  browser_page_id: 'page-1',
  title: 'Browser validation',
  url: 'https://example.com/validation',
  origin: 'https://example.com',
  profile_id: null,
  requested_visibility: 'visible',
  observed_visibility: 'visible',
  viewport: { width: 1920, height: 1080, device_scale_factor: 1 },
  retention: 'release_when_settled',
  state: 'active',
  focus_receipt: {
    requested: true,
    workspace_activated: true,
    exact_page_selected: true,
    native_pane_paint: 'painted',
    observed_at: '2026-08-24T12:00:00.000Z',
    unavailable_reason: null
  },
  evidence: {
    route_or_component: 'Maestro browser surface',
    state: 'visible validation attached light',
    theme: 'light',
    source_revision: 'revision-1',
    capture_mode: 'native-viewport'
  },
  evidence_receipt: {
    protocol: 'maestro-browser-evidence/v1',
    artifact_ref: 'artifact:capture.png',
    artifact_hash: `sha256:${'a'.repeat(64)}`,
    format: 'png',
    dimensions: { width: 1920, height: 1080, device_scale_factor: 1 },
    route_or_component: 'Maestro browser surface',
    state: 'visible validation attached light',
    theme: 'light',
    source_revision: 'revision-1',
    capture_mode: 'native-viewport',
    captured_at: '2026-08-24T12:00:00.000Z',
    vision_review: { outcome: 'pass', reviewer: 'vision', observation: 'No clipping.' }
  },
  release_receipt: {
    requested: false,
    outcome: 'not_requested',
    exact_page_closed: false,
    profile_affected: false,
    observed_at: null,
    reason: null
  },
  created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z'
})

afterEach(cleanup)

describe('MaestroBrowserSurfaceInspector', () => {
  it('closes only the inspector and releases its preview', () => {
    const onClose = vi.fn()
    const onPreviewRelease = vi.fn()
    const view = render(
      <MaestroBrowserSurfaceInspector
        receipt={receipt}
        previewDataUrl="data:image/png;base64,AA=="
        onClose={onClose}
        onPreviewRelease={onPreviewRelease}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(onPreviewRelease).toHaveBeenCalledOnce()
  })
})
