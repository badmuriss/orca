export function resolveMaestroWorkspaceSurfaceTitle(
  title: string,
  agentFunctionLabel: string | undefined,
  agentTaskId: string | undefined
): string {
  const functionLabel = agentFunctionLabel?.trim()
  const taskId = agentTaskId?.trim()
  if (!functionLabel || !taskId) {
    return title
  }
  const generatedTitles = new Set([
    `worker-${taskId}`,
    `worker-task_${taskId}`,
    `worker-task-${taskId}`
  ])
  return generatedTitles.has(title) ? functionLabel : title
}
