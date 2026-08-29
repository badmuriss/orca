import type {
  AgentGraphView,
  MaestroDocumentReadScope,
  MaestroWorkspaceAnchor
} from '../../../../../shared/maestro-contract'
import { parseAgentGraphView } from '../../../../../shared/maestro-contract'
import {
  MaestroBootstrapReceiptSchema,
  type MaestroBootstrapReceipt,
  type MaestroBootstrapRequest
} from '../../../../../shared/maestro-bootstrap-contract'
import {
  applyAgentGraphDelta,
  projectAgentGraphView,
  type MaestroProjection
} from '../../../../../shared/maestro-projection'
import type { OrchestrationDb } from '../orchestration-db'

const MAX_PROJECTIONS_PER_DATABASE = 128
type StoredProjection = { view: AgentGraphView; updatedAt: string }
type BootstrapRecords = {
  byMutation: Map<string, { request: MaestroBootstrapRequest; receipt: MaestroBootstrapReceipt }>
  byWorkspace: Map<string, MaestroBootstrapReceipt>
}

const projectionsByDatabase = new WeakMap<OrchestrationDb, Map<string, StoredProjection>>()
const bootstrapRecordsByDatabase = new WeakMap<OrchestrationDb, BootstrapRecords>()

function projectionKey(scope: MaestroDocumentReadScope): string {
  return `${scope.execution_host_id}\0${scope.workspace_key}`
}

function projectionMap(database: OrchestrationDb): Map<string, StoredProjection> {
  const existing = projectionsByDatabase.get(database)
  if (existing) {
    return existing
  }
  const created = new Map<string, StoredProjection>()
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
  projections: Map<string, StoredProjection>,
  key: string,
  projection: StoredProjection
): void {
  projections.delete(key)
  projections.set(key, projection)
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
          projections.get(homeKey)?.view ??
            (() => {
              throw new Error('AgentGraphView delta has no active snapshot.')
            })(),
          sanitizedView
        )
  const projection = { view: nextView, updatedAt: new Date().toISOString() }
  retainBounded(projections, homeKey, projection)
  retainBounded(projections, projectionKey(execution), projection)
  return projectAgentGraphView(nextView, {
    executionHostId: home.execution_host_id,
    workspaceKey: home.workspace_key
  })
}

export function getMaestroProjection(
  this: OrchestrationDb,
  scope: MaestroDocumentReadScope
): MaestroProjection | null {
  const projection = projectionMap(this).get(projectionKey(scope))
  if (!projection) {
    return null
  }
  return projectAgentGraphView(projection.view, {
    executionHostId: scope.execution_host_id,
    workspaceKey: scope.workspace_key
  })
}

export function listMaestroRunProgress(this: OrchestrationDb): {
  executionHostId: string
  workspaceKey: string
  runProgress: MaestroProjection['runProgress']
}[] {
  return uniqueProjections(this).map(({ view }) => ({
    executionHostId: view.workspace_scope.execution_workspace.execution_host_id,
    workspaceKey: view.workspace_scope.execution_workspace.workspace_key,
    runProgress: projectAgentGraphView(view, {
      executionHostId: view.workspace_scope.execution_workspace.execution_host_id,
      workspaceKey: view.workspace_scope.execution_workspace.workspace_key
    }).runProgress
  }))
}

export function listMaestroProjectionIndex(this: OrchestrationDb): {
  executionHostId: string
  workspaceKey: string
  revision: number
  updatedAt: string
  runId: string
}[] {
  return uniqueProjections(this).map(({ view, updatedAt }) => ({
    executionHostId: view.workspace_scope.execution_workspace.execution_host_id,
    workspaceKey: view.workspace_scope.execution_workspace.workspace_key,
    revision: view.revision,
    updatedAt,
    runId: view.run_id
  }))
}

