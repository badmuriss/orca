import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MaestroBrowserSurfaceRequestSchema } from '../../../../../shared/maestro-browser-surface'
import { OrchestrationDb } from '../orchestration-db'

const request = MaestroBrowserSurfaceRequestSchema.parse({
  schema_version: 1,
  protocol: 'maestro-browser-surface/v1',
  request_id: 'request-1',
  workspace: {
    repository_id: 'repo-1',
    execution_host_id: 'local',
    workspace_key: 'folder:workspace-1',
    run_id: 'run-1'
  },
  actor: {
    actor_id: 'coordinator-1',
    kind: 'coordinator',
    authenticated: true,
    session_id: 'session-1'
  },
  coordinator_generation: 1,
  task_id: 'ORC-07B',
  attempt_id: 'attempt-orc-07b-001',
  agent_id: 'agent-1',
  url: 'https://user:secret@example.com/validation?token=secret#fragment',
  title: 'Browser validation',
  profile_id: null,
  requested_visibility: 'visible',
  viewport: { width: 1920, height: 1080, device_scale_factor: 1 },
  retention: 'release_when_settled',
  ownership: 'harness',
  evidence: {
    route_or_component: 'Maestro browser surface',
    state: 'visible validation attached light',
    theme: 'light',
    source_revision: 'revision-1',
    capture_mode: 'native-viewport'
  }
})

describe('Maestro browser surface store', () => {
  let database: OrchestrationDb

  beforeEach(() => {
    database = new OrchestrationDb(':memory:')
  })

  afterEach(() => database.close())

  it('reserves one exact page for repeated task and attempt requests', () => {
    const first = database.reserveMaestroBrowserSurface(request)
    const replay = database.reserveMaestroBrowserSurface(request)

    expect(replay.receipt.surface_id).toBe(first.receipt.surface_id)
    expect(replay.receipt.browser_page_id).toBe('maestro-request-1')
    expect(replay.receipt.url).toBe('https://example.com/validation')
    expect(replay.navigationUrl).toContain('token=secret')
  })

  it('rejects request id reuse with different authority', () => {
    database.reserveMaestroBrowserSurface(request)
    expect(() =>
      database.reserveMaestroBrowserSurface({ ...request, agent_id: 'agent-2' })
    ).toThrow('another identity')
  })

  it('updates lifecycle receipts without changing durable identity', () => {
    const reserved = database.reserveMaestroBrowserSurface(request)
    const updated = database.updateMaestroBrowserSurface(
      reserved.receipt.surface_id,
      (receipt) => ({
        ...receipt,
        state: 'retained',
        observed_visibility: 'visible'
      })
    )

    expect(updated.receipt).toMatchObject({
      surface_id: reserved.receipt.surface_id,
      request_id: request.request_id,
      state: 'retained',
      observed_visibility: 'visible'
    })
    expect(database.listReconcilableMaestroBrowserSurfaces()).toHaveLength(1)
  })
})
