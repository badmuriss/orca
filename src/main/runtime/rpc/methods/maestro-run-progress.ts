import { z } from 'zod'
import { MaestroDocumentReadScopeSchema } from '../../../../shared/maestro-contract'
import type { MaestroTerminalLease } from '../../../../shared/maestro-terminal-lease'
import type {
  MaestroRunProgress,
  MaestroRunProgressV2
} from '../../../../shared/maestro-run-progress'
import { MAESTRO_RUN_PROGRESS_V2_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { projectMaestroRunProgress } from '../../orchestration/maestro-run-progress-projection'
import {
  getMaestroProjection,
  listMaestroProjectionIndexForScope
} from '../../orchestration/db/maestro/maestro-projection-store'
import {
  deserializeMaestroTerminalLease,
  type MaestroTerminalLeaseRow
} from '../../orchestration/db/maestro-terminal-lease/maestro-terminal-lease-row'
import type { DispatchContextRow } from '../../orchestration/types'
import { projectNestedAgentActivities } from '../../orchestration/worker-provider-session'
import { exposeUtcTimestamp } from '../../orchestration/db/utc-timestamp'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'
import { resolveMaestroDocumentReadScope } from '../maestro-principal'

const params = z
  .object({ scope: MaestroDocumentReadScopeSchema, runId: z.string().min(1).optional() })
  .strict()

type MaestroProjectionReadLabels = {
  documentRevision: number | null
  selectedRunId: string | null
  projectionRevisions: { runId: string; revision: number; updatedAt: string }[]
  projectionHealth: { state: 'healthy' | 'empty'; revision: number | null }
}

export type MaestroRunProgressResponse =
  | ({ schemaVersion: 2; progress: MaestroRunProgressV2 } & MaestroProjectionReadLabels)
  | { schemaVersion: 1; progress: MaestroRunProgress }
  | ({ schemaVersion: null; progress: null } & Partial<MaestroProjectionReadLabels>)

export async function readMaestroRunProgress(
  context: RpcContext,
  requestedScope: z.infer<typeof MaestroDocumentReadScopeSchema>,
  requestedRunId?: string
): Promise<MaestroRunProgressResponse> {
  const scope = await resolveMaestroDocumentReadScope(context, requestedScope)
  const database = context.runtime.getOrchestrationDb()
  const supportsV2 =
    context.clientCapabilities === undefined ||
    context.clientCapabilities.includes(MAESTRO_RUN_PROGRESS_V2_RUNTIME_CAPABILITY)
  const projection = getMaestroProjection.call(database, scope, requestedRunId)
  if (!projection) {
    if (!supportsV2) {
      return { schemaVersion: null, progress: null }
    }
    return {
      schemaVersion: null,
      progress: null,
      ...projectionReadLabels(database, scope, null)
    }
  }
  if (!supportsV2) {
    return { schemaVersion: 1, progress: projection.runProgress }
  }

  const run = database.getRun(projection.runId)
  if (!run) {
    return { schemaVersion: null, progress: null }
  }
  const tasks = database.listTasks({ runId: run.id })
  const dispatches = database.db
    .prepare('SELECT * FROM dispatch_contexts WHERE run_id = ? ORDER BY created_at, id')
    .all(run.id) as DispatchContextRow[]
  const terminalLeases = (
    database.db
      .prepare(
        `SELECT * FROM maestro_terminal_leases
         WHERE run_id = ?
         ORDER BY created_at, id`
      )
      .all(run.id) as MaestroTerminalLeaseRow[]
  ).map(deserializeMaestroTerminalLease)
  const nestedActivity = dispatches.flatMap((dispatch) => {
    if (!dispatch.assignee_handle) {
      return []
    }
    const observedAfter = Date.parse(
      exposeUtcTimestamp(dispatch.dispatched_at ?? dispatch.created_at) ?? ''
    )
    const session = context.runtime.getExactWorkerProviderSession(
      dispatch.assignee_handle,
      Number.isFinite(observedAfter) ? observedAfter : 0
    )
    return session ? projectNestedAgentActivities({ dispatchId: dispatch.id, session }) : []
  })

  return {
    schemaVersion: 2,
    ...projectionReadLabels(database, scope, projection),
    progress: projectMaestroRunProgress({
      run,
      tasks,
      dispatches,
      messages: database.getRunMailboxHistory(run.id, 512),
      terminalLeases,
      nestedActivity,
      executionHostId: scope.execution_host_id,
      workspaceKey: scope.workspace_key,
      revision: projection.revision,
      projectionHealth: { state: 'healthy', revision: projection.revision },
      cleanupHealth: projectCleanupHealth(terminalLeases)
    })
  }
}

function projectionReadLabels(
  database: ReturnType<RpcContext['runtime']['getOrchestrationDb']>,
  scope: z.infer<typeof MaestroDocumentReadScopeSchema>,
  selected: ReturnType<typeof getMaestroProjection>
): MaestroProjectionReadLabels {
  const document = database.getMaestroDocument(scope)
  return {
    documentRevision: document.state === 'empty' ? null : document.revision,
    selectedRunId: selected?.runId ?? null,
    projectionRevisions: listMaestroProjectionIndexForScope.call(database, scope).map((entry) => ({
      runId: entry.runId,
      revision: entry.revision,
      updatedAt: entry.updatedAt
    })),
    projectionHealth: {
      state: selected ? 'healthy' : 'empty',
      revision: selected?.revision ?? null
    }
  }
}

export function projectCleanupHealth(
  terminalLeases: readonly MaestroTerminalLease[]
): MaestroRunProgressV2['cleanup_health'] {
  const workerLeases = terminalLeases.filter((lease) => lease.role === 'worker')
  const unverifiable = workerLeases.filter(
    (lease) =>
      lease.lifecycleState === 'outcome_unknown' || lease.cleanupReceipt?.verdict === 'unverifiable'
  )
  if (unverifiable.length > 0) {
    return {
      state: 'unverifiable',
      count: unverifiable.length,
      warning: `Cleanup is unverifiable for ${unverifiable.length} worker resource${unverifiable.length === 1 ? '' : 's'}.`
    }
  }
  const pending = workerLeases.filter((lease) =>
    ['settled', 'retained', 'release_pending'].includes(lease.lifecycleState)
  )
  if (pending.length > 0) {
    return { state: 'pending', count: pending.length }
  }
  return { state: 'clean', count: 0 }
}

export const MAESTRO_RUN_PROGRESS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'maestro.runProgress.get',
    params,
    handler: ({ scope, runId }, context) => readMaestroRunProgress(context, scope, runId)
  })
]