export function applyMaestroBootstrapProjection(
  this: OrchestrationDb,
  workspace: MaestroWorkspaceAnchor,
  view: AgentGraphView
): 'published' | 'replayed' {
  const sanitizedView = parseAgentGraphView(view)
  if (sanitizedView.kind !== 'snapshot' || sanitizedView.revision !== 0) {
    throw new Error('Maestro bootstrap requires a revision-zero snapshot.')
  }
  requireMatchingAuthority(workspace, sanitizedView)
  const projections = projectionMap(this)
  const keys = [
    projectionKey(sanitizedView.workspace_scope.orchestration_home),
    projectionKey(sanitizedView.workspace_scope.execution_workspace)
  ]
  const existing = keys.map((key) => projections.get(key)).find(Boolean)
  if (existing) {
    if (!sameBootstrapBinding(existing.view, sanitizedView)) {
      throw new Error('Maestro bootstrap conflicts with the active Run or workspace base.')
    }
    return 'replayed'
  }
  applyMaestroProjection.call(this, workspace, sanitizedView)
  return 'published'
}

export function replayMaestroBootstrap(
  this: OrchestrationDb,
  request: MaestroBootstrapRequest
): MaestroBootstrapReceipt | null {
  const records = bootstrapRecords(this)
  const existingMutation = records.byMutation.get(request.mutation.mutation_id)
  if (existingMutation) {
    if (JSON.stringify(existingMutation.request) !== JSON.stringify(request)) {
      throw new Error('Maestro bootstrap mutation identity was reused with different input.')
    }
    return { ...existingMutation.receipt, outcome: 'replayed' }
  }
  const existingWorkspace = records.byWorkspace.get(projectionKey(request.mutation))
  if (!existingWorkspace) {
    return null
  }
  if (
    existingWorkspace.mutation.run_id !== request.mutation.run_id ||
    existingWorkspace.coordinator_generation !== request.coordinator_generation
  ) {
    throw new Error('Maestro bootstrap conflicts with the active Run binding.')
  }
  const replay = MaestroBootstrapReceiptSchema.parse({
    ...existingWorkspace,
    mutation: request.mutation,
    outcome: 'replayed'
  })
  records.byMutation.set(request.mutation.mutation_id, { request, receipt: replay })
  return replay
}

export function recordMaestroBootstrap(
  this: OrchestrationDb,
  request: MaestroBootstrapRequest,
  receipt: MaestroBootstrapReceipt
): void {
  const records = bootstrapRecords(this)
  const parsed = MaestroBootstrapReceiptSchema.parse(receipt)
  records.byMutation.set(request.mutation.mutation_id, { request, receipt: parsed })
  records.byWorkspace.set(projectionKey(request.mutation), parsed)
}

function uniqueProjections(database: OrchestrationDb): StoredProjection[] {
  return [...new Set(projectionMap(database).values())]
}

function sameBootstrapBinding(left: AgentGraphView, right: AgentGraphView): boolean {
  return (
    left.run_id === right.run_id &&
    left.workspace_scope.repository_id === right.workspace_scope.repository_id &&
    left.workspace_scope.base_revision === right.workspace_scope.base_revision &&
    left.coordinator.generation === right.coordinator.generation &&
    JSON.stringify(left.workspace_scope.orchestration_home) ===
      JSON.stringify(right.workspace_scope.orchestration_home) &&
    JSON.stringify(left.workspace_scope.execution_workspace) ===
      JSON.stringify(right.workspace_scope.execution_workspace)
  )
}

function bootstrapRecords(database: OrchestrationDb): BootstrapRecords {
  const existing = bootstrapRecordsByDatabase.get(database)
  if (existing) {
    return existing
  }
  const created = {
    byMutation: new Map<
      string,
      { request: MaestroBootstrapRequest; receipt: MaestroBootstrapReceipt }
    >(),
    byWorkspace: new Map<string, MaestroBootstrapReceipt>()
  }
  bootstrapRecordsByDatabase.set(database, created)
  return created
}
