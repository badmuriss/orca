import type { MaestroBrowserSurfaceReceipt } from '../../../shared/maestro-browser-surface'
import type { MaestroRunResource } from '../../../shared/maestro-run-resource'
import { MAESTRO_RUN_RESOURCE_LIMIT } from '../../../shared/maestro-run-resource'
import type { MaestroTerminalLease } from '../../../shared/maestro-terminal-lease'
import type { OrchestrationNestedAgentActivity } from '../../../shared/orchestration-nested-agent-activity'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'
import { workspaceSurfaceKey } from '../../../shared/maestro-workspace-canvas'
import type { DispatchContextRow, RunRow, TaskRow, WorkerDispatchRow } from './types'
import type { TaskProgressOutcome } from './db/tasks/task-progress-outcome'
import {
  attemptResourceDetail,
  attemptResourceState,
  browserCleanupResource,
  browserResourceDetail,
  browserResourceState,
  capitalizeLabel,
  dispatchResourceDetail,
  dispatchResourceState,
  nestedResourceState,
  taskResourceDetail,
  taskResourceState,
  terminalCleanupResource,
  terminalResourceDetail,
  terminalResourceLiveness,
  terminalResourceState
} from './maestro-run-resource-state'

type ProjectedTask = { task: TaskRow; title: string; outcome: TaskProgressOutcome }
type ProviderExecution = { dispatchId: string; session: ExactWorkerProviderSession }

export type MaestroRunResourceProjectionInput = {
  run: RunRow
  tasks: readonly ProjectedTask[]
  dispatches: readonly DispatchContextRow[]
  workerDispatches: readonly WorkerDispatchRow[]
  terminalLeases: readonly MaestroTerminalLease[]
  browserSurfaces: readonly MaestroBrowserSurfaceReceipt[]
  providerExecutions: readonly ProviderExecution[]
  nestedActivity: readonly OrchestrationNestedAgentActivity[]
  executionHostId: string
  workspaceKey: string
  recoveredAuthority: boolean
  browserSurfaceKeys: ReadonlyMap<string, string>
}

