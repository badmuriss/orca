import { AgentGraphViewSchema, type AgentGraphView, type MaestroEdgeType } from './maestro-contract'
import {
  AgentGraphProjectionInputSchema,
  displayGraphStatus,
  parseExecutionProfile,
  parseExecutionResource,
  sameProjectedWorkspace,
  terminalReceiptIsLive,
  workspaceFromIdentity,
  type ProjectedWorkspace
} from './maestro-projection-boundary'
import { parseNegotiatedMaestroRunProgress, type MaestroRunProgress } from './maestro-run-progress'
import {
  MaestroBrowserSurfaceReceiptSchema,
  type MaestroBrowserSurfaceReceipt
} from './maestro-browser-surface'

export { AgentGraphProjectionInputSchema }
export type { ProjectedWorkspace }
export type AgentGraphProjectionInput = AgentGraphView
export type ProjectedAgentNode = {
  id: string
  type: Exclude<AgentGraphView['nodes'][number]['type'], 'browser-surface'>
  title: string
  summary: string
  rawStatus: string
  status: string
  taskId?: string
  attemptId?: string
  requestedAgent?: string | null
  resolvedAgent?: string | null
  requestedModel?: string | null
  resolvedModel?: string | null
  requestedEffort?: string | null
  resolvedEffort?: string | null
  fallbackReason?: string | null
  role?: string
  terminalId?: string | null
  terminalStatus?: string
  executionHostId: string
  workspaceKey: string
  parentWorkspaceKey?: string
  destinationExecutionHostId?: string
  destinationWorkspaceKey?: string
  portalDirection?: 'to-execution' | 'back-to-home'
  position: { x: number; y: number }
  live: boolean
  browserSurface?: MaestroBrowserSurfaceReceipt
}
export type MaestroProjection = {
  change: string
  runId: string
  repositoryId: string
  coordinator: AgentGraphView['coordinator']
  nodes: ProjectedAgentNode[]
  edges: (Omit<AgentGraphView['edges'][number], 'type'> & {
    type: MaestroEdgeType
  })[]
  revision: number
  cursor: AgentGraphView['cursor']
  source: AgentGraphView['kind']
  workspace: ProjectedWorkspace
  runProgress: MaestroRunProgress
}

type TerminalBinding = {
  terminalId: string | null
  terminalStatus: string
  live: boolean
}

function projectedEdgeType(type: AgentGraphView['edges'][number]['type']): MaestroEdgeType {
  if (type === 'opens') {
    return 'executes'
  }
  if (type === 'validates' || type === 'captured_as') {
    return 'produces'
  }
  return type
}

export function parseAgentGraphProjection(value: unknown): AgentGraphView {
  return AgentGraphViewSchema.parse(value)
}

function assignNodeWorkspaces(
  view: AgentGraphView,
  orchestrationHome: ProjectedWorkspace,
  executionWorkspace: ProjectedWorkspace
): Map<string, ProjectedWorkspace> {
  const nodeWorkspace = new Map<string, ProjectedWorkspace>()
  const attemptWorkspace = new Map<string, ProjectedWorkspace>()
  for (const node of view.nodes) {
    if (node.type !== 'attempt') {
      continue
    }
    const profile = parseExecutionProfile(node.profile)
    const resource = parseExecutionResource(node.resource)
    const placement = profile?.resolved_placement
    const workspace = {
      executionHostId:
        resource?.execution_host_id ??
        placement?.execution_host_id ??
        executionWorkspace.executionHostId,
      workspaceKey:
        resource?.workspace_key ?? placement?.workspace_key ?? executionWorkspace.workspaceKey
    }
    nodeWorkspace.set(node.id, workspace)
    attemptWorkspace.set(node.attempt_id ?? node.id, workspace)
  }
  for (const node of view.nodes) {
    if (nodeWorkspace.has(node.id)) {
      continue
    }
    const profile = parseExecutionProfile(node.profile)
    const resource = parseExecutionResource(node.resource)
    const linkedAttempt = node.attempt_id ?? resource?.attempt_id
    const placement = profile?.resolved_placement
    const fallback =
      node.type === 'task' || node.type === 'note-reference'
        ? orchestrationHome
        : executionWorkspace
    const inheritedWorkspace = linkedAttempt ? attemptWorkspace.get(linkedAttempt) : undefined
    nodeWorkspace.set(
      node.id,
      inheritedWorkspace ?? {
        executionHostId:
          resource?.execution_host_id ?? placement?.execution_host_id ?? fallback.executionHostId,
        workspaceKey: resource?.workspace_key ?? placement?.workspace_key ?? fallback.workspaceKey
      }
    )
  }
  return nodeWorkspace
}

function terminalBinding(node: AgentGraphView['nodes'][number]): TerminalBinding {
  const resource = parseExecutionResource(node.resource)
  const terminalId = resource?.terminal_id ?? null
  return {
    terminalId,
    terminalStatus: resource?.terminal_status ?? node.status,
    live: terminalId !== null && terminalReceiptIsLive(node.status, resource)
  }
}

function browserSurfaceBinding(
  node: AgentGraphView['nodes'][number]
): MaestroBrowserSurfaceReceipt | undefined {
  if (node.type !== 'browser-surface') {
    return undefined
  }
  const parsed = MaestroBrowserSurfaceReceiptSchema.safeParse(node.resource)
  return parsed.success ? parsed.data : undefined
}

