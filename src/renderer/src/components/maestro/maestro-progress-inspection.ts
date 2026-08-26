import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import { maestroRunProgressNodeId } from '../../../../shared/maestro-run-progress'
import type { MaestroProjection } from '../../../../shared/maestro-projection'
import type { MaestroCanvasNode } from './maestro-canvas-view-model'

export type MaestroDocumentKey = { executionHostId: string; workspaceKey: string }

function isScopedProgressTarget(
  candidate: MaestroCanvasNode,
  identity: MaestroRunProgressDetailIdentity,
  documentKey: MaestroDocumentKey
): boolean {
  return (
    candidate.executionHostId === identity.authority.workspace.executionHostId &&
    candidate.workspaceKey === identity.authority.workspace.workspaceKey &&
    candidate.executionHostId === documentKey.executionHostId &&
    candidate.workspaceKey === documentKey.workspaceKey &&
    candidate.runId === identity.authority.runId &&
    candidate.revision === identity.authority.revision
  )
}

/**
 * A progress detail may only open a node the same workspace and revision authored, so the
 * identity is matched against the exact run-progress card before any selection happens.
 */
export function resolveProgressInspection(args: {
  identity: MaestroRunProgressDetailIdentity
  nodes: readonly MaestroCanvasNode[]
  projection: MaestroProjection | null
  documentKey: MaestroDocumentKey
}): { open: false } | { open: true; nodeId: string | null } {
  const { identity, nodes, projection, documentKey } = args
  const progressNode = nodes.find(
    (candidate) =>
      candidate.projectedType === 'run-progress' &&
      candidate.id === maestroRunProgressNodeId(identity.authority.runId) &&
      candidate.runProgress?.available &&
      candidate.runProgress.authority.runId === identity.authority.runId &&
      candidate.runProgress.authority.revision === identity.authority.revision &&
      candidate.runProgress.authority.workspace.executionHostId ===
        identity.authority.workspace.executionHostId &&
      candidate.runProgress.authority.workspace.workspaceKey ===
        identity.authority.workspace.workspaceKey &&
      candidate.runProgress.authority.workspace.executionHostId === documentKey.executionHostId &&
      candidate.runProgress.authority.workspace.workspaceKey === documentKey.workspaceKey
  )
  if (!progressNode) {
    return { open: false }
  }
  if (
    projection &&
    (projection.runId !== identity.authority.runId ||
      projection.revision !== identity.authority.revision ||
      projection.workspace.executionHostId !== identity.authority.workspace.executionHostId ||
      projection.workspace.workspaceKey !== identity.authority.workspace.workspaceKey)
  ) {
    return { open: false }
  }
  const reference = identity.reference
  if (
    reference.task_id === null &&
    reference.attempt_id === null &&
    reference.finding_ref === null &&
    reference.cleanup_id === null
  ) {
    return { open: false }
  }
  const node =
    reference.finding_ref === null && reference.cleanup_id === null
      ? nodes.find(
          (candidate) =>
            ((reference.attempt_id !== null && candidate.attemptId === reference.attempt_id) ||
              (reference.task_id !== null && candidate.taskId === reference.task_id)) &&
            isScopedProgressTarget(candidate, identity, documentKey)
        )
      : undefined
  return { open: true, nodeId: node?.id ?? null }
}
