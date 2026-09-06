import { z } from 'zod'
import {
  RemoteFederatedWorkerReleaseReceiptSchema,
  RemoteFederatedWorkerReleaseStatusSchema,
  matchesFederatedReleaseTarget,
  unverifiableFederatedReleaseReceipt,
  type FederatedWorkerReleaseReceipt
} from '../../orchestration-federated-release-receipt'
import { defineMethod, type RpcMethod } from '../../../core'
import { requiredString } from '../../../schemas'
import { archiveSummary, completeWorkerTerminalRelease } from './worker-release-completion'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { resolvePinnedFederatedServer } from './worker-observation'
import { ORCHESTRATION_FEDERATION_WORKER_RELEASE_RUNTIME_CAPABILITY } from '../../../../../../shared/protocol-version'

const WorkerDispatchParams = z.object({ dispatch: requiredString('Missing --dispatch') })

import { ORCHESTRATION_WORKER_LIST_METHOD } from './worker-list-method'
import { WorkerRetainParams } from './worker-release-schemas'
import { sweepSettledWorkerResumeFences } from '../../settled-worker-resume-fence-sweep'

export const ORCHESTRATION_WORKER_RELEASE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.workerRelease',
    params: WorkerDispatchParams,
    handler: async (params, { runtime, orchestrationMutation }) => {
      const db = runtime.getOrchestrationDb()
      const federated = db.getFederatedDispatch(params.dispatch)
      if (federated) {
        if (!orchestrationMutation) {
          throw new OrchestrationError(
            'invalid_argument',
            'Federated worker release requires a durable retry request.'
          )
        }
        const dispatch = db.getDispatchContextById(params.dispatch)
        const worker = db.getWorkerDispatch(params.dispatch)
        return releaseFederatedWorker({
          runtime,
          dispatchId: params.dispatch,
          federated,
          dispatch,
          worker,
          mutationId: orchestrationMutation.requestId
        })
      }
      const requested = db.requestWorkerTerminalRelease(params.dispatch)
      if (requested.disposition === 'already_released') {
        return {
          dispatchId: params.dispatch,
          state: 'already_released',
          processAction: 'none',
          archive: archiveSummary(requested.resource)
        }
      }
      if (requested.disposition === 'retained') {
        return {
          dispatchId: params.dispatch,
          state: 'retained',
          reason: requested.reason,
          processAction: 'none',
          archive: archiveSummary(requested.resource)
        }
      }
      return completeWorkerTerminalRelease({
        runtime,
        db,
        dispatchId: params.dispatch,
        resource: requested.resource
      })
    }
  }),
  defineMethod({
    name: 'orchestration.workerRetain',
    params: WorkerRetainParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const retained = db.retainWorkerTerminalResource(params.dispatch)
      if (retained.disposition === 'already_released') {
        return {
          dispatchId: params.dispatch,
          state: 'already_released' as const,
          processAction: 'none' as const,
          archive: archiveSummary(retained.resource)
        }
      }
      if (retained.disposition === 'no_owned_resource') {
        return {
          dispatchId: params.dispatch,
          state: 'retained' as const,
          reason: 'no_owned_resource' as const,
          processAction: 'none' as const,
          archive: null
        }
      }
      if (retained.disposition === 'release_committed') {
        const unknown = retained.resource.release_state === 'unknown'
        return {
          dispatchId: params.dispatch,
          state: unknown ? ('release_unknown' as const) : ('release_pending' as const),
          processAction: 'none' as const,
          archive: archiveSummary(retained.resource),
          ...(retained.resource.release_error
            ? { lastError: retained.resource.release_error }
            : {}),
          recovery:
            'Terminal release was already committed and could not be changed to retained; inspect worker-show before taking further action.'
        }
      }
      return {
        dispatchId: params.dispatch,
        state: 'retained' as const,
        reason: 'user_requested' as const,
        processAction: 'none' as const,
        archive: archiveSummary(retained.resource)
      }
    }
  }),
  ORCHESTRATION_WORKER_LIST_METHOD,
  defineMethod({
    name: 'orchestration.workerTerminalUserInput',
    params: z.object({ paneKey: requiredString('Missing paneKey') }),
    // Real user keystrokes durably relinquish orchestration ownership on the owning runtime, so
    // restarts, SSH drops, remote viewing, and renderer remounts cannot erase the takeover.
    handler: (params, { runtime }) => {
      const changed = runtime.getOrchestrationDb().markWorkerTerminalUserOwned(params.paneKey)
      if (changed > 0) {
        // Only a real takeover retires the resource; ordinary panes report here too and must not
        // pay for a plan read on every keystroke window.
        sweepSettledWorkerResumeFences(runtime)
      }
      return { changed }
    }
  })
]

type ReleaseOrchestrationDb = ReturnType<
  Parameters<RpcMethod['handler']>[1]['runtime']['getOrchestrationDb']
>

async function releaseFederatedWorker(args: {
  runtime: Parameters<RpcMethod['handler']>[1]['runtime']
  dispatchId: string
  federated: NonNullable<ReturnType<ReleaseOrchestrationDb['getFederatedDispatch']>>
  dispatch: ReturnType<ReleaseOrchestrationDb['getDispatchContextById']>
  worker: ReturnType<ReleaseOrchestrationDb['getWorkerDispatch']>
  mutationId: string
}): Promise<FederatedWorkerReleaseReceipt> {
  const server = resolvePinnedFederatedServer(args.runtime, args.federated)
  try {
    const rawStatus = await args.runtime.callOrchestrationWorkerServer(
      server.environmentId,
      'status.get',
      undefined,
      15_000
    )
    const parsedStatus = RemoteFederatedWorkerReleaseStatusSchema.safeParse(rawStatus)
    if (!parsedStatus.success) {
      return unverifiableFederatedReleaseReceipt(
        args.dispatchId,
        'The execution host did not provide its current runtime identity.'
      )
    }
    const status = parsedStatus.data
    if (
      !status.capabilities?.includes(ORCHESTRATION_FEDERATION_WORKER_RELEASE_RUNTIME_CAPABILITY)
    ) {
      return {
        dispatchId: args.dispatchId,
        state: 'retained',
        reason: 'federation_unsupported',
        processAction: 'none',
        archive: null,
        recovery: `Connected server ${server.name} does not support authoritative worker release.`
      }
    }
    const rawRemote = await args.runtime.callOrchestrationWorkerServer(
      server.environmentId,
      'orchestration.federationRelease',
      { dispatchId: args.dispatchId },
      30_000,
      { orchestrationRequestId: args.mutationId }
    )
    const parsedRemote = RemoteFederatedWorkerReleaseReceiptSchema.safeParse(rawRemote)
    if (
      !parsedRemote.success ||
      !matchesFederatedReleaseTarget(parsedRemote.data, { ...args, runtimeEpoch: status.runtimeId })
    ) {
      return unverifiableFederatedReleaseReceipt(
        args.dispatchId,
        'The execution host returned an invalid or mismatched worker release receipt.'
      )
    }
    const remote = parsedRemote.data
    return {
      dispatchId: args.dispatchId,
      state: remote.state,
      ...(remote.reason ? { reason: remote.reason } : {}),
      processAction: remote.processAction,
      archive: null,
      ...(remote.lastError ? { lastError: remote.lastError } : {}),
      ...(remote.recovery ? { recovery: remote.recovery } : {})
    }
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'peer_changed') {
      throw error
    }
    return unverifiableFederatedReleaseReceipt(
      args.dispatchId,
      error instanceof Error ? error.message : String(error)
    )
  }
}