function mapAttemptTerminals(view: AgentGraphView): Map<string, TerminalBinding> {
  const terminalByAttempt = new Map<string, TerminalBinding>()
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]))
  for (const node of view.nodes) {
    if (node.type !== 'terminal-receipt') {
      continue
    }
    const attemptId = node.attempt_id ?? parseExecutionResource(node.resource)?.attempt_id
    if (attemptId) {
      terminalByAttempt.set(attemptId, terminalBinding(node))
    }
  }
  for (const edge of view.edges) {
    if (edge.type !== 'executes') {
      continue
    }
    const source = nodesById.get(edge.source_id)
    const target = nodesById.get(edge.target_id)
    const attempt = source?.type === 'attempt' ? source : target?.type === 'attempt' ? target : null
    const terminal =
      source?.type === 'terminal-receipt'
        ? source
        : target?.type === 'terminal-receipt'
          ? target
          : null
    if (attempt && terminal) {
      terminalByAttempt.set(attempt.attempt_id ?? attempt.id, terminalBinding(terminal))
    }
  }
  return terminalByAttempt
}

export function projectAgentGraphView(
  view: AgentGraphView,
  targetWorkspace = workspaceFromIdentity(view.workspace_scope.execution_workspace)
): MaestroProjection {
  const orchestrationHome = workspaceFromIdentity(view.workspace_scope.orchestration_home)
  const executionWorkspace = workspaceFromIdentity(view.workspace_scope.execution_workspace)
  const singleWorkspace = sameProjectedWorkspace(orchestrationHome, executionWorkspace)
  const nodeWorkspaces = assignNodeWorkspaces(view, orchestrationHome, executionWorkspace)
  const terminalByAttempt = mapAttemptTerminals(view)
  const includedNodes = view.nodes.filter((node) => {
    if (singleWorkspace || node.type === 'portal') {
      return true
    }
    const workspace = nodeWorkspaces.get(node.id)
    return workspace ? sameProjectedWorkspace(workspace, targetWorkspace) : false
  })
  const includedIds = new Set(includedNodes.map((node) => node.id))
  const nodes = includedNodes.map((node, index): ProjectedAgentNode => {
    const profile = parseExecutionProfile(node.profile)
    const resource = parseExecutionResource(node.resource)
    const browserSurface = browserSurfaceBinding(node)
    const workspace = nodeWorkspaces.get(node.id) ?? targetWorkspace
    const attemptId = node.attempt_id ?? resource?.attempt_id
    const linkedTerminal =
      (attemptId ? terminalByAttempt.get(attemptId) : undefined) ??
      (node.type === 'terminal-receipt' ? terminalBinding(node) : undefined)
    const backlink =
      node.type === 'portal' && sameProjectedWorkspace(targetWorkspace, executionWorkspace)
    const destination = backlink ? orchestrationHome : executionWorkspace
    return {
      id: node.id,
      type: node.type === 'browser-surface' ? 'evidence' : node.type,
      title:
        node.type === 'portal'
          ? backlink
            ? 'Orchestration home'
            : 'Execution workspace'
          : node.summary,
      summary: node.summary,
      rawStatus: node.status,
      status: displayGraphStatus(node.status),
      taskId: node.task_id,
      attemptId,
      requestedAgent: profile?.requested.agent,
      resolvedAgent: profile?.resolved.agent,
      requestedModel: profile?.requested.model,
      resolvedModel: profile?.resolved.model,
      requestedEffort: profile?.requested.effort,
      resolvedEffort: profile?.resolved.effort,
      fallbackReason: profile?.fallback_reason,
      role: profile?.role,
      terminalId: linkedTerminal?.terminalId,
      terminalStatus: linkedTerminal?.terminalStatus,
      executionHostId:
        node.type === 'portal' ? targetWorkspace.executionHostId : workspace.executionHostId,
      workspaceKey: node.type === 'portal' ? targetWorkspace.workspaceKey : workspace.workspaceKey,
      parentWorkspaceKey: node.type === 'portal' ? orchestrationHome.workspaceKey : undefined,
      destinationExecutionHostId: node.type === 'portal' ? destination.executionHostId : undefined,
      destinationWorkspaceKey: node.type === 'portal' ? destination.workspaceKey : undefined,
      portalDirection:
        node.type === 'portal' ? (backlink ? 'back-to-home' : 'to-execution') : undefined,
      position: node.position ?? {
        x: (index % 4) * 264 + 48,
        y: Math.floor(index / 4) * 160 + 48
      },
      live: linkedTerminal?.live ?? false,
      browserSurface
    }
  })
  return {
    change: view.change,
    runId: view.run_id,
    repositoryId: view.workspace_scope.repository_id,
    coordinator: view.coordinator,
    nodes,
    edges: view.edges
      .filter((edge) => includedIds.has(edge.source_id) && includedIds.has(edge.target_id))
      .map((edge) => ({ ...edge, type: projectedEdgeType(edge.type) })),
    revision: view.revision,
    cursor: view.cursor,
    source: view.kind,
    workspace: targetWorkspace,
    runProgress: parseNegotiatedMaestroRunProgress(
      view.progress,
      view.run_id === view.workspace_scope.run_id &&
        sameProjectedWorkspace(targetWorkspace, executionWorkspace)
        ? {
            runId: view.run_id,
            workspace: executionWorkspace,
            revision: view.revision
          }
        : null
    )
  }
}

export { applyAgentGraphDelta } from './maestro-graph-delta'
