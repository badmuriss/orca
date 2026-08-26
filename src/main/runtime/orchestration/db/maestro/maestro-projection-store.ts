import type {
  AgentGraphView,
  MaestroDocumentReadScope,
  MaestroWorkspaceAnchor
} from '../../../../../shared/maestro-contract'
import { parseAgentGraphView } from '../../../../../shared/maestro-contract'
import {
  applyAgentGraphDelta,
  projectAgentGraphView,
  type MaestroProjection
} from '../../../../../shared/maestro-projection'
import type { OrchestrationDb } from '../orchestration-db'

const MAX_PROJECTIONS_PER_DATABASE = 128
const projectionsByDatabase = new WeakMap<OrchestrationDb, Map<string, AgentGraphView>>()

function projectionKey(scope: MaestroDocumentReadScope): string {
  return `${scope.execution_host_id}\0${scope.workspace_key}`
}

function projectionMap(database: OrchestrationDb): Map<string, AgentGraphView> {
  const existing = projectionsByDatabase.get(database)
  if (existing) {
    return existing
  }
  const created = new Map<string, AgentGraphView>()
  projectionsByDatabase.set(database, created)
  return created
}

function requireMatchingAuthority(workspace: MaestroWorkspaceAnchor, view: AgentGraphView): void {
  const home = view.workspace_scope.orchestration_home
  if (
    workspace.repository_id !== view.workspace_scope.repository_id ||
    workspace.run_id !== view.run_id ||
    view.workspace_scope.run_id !== view.run_id ||
    workspace.execution_host_id !== home.execution_host_id ||
    workspace.workspace_key !== home.workspace_key ||
    view.coordinator.generation !== view.workspace_scope.coordinator_generation
  ) {
    throw new Error('AgentGraphView is not bound to the publishing coordinator workspace.')
  }
  if (
    (view.cursor && view.cursor.revision !== view.revision) ||
    (view.kind === 'snapshot' && (view.from_cursor !== null || view.reset_required))
  ) {
    throw new Error('AgentGraphView snapshot or cursor is inconsistent.')
  }
}

function retainBounded(
  projections: Map<string, AgentGraphView>,
  key: string,
  view: AgentGraphView
): void {
  projections.delete(key)
  projections.set(key, view)
  while (projections.size > MAX_PROJECTIONS_PER_DATABASE) {
    const oldest = projections.keys().next().value
    if (typeof oldest !== 'string') {
      return
    }
    projections.delete(oldest)
  }
}

export function applyMaestroProjection(
  this: OrchestrationDb,
  workspace: MaestroWorkspaceAnchor,
  view: AgentGraphView
): MaestroProjection {
  const sanitizedView = parseAgentGraphView(view)
  requireMatchingAuthority(workspace, sanitizedView)
  const projections = projectionMap(this)
  const home = sanitizedView.workspace_scope.orchestration_home
  const execution = sanitizedView.workspace_scope.execution_workspace
  const homeKey = projectionKey(home)
  const nextView =
    sanitizedView.kind === 'snapshot'
      ? sanitizedView
      : applyAgentGraphDelta(
          projections.get(homeKey) ??
            (() => {
              throw new Error('AgentGraphView delta has no active snapshot.')
            })(),
          sanitizedView
        )
  retainBounded(projections, homeKey, nextView)
  retainBounded(projections, projectionKey(execution), nextView)
  return projectAgentGraphView(nextView, {
    executionHostId: home.execution_host_id,
    workspaceKey: home.workspace_key
  })
}

export function getMaestroProjection(
  this: OrchestrationDb,
  scope: MaestroDocumentReadScope
): MaestroProjection | null {
  const view = projectionMap(this).get(projectionKey(scope))
  if (!view) {
    return null
  }
  return projectAgentGraphView(view, {
    executionHostId: scope.execution_host_id,
    workspaceKey: scope.workspace_key
  })
}

export function listMaestroRunProgress(this: OrchestrationDb): {
  executionHostId: string
  workspaceKey: string
  runProgress: MaestroProjection['runProgress']
}[] {
  return [...projectionMap(this).values()].map((view) => ({
    executionHostId: view.workspace_scope.execution_workspace.execution_host_id,
    workspaceKey: view.workspace_scope.execution_workspace.workspace_key,
    runProgress: projectAgentGraphView(view, {
      executionHostId: view.workspace_scope.execution_workspace.execution_host_id,
      workspaceKey: view.workspace_scope.execution_workspace.workspace_key
    }).runProgress
  }))
}
