import type { MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import type { MaestroCanvasNode, MaestroCanvasPoint } from './maestro-canvas-view-model'
import type { DelegationContext } from './useMaestroDelegation'

function hasNodeAuthority(node: MaestroCanvasNode, workspace: MaestroWorkspaceAnchor): boolean {
  return (
    node.executionHostId === workspace.execution_host_id &&
    node.workspaceKey === workspace.workspace_key &&
    node.runId === workspace.run_id
  )
}

function hasActiveDelegationStatus(rawStatus: string | undefined): boolean {
  return rawStatus === 'active' || rawStatus === 'running'
}

function isActiveTaskNode(node: MaestroCanvasNode, workspace: MaestroWorkspaceAnchor): boolean {
  return (
    node.projectedType === 'task' &&
    hasActiveDelegationStatus(node.rawStatus) &&
    hasNodeAuthority(node, workspace)
  )
}

function isActiveAttemptNode(node: MaestroCanvasNode, workspace: MaestroWorkspaceAnchor): boolean {
  return (
    node.projectedType === 'attempt' &&
    hasActiveDelegationStatus(node.rawStatus) &&
    hasNodeAuthority(node, workspace)
  )
}

export function getMaestroNodeDelegationContext(
  node: MaestroCanvasNode,
  nodes: readonly MaestroCanvasNode[] = [],
  workspace: MaestroWorkspaceAnchor | null = null
): DelegationContext | null {
  if (node.projectedType === 'task') {
    const taskId = node.taskId
    if (!workspace || !taskId || !isActiveTaskNode(node, workspace)) {
      return null
    }
    return { source: { kind: 'task', task_id: taskId }, parentTaskId: taskId }
  }
  if (node.projectedType === 'attempt') {
    const attemptId = node.attemptId
    const taskId = node.taskId
    if (
      !workspace ||
      !attemptId ||
      !taskId ||
      !isActiveAttemptNode(node, workspace) ||
      !nodes.some(
        (candidate) => candidate.taskId === taskId && isActiveTaskNode(candidate, workspace)
      )
    ) {
      return null
    }
    return {
      source: { kind: 'attempt', attempt_id: attemptId },
      parentTaskId: taskId,
      parentAttemptId: attemptId
    }
  }
  if (node.kind === 'note' && Number.isInteger(node.noteRevision) && (node.noteRevision ?? 0) > 0) {
    return {
      source: { kind: 'note', note_id: node.id, revision: String(node.noteRevision) },
      contextRefs: node.contextSnapshotId ? [node.contextSnapshotId] : undefined
    }
  }
  return null
}

export function getMaestroCanvasPointDelegationContext(
  position: MaestroCanvasPoint
): DelegationContext {
  return { source: { kind: 'canvas-point', position } }
}

export function delegationParentOptions(
  nodes: readonly MaestroCanvasNode[],
  workspace: MaestroWorkspaceAnchor
): {
  tasks: { id: string; label: string }[]
  attempts: { id: string; taskId: string; label: string }[]
} {
  const tasks = nodes.flatMap((node) =>
    isActiveTaskNode(node, workspace) && node.taskId ? [{ id: node.taskId, label: node.title }] : []
  )
  const activeTaskIds = new Set(tasks.map((task) => task.id))
  const attempts = nodes.flatMap((node) =>
    isActiveAttemptNode(node, workspace) &&
    node.attemptId &&
    node.taskId &&
    activeTaskIds.has(node.taskId)
      ? [{ id: node.attemptId, taskId: node.taskId, label: node.title }]
      : []
  )
  return { tasks, attempts }
}
