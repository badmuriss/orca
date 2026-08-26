import { z } from 'zod'
import {
  AgentGraphViewSchema,
  MaestroDocumentReadScopeSchema,
  MaestroWorkspaceAnchorSchema
} from '../../../../shared/maestro-contract'
import { canConsumeMaestroIntent } from '../../../../shared/maestro-actor'
import {
  applyMaestroProjection,
  getMaestroProjection
} from '../../orchestration/db/maestro/maestro-projection-store'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../core'
import { resolveMaestroDocumentReadScope, resolveMaestroPrincipal } from '../maestro-principal'

const getParams = z.object({ scope: MaestroDocumentReadScopeSchema }).strict()
const applyParams = z
  .object({
    workspace: MaestroWorkspaceAnchorSchema,
    view: AgentGraphViewSchema
  })
  .strict()

export const MAESTRO_PROJECTION_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'maestro.projection.get',
    params: getParams,
    handler: async ({ scope }, context) => {
      const resolved = await resolveMaestroDocumentReadScope(context, scope)
      return getMaestroProjection.call(context.runtime.getOrchestrationDb(), resolved)
    }
  }),
  defineMethod({
    name: 'maestro.projection.apply',
    params: applyParams,
    handler: async ({ workspace, view }, context) => {
      const principal = await resolveMaestroPrincipal(context, workspace)
      if (!canConsumeMaestroIntent(principal, workspace, view.coordinator.generation)) {
        throw new OrchestrationError(
          'unauthorized',
          'Only the current coordinator can publish an AgentGraphView.'
        )
      }
      try {
        return applyMaestroProjection.call(context.runtime.getOrchestrationDb(), workspace, view)
      } catch (error) {
        throw new OrchestrationError(
          'maestro_projection_rejected',
          error instanceof Error ? error.message : 'AgentGraphView projection was rejected.'
        )
      }
    }
  })
]
