import { z } from 'zod'
import {
  ORCHESTRATION_WORKER_READ_SOURCES,
  type OrchestrationWorkerReadResult
} from '../../../../shared/orchestration-worker-output'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, requiredString } from '../schemas'
import {
  inspectWorkerTerminal,
  resolvePinnedFederatedServer
} from './orchestration-worker-observation'
import { readArchivedWorkerOutput } from './orchestration-worker-archive-read'
import { readLegacyFederatedTerminal } from './orchestration-worker-legacy-federated-read'
import { readExactWorkerOutput } from './orchestration-worker-output'

const WorkerReadParams = z.object({
  dispatch: requiredString('Missing --dispatch'),
  cursor: z.union([z.number().int().nonnegative(), z.string().min(1).max(2_048)]).optional(),
  limit: OptionalFiniteNumber,
  source: z.enum(ORCHESTRATION_WORKER_READ_SOURCES).optional()
})

/** Reads exactly the requested Dispatch's output, refusing any identity change mid-read. */
export const WORKER_READ_METHOD: RpcMethod = defineMethod({
  name: 'orchestration.workerRead',
  params: WorkerReadParams,
  handler: async (params, { runtime }) => {
    const db = runtime.getOrchestrationDb()
    const federated = db.getFederatedDispatch(params.dispatch)
    if (federated) {
      const server = resolvePinnedFederatedServer(runtime, federated)
      try {
        const remote = (await runtime.callOrchestrationWorkerServer(
          server.environmentId,
          'orchestration.federationReadOutput',
          {
            dispatchId: params.dispatch,
            cursor: params.cursor,
            limit: params.limit,
            source: params.source
          },
          15_000
        )) as { runtimeEpoch: string; output: OrchestrationWorkerReadResult }
        return {
          ...remote.output,
          server: { environmentId: server.environmentId, name: server.name },
          remoteRuntimeEpoch: remote.runtimeEpoch
        }
      } catch (error) {
        if (!(error instanceof OrchestrationError) || error.code !== 'method_not_found') {
          throw error
        }
        return readLegacyFederatedTerminal({
          runtime,
          server,
          federated,
          workerState: db.getWorkerDispatch(params.dispatch)?.state ?? 'unknown',
          dispatchId: params.dispatch,
          source: params.source,
          cursor: params.cursor,
          limit: params.limit
        })
      }
    }
    const dispatch = db.getDispatchContextById(params.dispatch)
    const worker = db.getWorkerDispatch(params.dispatch)
    const terminalHandle = worker?.agent_terminal_handle ?? dispatch?.assignee_handle
    if (!dispatch) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Dispatch ${params.dispatch} was not found.`
      )
    }
    if (!terminalHandle) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Worker Dispatch ${params.dispatch} has no agent terminal.`
      )
    }
    const resource = db.getWorkerTerminalResourceByOwner(params.dispatch)
    if (resource && ['releasing', 'unknown', 'released'].includes(resource.release_state)) {
      return readArchivedWorkerOutput({
        db,
        dispatchId: params.dispatch,
        workerState: worker?.state ?? 'unsupervised',
        resource,
        source: params.source,
        cursor: params.cursor,
        limit: params.limit
      })
    }
    const observation = await inspectWorkerTerminal(runtime, db, params.dispatch)
    if (!observation.exact) {
      throw new OrchestrationError(
        'worker_identity_changed',
        `Worker Dispatch ${params.dispatch} no longer resolves to its exact process.`
      )
    }
    const output = await readExactWorkerOutput({
      runtime,
      dispatchId: params.dispatch,
      terminalHandle,
      workerState: worker?.state ?? 'unsupervised',
      terminalStatus:
        observation.status === 'exited'
          ? 'exited'
          : observation.status === 'unverifiable'
            ? 'unknown'
            : 'running',
      terminalLiveness:
        observation.status === 'unverifiable'
          ? 'unverifiable'
          : observation.status === 'exited'
            ? 'exited'
            : 'live',
      attachedAt: worker?.created_at ?? dispatch.dispatched_at ?? dispatch.created_at,
      source: params.source,
      cursor: params.cursor,
      limit: params.limit
    })
    const afterRead = await inspectWorkerTerminal(runtime, db, params.dispatch)
    if (!afterRead.exact) {
      throw new OrchestrationError(
        'worker_identity_changed',
        `Worker Dispatch ${params.dispatch} changed process while output was read.`
      )
    }
    return output
  }
})
