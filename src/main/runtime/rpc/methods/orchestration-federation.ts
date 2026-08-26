import { z } from 'zod'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../core'
import { attachFederatedWorker } from './orchestration-federation-attach'
import { FederationAttachStartParams } from './orchestration-federation-start-schema'
import { requiredString } from '../schemas'
import { releaseFederatedAttachment } from '../../orchestration/federation-lifecycle-settlement'

const FederationReleaseParams = z.object({ dispatchId: requiredString('Missing Dispatch ID') })

export const ORCHESTRATION_FEDERATION_ATTACH_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.federationAttachStart',
    params: FederationAttachStartParams,
    handler: async (params, { runtime, orchestrationMutation }) => {
      return attachFederatedWorker({ params, runtime, orchestrationMutation })
    }
  }),
  defineMethod({
    name: 'orchestration.federationRelease',
    params: FederationReleaseParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint, orchestrationMutation }) => {
      if (!orchestrationMutation) {
        throw new OrchestrationError(
          'invalid_argument',
          'Federated worker release requires a durable retry request.'
        )
      }
      const attachment = runtime.getOrchestrationDb().getRemoteDispatchAttachment(params.dispatchId)
      if (
        !attachment ||
        attachment.home_peer_fingerprint !== authenticatedCallerFingerprint ||
        attachment.home_peer_fingerprint !== orchestrationMutation.callerFingerprint
      ) {
        throw new OrchestrationError(
          'dispatch_not_found',
          `Remote Dispatch ${params.dispatchId} was not found for this Run home.`
        )
      }
      const release = await releaseFederatedAttachment(runtime, params.dispatchId)
      const runtimeEpoch = runtime.getRuntimeId()
      return {
        dispatchId: params.dispatchId,
        runtimeEpoch,
        servingRuntimeEpoch: runtimeEpoch,
        ...release,
        ...(attachment.terminal_handle && attachment.pane_key && attachment.process_incarnation
          ? {
              attachment: {
                terminalHandle: attachment.terminal_handle,
                paneKey: attachment.pane_key,
                processIncarnation: attachment.process_incarnation
              }
            }
          : {})
      }
    }
  })
]
