import { describe, expect, it } from 'vitest'
import { projectionNodeToCanvasNode } from './maestro-projection-view-model'
describe('Maestro projection view model', () => {
  it('preserves execution profile, terminal, and workspace ownership', () => {
    const node = projectionNodeToCanvasNode({
      id: 'attempt-1',
      type: 'attempt',
      title: 'Worker',
      summary: 'Worker',
      rawStatus: 'running',
      status: 'Running',
      requestedAgent: 'codex',
      resolvedAgent: 'codex',
      requestedModel: 'a',
      resolvedModel: 'b',
      requestedEffort: 'low',
      resolvedEffort: 'high',
      terminalId: 'pty-1',
      executionHostId: 'host-local',
      workspaceKey: 'folder:one',
      position: { x: 1, y: 2 },
      live: true
    })

    expect(node).toMatchObject({
      agent: 'codex',
      requestedModel: 'a',
      resolvedModel: 'b',
      terminalId: 'pty-1',
      executionHostId: 'host-local',
      workspaceKey: 'folder:one',
      live: true
    })
  })
  it('preserves exact portal destinations and backlink direction', () => {
    const node = projectionNodeToCanvasNode({
      id: 'portal-1',
      type: 'portal',
      title: 'Execution workspace',
      summary: 'Remote child',
      rawStatus: 'running',
      status: 'Running',
      executionHostId: 'host-local',
      workspaceKey: 'folder:one',
      destinationExecutionHostId: 'ssh:remote-1',
      destinationWorkspaceKey: 'worktree:repository-1::remote-child',
      portalDirection: 'to-execution',
      position: { x: 3, y: 4 },
      live: false
    })

    expect(node).toMatchObject({
      executionHostId: 'host-local',
      workspaceKey: 'folder:one',
      destinationExecutionHostId: 'ssh:remote-1',
      destinationWorkspaceKey: 'worktree:repository-1::remote-child',
      portalDirection: 'to-execution'
    })
  })
})
