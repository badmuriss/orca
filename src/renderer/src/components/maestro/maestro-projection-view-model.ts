import type { MaestroProjection, ProjectedAgentNode } from '../../../../shared/maestro-projection'
import type { MaestroCanvasEdge, MaestroCanvasNode, MaestroSpatialGraph } from './MaestroCanvas'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { maestroRunProgressNodeId } from '../../../../shared/maestro-run-progress'
import { translate } from '@/i18n/i18n'

function knownAgent(value: string | undefined): TuiAgent | undefined {
  if (!value) {
    return undefined
  }
  return getAgentCatalog().find((entry) => entry.id === value)?.id
}
function nodeTitle(node: ProjectedAgentNode): string {
  if (node.type === 'attempt' && node.role) {
    return node.role
  }
  if (node.type === 'portal') {
    return 'Workspace portal'
  }
  return node.title
}
export function projectionNodeToCanvasNode(node: ProjectedAgentNode): MaestroCanvasNode {
  return {
    id: node.id,
    title: nodeTitle(node),
    summary: node.summary,
    status: node.status,
    rawStatus: node.rawStatus,
    position: node.position,
    agent: knownAgent(node.resolvedAgent ?? node.requestedAgent ?? undefined),
    model: node.resolvedModel ?? node.requestedModel ?? undefined,
    effort: node.resolvedEffort ?? node.requestedEffort ?? undefined,
    kind: 'projected',
    projectedType: node.type,
    taskId: node.taskId,
    attemptId: node.attemptId,
    requestedAgent: node.requestedAgent,
    resolvedAgent: node.resolvedAgent,
    requestedModel: node.requestedModel,
    resolvedModel: node.resolvedModel,
    requestedEffort: node.requestedEffort,
    resolvedEffort: node.resolvedEffort,
    fallbackReason: node.fallbackReason,
    role: node.role,
    terminalId: node.terminalId,
    live: node.live,
    executionHostId: node.executionHostId,
    workspaceKey: node.workspaceKey,
    parentWorkspaceKey: node.parentWorkspaceKey,
    destinationExecutionHostId: node.destinationExecutionHostId,
    destinationWorkspaceKey: node.destinationWorkspaceKey,
    portalDirection: node.portalDirection,
    browserSurface: node.browserSurface
  }
}
export function projectionToCanvasGraph(projection: MaestroProjection): MaestroSpatialGraph {
  const nodes = [
    {
      id: maestroRunProgressNodeId(projection.runId),
      title: translate(
        'auto.components.maestro.maestro.projection.view.model.7069181975',
        'Run progress'
      ),
      summary: `Run ${projection.runId}`,
      status: projection.runProgress.available
        ? projection.runProgress.summary.state
        : projection.runProgress.state,
      position: { x: 48, y: 48 },
      kind: 'projected' as const,
      projectedType: 'run-progress' as const,
      runProgress: projection.runProgress
    },
    ...projection.nodes.map((node) => ({
      ...projectionNodeToCanvasNode(node),
      runId: projection.runId,
      revision: projection.revision
    }))
  ]
  const edges: MaestroCanvasEdge[] = projection.edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.source_id,
    targetId: edge.target_id,
    type: edge.type,
    projected: true
  }))
  return { nodes, edges }
}
