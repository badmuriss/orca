import type { MaestroTerminalLease } from '../../../shared/maestro-terminal-lease'
import {
  MAESTRO_RUN_PROGRESS_LIST_LIMIT,
  MAESTRO_RUN_PROGRESS_TEXT_MAX_LENGTH,
  MaestroRunProgressV2Schema,
  type MaestroRunProgressV2
} from '../../../shared/maestro-run-progress'
import type { OrchestrationNestedAgentActivity } from '../../../shared/orchestration-nested-agent-activity'
import { buildOrchestrationTaskDisplayMetadata } from '../../../shared/orchestration-task-display'
import type { DispatchContextRow, MessageRow, RunRow, TaskRow } from './types'

type TaskOutcome = keyof MaestroRunProgressV2['execution']['counts']
type CreatedRow = { created_at: string; id: string }

export type MaestroRunProgressProjectionInput = {
  run: RunRow
  tasks: readonly TaskRow[]
  dispatches: readonly DispatchContextRow[]
  messages: readonly MessageRow[]
  terminalLeases: readonly MaestroTerminalLease[]
  nestedActivity: readonly OrchestrationNestedAgentActivity[]
  executionHostId: string
  workspaceKey: string
  revision: number
  projectionHealth: MaestroRunProgressV2['projection_health']
  cleanupHealth: MaestroRunProgressV2['cleanup_health']
}

type TaskProjection = {
  task: TaskRow
  title: string
  workerLabel?: string
  dispatch?: DispatchContextRow
  outcome: TaskOutcome
}

export function projectMaestroRunProgress(
  input: MaestroRunProgressProjectionInput
): MaestroRunProgressV2 {
  const orderedTasks = [...input.tasks].sort(compareCreatedRows)
  const dispatchesByTask = new Map(
    [...input.dispatches]
      .sort(compareCreatedRows)
      .map((dispatch) => [dispatch.task_id, dispatch] as const)
  )
  const leasesByTask = new Map(
    [...input.terminalLeases]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .flatMap((lease) => (lease.taskId ? [[lease.taskId, lease] as const] : []))
  )
  const titles = disambiguateTaskTitles(orderedTasks)
  const tasks = orderedTasks.map((task, index): TaskProjection => {
    const dispatch = dispatchesByTask.get(task.id)
    const lease = leasesByTask.get(task.id)
    const workerLabel = task.display_name?.trim()
    const title = titles[index] as string
    return {
      task,
      title,
      ...(workerLabel ? { workerLabel: boundedText(workerLabel, title) } : {}),
      ...(dispatch ? { dispatch } : {}),
      outcome: taskOutcome(task, dispatch, lease)
    }
  })
  const counts: MaestroRunProgressV2['execution']['counts'] = {
    pending: 0,
    running: 0,
    input_required: 0,
    blocked: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0
  }
  for (const task of tasks) {
    counts[task.outcome] += 1
  }
  const completed = counts.succeeded + counts.failed + counts.cancelled
  const total = tasks.length
  const executionState: MaestroRunProgressV2['execution']['state'] =
    total > 0 && completed === total
      ? counts.failed > 0
        ? 'completed_with_failures'
        : counts.cancelled > 0
          ? 'cancelled'
          : 'completed'
      : counts.blocked > 0
        ? 'blocked'
        : counts.input_required > 0
          ? 'input_required'
          : 'active'

  return MaestroRunProgressV2Schema.parse({
    schema_version: 2,
    run: { id: input.run.id, title: boundedText(input.run.objective, 'Untitled run') },
    execution: {
      state: executionState,
      ...(total > 0 ? { progress_percent: Math.round((completed / total) * 100) } : {}),
      completed,
      total,
      counts
    },
    projection_health: input.projectionHealth,
    cleanup_health: input.cleanupHealth,
    current: tasks
      .filter(({ outcome }) => ['running', 'input_required', 'blocked'].includes(outcome))
      .slice(0, MAESTRO_RUN_PROGRESS_LIST_LIMIT)
      .map((task) => ({
        reference: task.task.id,
        title: task.title,
        worker_label: task.workerLabel,
        state: task.outcome,
        activity_summary: currentActivity(task, input.messages)
      })),
    recently_completed: tasks
      .filter(({ outcome }) => ['succeeded', 'failed', 'cancelled'].includes(outcome))
      .sort(
        (left, right) =>
          (right.task.completed_at ?? right.task.created_at).localeCompare(
            left.task.completed_at ?? left.task.created_at
          ) || right.task.id.localeCompare(left.task.id)
      )
      .slice(0, MAESTRO_RUN_PROGRESS_LIST_LIMIT)
      .map((task) => ({
        reference: task.task.id,
        title: task.title,
        worker_label: task.workerLabel,
        outcome_summary: completedOutcome(task)
      })),
    next: tasks
      .filter(({ outcome }) => outcome === 'pending')
      .slice(0, MAESTRO_RUN_PROGRESS_LIST_LIMIT)
      .map((task) => ({
        reference: task.task.id,
        title: task.title,
        worker_label: task.workerLabel,
        next_step: boundedText(task.task.spec, task.title)
      })),
    blocked: tasks
      .filter(({ outcome }) => outcome === 'blocked')
      .slice(0, MAESTRO_RUN_PROGRESS_LIST_LIMIT)
      .map((task) => ({
        reference: task.task.id,
        title: task.title,
        worker_label: task.workerLabel,
        blocker_summary: blockerSummary(task, input.messages)
      })),
    nested_activity: [...input.nestedActivity]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, MAESTRO_RUN_PROGRESS_LIST_LIMIT)
      .map((activity) => ({
        parent_reference:
          input.dispatches.find((dispatch) => dispatch.id === activity.parent_dispatch_id)
            ?.task_id ?? activity.parent_dispatch_id,
        child_id: activity.provider_child_id,
        label: boundedText(activity.description, activity.type),
        ...(activity.model ? { model: boundedText(activity.model, activity.provider) } : {}),
        state: activity.state,
        activity_summary: boundedText(activity.description, activity.type)
      })),
    technical: {
      execution_host_id: input.executionHostId,
      workspace_key: input.workspaceKey,
      run_id: input.run.id,
      revision: input.revision
    }
  })
}

