import { describe, expect, it } from 'vitest'
import { buildMaestroDelegationRequest } from './maestro-delegation-view-model'

describe('Maestro delegation view model', () => {
  it('builds a request from an empty Canvas point without authority fields', () => {
    const request = buildMaestroDelegationRequest({
      workspace: {
        repository_id: 'repo-1',
        execution_host_id: 'local',
        workspace_key: 'folder:folder-1',
        run_id: 'run-1'
      },
      source: { kind: 'canvas-point', position: { x: 1, y: 2 } },
      paths: ['src/shared/maestro-delegation.ts'],
      check: 'pnpm test',
      intentId: 'intent-1',
      draft: {
        role: 'implementation',
        purpose: 'Ship the bounded change',
        lane: 'balanced',
        agent: null,
        model: null,
        effort: null,
        placement: { kind: 'current-workspace' }
      }
    })
    expect(request).toMatchObject({
      source: { kind: 'canvas-point' },
      parent_task_id: null,
      requested: { lane: 'balanced' }
    })
    expect(request.paths).toEqual(['src/shared/maestro-delegation.ts'])
    expect(request.check).toBe('pnpm test')
    expect('actor' in request).toBe(false)
  })
})
