import { z } from 'zod'
import { WorkspaceSurfaceIdSchema } from '../../../../shared/maestro-workspace-canvas'
import { resolveMaestroLayoutPrincipal } from '../maestro-principal'
import { defineMethod, type RpcMethod } from '../core'
import { getMaestroWorkspaceCanvasAuthority } from '../../services/maestro-workspace-canvas/maestro-workspace-canvas-authority'

const scopeSchema = z
  .object({
    execution_host_id: z.string().min(1).max(4096),
    workspace_key: z.string().min(1).max(4096)
  })
  .strict()
const mutationBase = {
  scope: scopeSchema,
  actor_id: z.string().min(1).max(256),
  expected_authority_revision: z.number().int().min(0),
  idempotency_key: z.string().min(1).max(512)
}
const documentMutationBase = {
  ...mutationBase,
  expected_canvas_revision: z.number().int().min(0)
}
const surfaceKey = z.string().min(1).max(12_288)
const mutationSchema = z.union([
  z
    .object({
      ...mutationBase,
      action: z.literal('create'),
      surface_type: z.enum(['terminal', 'browser']),
      title: z.string().min(1).max(512).optional()
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('set-viewport'),
      viewport: z
        .object({
          center: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
          zoom: z.number().finite().min(0.1).max(4)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('create'),
      surface_type: z.literal('content'),
      title: z.string().min(1).max(512).optional(),
      annotation: z
        .object({
          text: z.string().min(1).max(65_536),
          tone: z.enum(['decision', 'warning', 'blocked', 'observation'])
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('focus'),
      surface_id: WorkspaceSurfaceIdSchema
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('close'),
      surface_id: WorkspaceSurfaceIdSchema
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      action: z.literal('rename'),
      surface_id: WorkspaceSurfaceIdSchema,
      title: z.string().min(1).max(512)
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('set-placement'),
      surface_id: WorkspaceSurfaceIdSchema,
      placement: z
        .object({
          position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
          size: z
            .object({
              width: z.number().finite().min(160).max(4096),
              height: z.number().finite().min(96).max(4096)
            })
            .strict(),
          collapsed: z.boolean(),
          z_order: z.number().int().min(0).max(1_000_000)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('create-manual-link'),
      source_surface_key: surfaceKey,
      target_surface_key: surfaceKey,
      link_type: z.string().min(1).max(128),
      label: z.string().max(512).nullable()
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('delete-manual-link'),
      link_id: z.string().min(1).max(512)
    })
    .strict(),
  z
    .object({
      ...documentMutationBase,
      action: z.literal('decide-suggestion'),
      fingerprint: surfaceKey,
      decision: z.enum(['accepted', 'hidden']),
      link_type: z.string().min(1).max(128).optional(),
      label: z.string().max(512).nullable().optional()
    })
    .strict()
])

export const MAESTRO_WORKSPACE_CANVAS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'maestro.workspaceCanvas.get',
    params: scopeSchema,
    handler: async (scope, context) => {
      const principal = await resolveMaestroLayoutPrincipal(context, scope)
      const result = await getMaestroWorkspaceCanvasAuthority(context.runtime).query(
        principal.workspace,
        principal.actor_id
      )
      return result
    }
  }),
  defineMethod({
    name: 'maestro.workspaceCanvas.readContent',
    params: z.object({ scope: scopeSchema, surface_id: WorkspaceSurfaceIdSchema }).strict(),
    handler: async ({ scope, surface_id }, context) => {
      const principal = await resolveMaestroLayoutPrincipal(context, scope)
      if (!principal.authenticated) {
        throw new Error('workspace_canvas_actor_unauthorized')
      }
      return getMaestroWorkspaceCanvasAuthority(context.runtime).readContent(
        principal.workspace,
        principal.actor_id,
        surface_id
      )
    }
  }),
  defineMethod({
    name: 'maestro.workspaceCanvas.mutate',
    params: mutationSchema,
    handler: async (request, context) => {
      const principal = await resolveMaestroLayoutPrincipal(context, request.scope)
      if (principal.actor_id !== request.actor_id || !principal.authenticated) {
        throw new Error('workspace_canvas_actor_unauthorized')
      }
      return getMaestroWorkspaceCanvasAuthority(context.runtime).mutate({
        ...request,
        scope: principal.workspace
      })
    }
  })
]