function taskOutcome(
  task: TaskRow,
  dispatch: DispatchContextRow | undefined,
  lease: MaestroTerminalLease | undefined
): TaskOutcome {
  if (task.status === 'completed') {
    return 'succeeded'
  }
  if (task.status === 'failed') {
    return dispatch?.termination_reason === 'operator_close' ? 'cancelled' : 'failed'
  }
  if (task.status === 'blocked') {
    return 'blocked'
  }
  if (lease?.lifecycleState === 'input_required') {
    return 'input_required'
  }
  if (task.status === 'dispatched') {
    return 'running'
  }
  return 'pending'
}

function disambiguateTaskTitles(tasks: readonly TaskRow[]): string[] {
  const candidates = tasks.map(taskTitleCandidate)
  const totals = new Map<string, number>()
  for (const candidate of candidates) {
    totals.set(candidate, (totals.get(candidate) ?? 0) + 1)
  }
  const ordinals = new Map<string, number>()
  return candidates.map((candidate) => {
    const ordinal = (ordinals.get(candidate) ?? 0) + 1
    ordinals.set(candidate, ordinal)
    if (candidate !== 'Untitled task' && totals.get(candidate) === 1) {
      return candidate
    }
    return boundedText(`${candidate} ${ordinal}`, 'Untitled task')
  })
}

function taskTitleCandidate(task: TaskRow): string {
  if (task.task_title?.trim()) {
    return boundedText(task.task_title, 'Untitled task')
  }
  if (task.display_name?.trim()) {
    return boundedText(task.display_name, 'Untitled task')
  }
  return buildOrchestrationTaskDisplayMetadata({ spec: task.spec }).taskTitle || 'Untitled task'
}

function currentActivity(task: TaskProjection, messages: readonly MessageRow[]): string {
  const message = latestAcceptedDispatchMessage(task.dispatch, messages, ['heartbeat', 'status'])
  if (message) {
    const payload = parsePayload(message.payload)
    const phase = ['progressSubject', 'progress_subject', 'phase']
      .map((key) => payload?.[key])
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    const subject = message.subject.trim()
    if (subject && subject.toLowerCase() !== 'alive') {
      return boundedText(subject, task.title)
    }
    if (phase) {
      return boundedText(phase, task.title)
    }
  }
  return boundedText(task.task.spec, task.title)
}

function blockerSummary(task: TaskProjection, messages: readonly MessageRow[]): string {
  const message = latestAcceptedDispatchMessage(task.dispatch, messages, [
    'escalation',
    'decision_gate'
  ])
  return boundedText(
    message?.subject ?? acceptedTaskResult(task.task.result) ?? task.task.spec,
    task.title
  )
}

function completedOutcome(task: TaskProjection): string {
  const fallback =
    task.outcome === 'succeeded'
      ? 'Completed'
      : task.outcome === 'cancelled'
        ? 'Cancelled'
        : 'Failed'
  return boundedText(acceptedTaskResult(task.task.result) ?? fallback, fallback)
}

function acceptedTaskResult(result: string | null): string | undefined {
  if (!result) {
    return undefined
  }
  const payload = parsePayload(result)
  if (payload?.provenance !== 'worker_report') {
    return result
  }
  for (const field of [payload.body, payload.subject]) {
    if (typeof field === 'string' && field.trim()) {
      return field
    }
  }
  return undefined
}

function latestAcceptedDispatchMessage(
  dispatch: DispatchContextRow | undefined,
  messages: readonly MessageRow[],
  types: readonly MessageRow['type'][]
): MessageRow | undefined {
  if (!dispatch) {
    return undefined
  }
  return messages
    .filter((message) => {
      if (!types.includes(message.type) || message.run_id !== dispatch.run_id) {
        return false
      }
      const payload = parsePayload(message.payload)
      return payload?.dispatchId === dispatch.id && !payload._orcaLifecycleRejection
    })
    .sort((left, right) => right.sequence - left.sequence)[0]
}

function parsePayload(payload: string | null): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(payload ?? '')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function compareCreatedRows(left: CreatedRow, right: CreatedRow): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
}

function boundedText(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const selected = normalized || fallback
  return selected.length <= MAESTRO_RUN_PROGRESS_TEXT_MAX_LENGTH
    ? selected
    : selected.slice(0, MAESTRO_RUN_PROGRESS_TEXT_MAX_LENGTH).trimEnd()
}
