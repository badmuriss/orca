import {
  WORKSPACE_SURFACE_SNAPSHOT_PROTOCOL,
  WorkspaceSurfaceSnapshotSchema
} from '../../../../shared/maestro-workspace-canvas'
import type {
  RuntimeMaestroWorkspaceCanvasMutation,
  RuntimeMaestroWorkspaceCanvasMutationResult,
  RuntimeMaestroWorkspaceCanvasQueryResult,
  RuntimeMaestroWorkspaceCanvasScope,
  RuntimeMaestroWorkspaceContentReadResult
} from '../../../../shared/runtime-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  migrateMaestroWorkspaceCanvasStore,
  readWorkspaceCanvasDocument,
  readWorkspaceCanvasMutationReceipt,
  reconcileStoredWorkspaceCanvas,
  writeWorkspaceCanvasMutationReceipt
} from '../../orchestration/db/maestro-workspace-canvas/maestro-workspace-canvas-store'
import {
  markWorkspaceSnapshotUnavailable,
  projectWorkspaceSurfaces,
  workspaceCanvasSelector
} from './maestro-workspace-surface-projection'
import { createMaestroWorkspaceSurface } from './maestro-workspace-surface-create'
import { mutateMaestroWorkspaceDocument } from './maestro-workspace-document-mutation'
import { readMaestroWorkspaceContent } from './maestro-workspace-content-read'
import { projectMaestroWorkspaceLinks } from './maestro-workspace-link-projection'
import { applyMaestroWorkspaceE2EQueryControl } from './maestro-workspace-e2e-query-control'
import { mutateExistingMaestroWorkspaceSurface } from './maestro-workspace-existing-surface-mutation'
import {
  createdSurfaceMutationResult,
  reconcileCreatedMaestroWorkspaceSurface,
  type MaestroWorkspaceProjectionWait
} from './maestro-workspace-surface-reconciliation'
import {
  maestroWorkspaceScopeKey,
  type MaestroWorkspaceSnapshotState
} from './maestro-workspace-snapshot-state'
import type { MaestroWorkspaceCanvasRuntime } from './maestro-workspace-canvas-runtime'

export type { MaestroWorkspaceCanvasRuntime } from './maestro-workspace-canvas-runtime'

export class MaestroWorkspaceCanvasAuthority {
  private readonly snapshots = new Map<string, MaestroWorkspaceSnapshotState>()

  constructor(
    private readonly runtime: MaestroWorkspaceCanvasRuntime,
    private readonly options: MaestroWorkspaceProjectionWait = {}
  ) {}

  async query(
    scope: RuntimeMaestroWorkspaceCanvasScope,
    actorId: string
  ): Promise<RuntimeMaestroWorkspaceCanvasQueryResult> {
    const key = maestroWorkspaceScopeKey(scope)
    const previous = this.snapshots.get(key)
    try {
      await applyMaestroWorkspaceE2EQueryControl()
      const session = await this.runtime.listMobileSessionTabs(workspaceCanvasSelector(scope))
      const sourceCursor = `${session.publicationEpoch}:${session.snapshotVersion}`
      const database = this.runtime.getOrchestrationDb()
      migrateMaestroWorkspaceCanvasStore(database)
      let canvas = readWorkspaceCanvasDocument(database, scope)
      const authorityRevision = previous
        ? previous.sourceCursor === sourceCursor
          ? previous.authorityRevision
          : Math.max(previous.authorityRevision, canvas.document.last_surface_revision) + 1
        : Math.max(1, canvas.document.last_surface_revision)
      const projection = projectWorkspaceSurfaces(
        scope,
        session,
        authorityRevision,
        (terminalHandle) => this.runtime.getTerminalProcessIncarnation(terminalHandle),
        canvas.document.annotations
      )
      const links = projectMaestroWorkspaceLinks({
        database,
        scope,
        session,
        surfaces: projection.surfaces
      })
      const snapshot = WorkspaceSurfaceSnapshotSchema.parse({
        schema_version: 1,
        protocol: WORKSPACE_SURFACE_SNAPSHOT_PROTOCOL,
        execution_host_id: scope.execution_host_id,
        workspace_key: scope.workspace_key,
        authority_revision: authorityRevision,
        authority_cursor: sourceCursor,
        state: 'ready',
        surfaces: projection.surfaces,
        unsupported:
          projection.unsupportedBrowserCount > 0
            ? [
                {
                  content_type: 'browser-without-page-identity',
                  count: projection.unsupportedBrowserCount
                }
              ]
            : [],
        ...links,
        capability: { available: true, reason: null },
        harness_overlay: null
      })
      const hasUnplacedSurface = Object.keys(snapshot.surfaces).some(
        (surfaceKey) => !canvas.document.placements[surfaceKey]
      )
      if (canvas.document.last_surface_revision !== authorityRevision || hasUnplacedSurface) {
        reconcileStoredWorkspaceCanvas(database, {
          scope,
          expected_revision: canvas.revision,
          idempotency_key: `snapshot-${authorityRevision}-${sourceCursor}`,
          snapshot
        })
        canvas = readWorkspaceCanvasDocument(database, scope)
      }
      const result = { status: 'available' as const, actor_id: actorId, snapshot, canvas }
      this.snapshots.set(key, { authorityRevision, sourceCursor, snapshot: result })
      return result
    } catch {
      return {
        status: 'unavailable',
        reason: 'authority-unreachable',
        liveness: 'unverifiable',
        ...(previous
          ? {
              last_known_snapshot: markWorkspaceSnapshotUnavailable(
                previous.snapshot.snapshot,
                'Authority unreachable.'
              )
            }
          : {})
      }
    }
  }

