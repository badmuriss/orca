import type { DispatchContextRow, TaskRow } from './types'

function compareDispatches(left: DispatchContextRow, right: DispatchContextRow): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
}

export function selectCurrentTaskDispatches(
  tasks: readonly TaskRow[],
  dispatches: readonly DispatchContextRow[]
): DispatchContextRow[] {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const))
  const currentByTask = new Map<string, DispatchContextRow>()
  for (const dispatch of [...dispatches].sort(compareDispatches)) {
    if (!taskById.has(dispatch.task_id)) {
      continue
    }
    currentByTask.set(dispatch.task_id, dispatch)
  }

  return tasks.flatMap((task) => {
    const current = currentByTask.get(task.id)
    return current ? [current] : []
  })
}