export function projectMaestroRunResources(
  input: MaestroRunResourceProjectionInput
): MaestroRunResource[] {
  const taskById = new Map(input.tasks.map((entry) => [entry.task.id, entry] as const))
  const dispatchById = new Map(input.dispatches.map((entry) => [entry.id, entry] as const))
  const workerByDispatch = new Map(
    input.workerDispatches.map((worker) => [worker.dispatch_id, worker] as const)
  )
  const leaseByDispatch = new Map(
    input.terminalLeases.flatMap((lease) =>
      lease.role === 'worker' && lease.ownerPrincipal.startsWith('dispatch:')
        ? [[lease.ownerPrincipal.slice('dispatch:'.length), lease] as const]
        : []
    )
  )
  const resources: MaestroRunResource[] = [coordinatorResource(input)]

  for (const entry of input.tasks) {
    resources.push({
      kind: 'task',
      reference: entry.task.id,
      activation_reference: entry.task.id,
      title: entry.title,
      detail: taskResourceDetail(entry.outcome),
      state: taskResourceState(entry.outcome)
    })
  }

  const dispatchOrdinals = new Map<string, number>()
  for (const dispatch of input.dispatches) {
    const task = taskById.get(dispatch.task_id)
    const ordinal = (dispatchOrdinals.get(dispatch.task_id) ?? 0) + 1
    dispatchOrdinals.set(dispatch.task_id, ordinal)
    const worker = input.workerDispatches.find((candidate) => candidate.dispatch_id === dispatch.id)
    const attemptReference = leaseByDispatch.get(dispatch.id)?.attemptId ?? dispatch.id
    const taskTitle = task?.title ?? 'Untitled task'
    resources.push(
      {
        kind: 'dispatch',
        reference: dispatch.id,
        parent_reference: dispatch.task_id,
        activation_reference: dispatch.task_id,
        title: `Dispatch ${ordinal} · ${taskTitle}`,
        detail: dispatchResourceDetail(dispatch.status),
        state: dispatchResourceState(dispatch.status)
      },
      {
        kind: 'attempt',
        reference: attemptReference,
        parent_reference: dispatch.id,
        activation_reference: dispatch.task_id,
        title: `Attempt ${ordinal} · ${taskTitle}`,
        detail: worker ? attemptResourceDetail(worker.state) : 'Waiting for provider startup.',
        state: worker ? attemptResourceState(worker.state) : dispatchResourceState(dispatch.status)
      }
    )
  }

  for (const execution of input.providerExecutions) {
    const dispatch = dispatchById.get(execution.dispatchId)
    const worker = workerByDispatch.get(execution.dispatchId)
    const task = dispatch ? taskById.get(dispatch.task_id) : undefined
    resources.push({
      kind: 'provider',
      reference: execution.session.providerSession.id,
      parent_reference: execution.dispatchId,
      ...(dispatch ? { activation_reference: dispatch.task_id } : {}),
      title: `${capitalizeLabel(execution.session.agent)} provider execution`,
      detail: task ? `Executing ${task.title}.` : 'Provider execution observed.',
      state: worker ? attemptResourceState(worker.state) : 'unverifiable'
    })
  }

  for (const activity of input.nestedActivity) {
    const dispatch = dispatchById.get(activity.parent_dispatch_id)
    resources.push({
      kind: 'provider',
      reference: activity.provider_child_id,
      parent_reference: activity.parent_provider_session_id,
      ...(dispatch ? { activation_reference: dispatch.task_id } : {}),
      title: activity.description,
      detail: `${capitalizeLabel(activity.provider)} child execution.`,
      state: nestedResourceState(activity.state),
      ...(activity.model ? { model: activity.model } : {})
    })
  }

  for (const lease of input.terminalLeases) {
    const task = lease.taskId ? taskById.get(lease.taskId) : undefined
    const surfaceKey = terminalSurfaceKey(input, lease)
    resources.push({
      kind: 'terminal',
      reference: lease.id,
      ...(lease.attemptId ? { parent_reference: lease.attemptId } : {}),
      ...(lease.taskId ? { activation_reference: lease.taskId } : {}),
      title:
        lease.role === 'coordinator'
          ? 'Coordinator terminal'
          : `${task?.title ?? 'Worker'} terminal`,
      detail: terminalResourceDetail(lease),
      state: terminalResourceState(lease),
      ...(surfaceKey ? { surface_key: surfaceKey } : {}),
      ...(lease.terminalHandle ? { terminal_handle: lease.terminalHandle } : {}),
      liveness: terminalResourceLiveness(lease)
    })
    if (lease.role === 'worker') {
      resources.push(terminalCleanupResource(lease, task?.title ?? 'Worker'))
    }
  }

  for (const browser of input.browserSurfaces) {
    const task = taskById.get(browser.task_id)
    const surfaceKey = browser.browser_page_id
      ? input.browserSurfaceKeys.get(browser.browser_page_id)
      : undefined
    resources.push({
      kind: 'browser',
      reference: browser.surface_id,
      parent_reference: browser.attempt_id,
      activation_reference: browser.task_id,
      title: browser.title,
      detail: browserResourceDetail(browser),
      state: browserResourceState(browser.state),
      ...(surfaceKey ? { surface_key: surfaceKey } : {})
    })
    if (browser.ownership === 'harness') {
      resources.push(browserCleanupResource(browser, task?.title ?? browser.title))
    }
  }

  return resources.slice(0, MAESTRO_RUN_RESOURCE_LIMIT)
}

function coordinatorResource(input: MaestroRunResourceProjectionInput): MaestroRunResource {
  const currentLease = input.terminalLeases
    .toReversed()
    .find(
      (lease) =>
        lease.role === 'coordinator' &&
        lease.coordinatorGeneration === input.run.consumer_generation &&
        (!input.run.coordinator_handle || lease.terminalHandle === input.run.coordinator_handle)
    )
  return {
    kind: 'coordinator',
    reference: `coordinator:${input.run.id}:g${input.run.consumer_generation}`,
    title: 'Coordinator',
    detail:
      input.recoveredAuthority && currentLease
        ? 'Recovered from the current authenticated Run generation.'
        : currentLease
          ? 'Current Run authority is attached.'
          : input.run.coordinator_handle
            ? 'Coordinator handle has no matching live terminal lease.'
            : 'Current Run authority is unverifiable.',
    state:
      input.recoveredAuthority && currentLease
        ? 'recovered'
        : currentLease
          ? terminalResourceState(currentLease)
          : 'unverifiable',
    ...(currentLease?.terminalHandle ? { terminal_handle: currentLease.terminalHandle } : {}),
    ...(currentLease ? { liveness: terminalResourceLiveness(currentLease) } : {})
  }
}

function terminalSurfaceKey(
  input: MaestroRunResourceProjectionInput,
  lease: MaestroTerminalLease
): string | undefined {
  return lease.tabId &&
    lease.executionHostId === input.executionHostId &&
    lease.workspaceKey === input.workspaceKey
    ? workspaceSurfaceKey({
        execution_host_id: input.executionHostId,
        workspace_key: input.workspaceKey,
        unified_tab_id: lease.tabId
      })
    : undefined
}