  async readContent(
    scope: RuntimeMaestroWorkspaceCanvasScope,
    actorId: string,
    surfaceId: NonNullable<RuntimeMaestroWorkspaceCanvasMutationResult['surface_id']>
  ): Promise<RuntimeMaestroWorkspaceContentReadResult> {
    return readMaestroWorkspaceContent({
      runtime: this.runtime,
      scope,
      surfaceId,
      query: () => this.query(scope, actorId)
    })
  }

  async mutate(
    request: RuntimeMaestroWorkspaceCanvasMutation
  ): Promise<RuntimeMaestroWorkspaceCanvasMutationResult> {
    const database = this.runtime.getOrchestrationDb()
    migrateMaestroWorkspaceCanvasStore(database)
    const previousReceipt =
      readWorkspaceCanvasMutationReceipt<RuntimeMaestroWorkspaceCanvasMutationResult>(
        database,
        request.scope,
        request.idempotency_key,
        request
      )
    if (previousReceipt) {
      return { ...previousReceipt, status: 'replayed' }
    }
    const before = await this.query(request.scope, request.actor_id)
    if (before.status !== 'available') {
      return {
        status: 'unavailable',
        authority_revision: 0,
        reason: before.reason,
        liveness: 'unverifiable'
      }
    }
    if (before.snapshot.authority_revision !== request.expected_authority_revision) {
      return { status: 'stale', authority_revision: before.snapshot.authority_revision }
    }
    if (
      request.action === 'create' &&
      request.placement &&
      request.expected_canvas_revision == null
    ) {
      return {
        status: 'stale',
        authority_revision: before.snapshot.authority_revision,
        canvas_revision: before.canvas.revision,
        reason: 'canvas_revision_required'
      }
    }
    if (
      'expected_canvas_revision' in request &&
      before.canvas.revision !== request.expected_canvas_revision
    ) {
      return {
        status: 'stale',
        authority_revision: before.snapshot.authority_revision,
        canvas_revision: before.canvas.revision,
        reason: 'canvas_revision_conflict'
      }
    }
    const selector = workspaceCanvasSelector(request.scope)
    try {
      let surfaceId: RuntimeMaestroWorkspaceCanvasMutationResult['surface_id']
      let canvasRevision = before.canvas.revision
      if (request.action === 'create') {
        const created = await createMaestroWorkspaceSurface({
          runtime: this.runtime,
          database,
          request,
          before,
          query: () => this.query(request.scope, request.actor_id)
        })
        surfaceId = created.surfaceId
        canvasRevision = created.canvasRevision
      } else if (
        request.action === 'set-placement' ||
        request.action === 'set-viewport' ||
        request.action === 'create-manual-link' ||
        request.action === 'delete-manual-link' ||
        request.action === 'decide-suggestion'
      ) {
        const mutation = mutateMaestroWorkspaceDocument({
          database,
          request,
          canvas: before.canvas,
          snapshot: before.snapshot
        })
        if (mutation.status !== 'applied') {
          return mutation
        }
        surfaceId = mutation.surface_id
        canvasRevision = mutation.canvas_revision ?? canvasRevision
      } else {
        const existing = await mutateExistingMaestroWorkspaceSurface({
          runtime: this.runtime,
          database,
          request,
          before,
          selector
        })
        if (existing.result) {
          writeWorkspaceCanvasMutationReceipt(
            database,
            request.scope,
            request.idempotency_key,
            request,
            existing.result
          )
          return existing.result
        }
        surfaceId = existing.surfaceId
        canvasRevision = existing.canvasRevision
      }
      const after =
        request.action === 'create' && surfaceId
          ? await reconcileCreatedMaestroWorkspaceSurface({
              surfaceId,
              query: () => this.query(request.scope, request.actor_id),
              wait: this.options
            })
          : await this.query(request.scope, request.actor_id)
      const result = createdSurfaceMutationResult({
        isCreate: request.action === 'create',
        beforeAuthorityRevision: before.snapshot.authority_revision,
        canvasRevision,
        surfaceId,
        after
      })
      writeWorkspaceCanvasMutationReceipt(
        database,
        request.scope,
        request.idempotency_key,
        request,
        result
      )
      return result
    } catch (error) {
      const result: RuntimeMaestroWorkspaceCanvasMutationResult = {
        status: 'outcome_unknown',
        authority_revision: before.snapshot.authority_revision,
        reason: error instanceof Error ? error.message : 'workspace_canvas_mutation_failed',
        liveness: 'unverifiable'
      }
      writeWorkspaceCanvasMutationReceipt(
        database,
        request.scope,
        request.idempotency_key,
        request,
        result
      )
      return result
    }
  }
}

const authorities = new WeakMap<OrcaRuntimeService, MaestroWorkspaceCanvasAuthority>()

export function getMaestroWorkspaceCanvasAuthority(
  runtime: OrcaRuntimeService
): MaestroWorkspaceCanvasAuthority {
  const existing = authorities.get(runtime)
  if (existing) {
    return existing
  }
  const authority = new MaestroWorkspaceCanvasAuthority(runtime)
  authorities.set(runtime, authority)
  return authority
}
