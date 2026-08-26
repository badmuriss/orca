import { describe, expect, it } from 'vitest'
import { mobileMaestroRouteTarget } from './mobile-maestro-route'

describe('mobile Maestro route', () => {
  it('keeps transport and execution-host identities distinct from Harness runs', () => {
    expect(
      mobileMaestroRouteTarget({
        hostId: 'paired-device-7',
        executionHostId: 'ssh:build-host',
        workspaceKey: 'worktree:repo::branch',
        name: 'Feature'
      })
    ).toEqual({
      name: '[hostId]/maestro/[workspaceKey]',
      params: {
        hostId: 'paired-device-7',
        executionHostId: 'ssh:build-host',
        workspaceKey: 'worktree:repo::branch',
        name: 'Feature'
      }
    })
  })
})
