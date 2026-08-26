import {
  MaestroBrowserSurfaceActionRequestSchema,
  MaestroBrowserSurfaceRequestSchema,
  MAESTRO_BROWSER_EVIDENCE_PROTOCOL,
  type MaestroBrowserPanePaint,
  type MaestroBrowserSurfaceReceipt,
  type MaestroBrowserSurfaceRequest
} from '../../../../shared/maestro-browser-surface'
import {
  browserSurfaceWorktreeId,
  browserSurfaceWorktreeSelector
} from '../../orchestration/maestro-browser-surface-worktree-identity'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'
import { resolveMaestroPrincipal } from '../maestro-principal'
import { BROWSER_SURFACE_LIFECYCLE_METHODS } from './orchestration-browser-surface-lifecycle'
import {
  capturedSurfaceState,
  fileErrorCode,
  NO_PANE_PAINT_REASON,
  observedVisibility,
  persistMaestroBrowserEvidence,
  requireCoordinator,
  showExactSurface,
  UNOBSERVED_PANE_PAINT_REASON,
  withPanePaintObservation
} from './orchestration-browser-surface-authority'

export async function ensureMaestroBrowserSurface(
  request: MaestroBrowserSurfaceRequest,
  context: RpcContext
): Promise<MaestroBrowserSurfaceReceipt> {
  const database = context.runtime.getOrchestrationDb()
  const reserved = database.reserveMaestroBrowserSurface(request)
  if (['active', 'retained', 'released'].includes(reserved.receipt.state)) {
    return reserved.receipt
  }
  const creating = database.updateMaestroBrowserSurface(reserved.receipt.surface_id, (receipt) => ({
    ...receipt,
    state: 'creating'
  }))
  const pageId = creating.receipt.browser_page_id
  if (!pageId) {
    throw new OrchestrationError(
      'browser_surface_identity_missing',
      'The browser surface reservation has no page identity.'
    )
  }

  const worktreeId = browserSurfaceWorktreeId(request.workspace.workspace_key)
  const worktree = browserSurfaceWorktreeSelector(request.workspace.workspace_key)
  let created = false
  try {
    await context.runtime.browserTabShow({ page: pageId, worktree })
  } catch (error) {
    if (fileErrorCode(error) !== 'browser_tab_not_found' && request.ownership === 'user') {
      throw error
    }
    if (request.ownership === 'user') {
      return database.updateMaestroBrowserSurface(creating.receipt.surface_id, (receipt) => ({
        ...receipt,
        state: 'unavailable',
        observed_visibility: 'unavailable',
        focus_receipt: {
          ...receipt.focus_receipt,
          unavailable_reason: 'The user-owned page is not available on its exact workspace.'
        }
      })).receipt
    }
    created = true
  }

  let workspaceActivated = false
  if (request.requested_visibility === 'visible') {
    await context.runtime.activateManagedWorktree(worktree, { navigation: 'host' })
    workspaceActivated = true
  }
  const createResult = created
    ? await context.runtime.browserTabCreate({
        url: creating.navigationUrl,
        worktree,
        page: pageId,
        profileId: request.profile_id ?? undefined,
        waitForRegistration: true,
        activate: request.requested_visibility === 'visible',
        focus: request.requested_visibility === 'visible'
      })
    : null
  if (!created && request.requested_visibility === 'visible') {
    await context.runtime.browserTabSwitch({ page: pageId, worktree, focus: true })
  }
  const shown = await context.runtime.browserTabShow({ page: pageId, worktree })
  if (
    shown.tab.browserPageId !== pageId ||
    (shown.tab.worktreeId !== null && shown.tab.worktreeId !== worktreeId) ||
    (shown.tab.profileId ?? null) !== request.profile_id
  ) {
    throw new OrchestrationError(
      'browser_surface_identity_mismatch',
      'The native Browser page does not match the reserved workspace, page, and profile.'
    )
  }
  const focusReceipt = createResult?.focusReceipt
  const requestedVisible = request.requested_visibility === 'visible'
  const exactPageSelected =
    requestedVisible && (focusReceipt?.exactPageSelected ?? shown.tab.active)
  // Why: an offscreen surface never asked for a pane probe, so its paint is unobserved rather than
  // a negative verdict — same as a probe that could not run.
  const panePaint: MaestroBrowserPanePaint = requestedVisible
    ? (focusReceipt?.nativePanePaint ?? 'unobserved')
    : 'unobserved'
  const panePaintObservedAt = panePaint === 'unobserved' ? null : (focusReceipt?.observedAt ?? null)
  if (requestedVisible && panePaint !== 'painted') {
    return database.updateMaestroBrowserSurface(creating.receipt.surface_id, (receipt) => ({
      ...receipt,
      state: 'unavailable',
      observed_visibility: observedVisibility(shown.tab.active, panePaint),
      focus_receipt: {
        requested: true,
        workspace_activated: workspaceActivated,
        exact_page_selected: exactPageSelected,
        native_pane_paint: panePaint,
        observed_at: panePaintObservedAt,
        unavailable_reason:
          panePaint === 'unobserved' ? UNOBSERVED_PANE_PAINT_REASON : NO_PANE_PAINT_REASON
      }
    })).receipt
  }

  const capture =
    request.evidence.capture_mode === 'native-full-page'
      ? await context.runtime.browserFullScreenshot({ format: 'png', page: pageId, worktree })
      : await context.runtime.browserScreenshot({ format: 'png', page: pageId, worktree })
  const artifact = await persistMaestroBrowserEvidence(capture.data, capture.format)
  const now = new Date().toISOString()
  return database.updateMaestroBrowserSurface(creating.receipt.surface_id, (receipt) => ({
    ...receipt,
    state: request.retention === 'retain' ? 'retained' : 'active',
    observed_visibility: request.requested_visibility,
    focus_receipt: {
      requested: requestedVisible,
      workspace_activated: workspaceActivated,
      exact_page_selected: exactPageSelected,
      native_pane_paint: panePaint,
      observed_at: panePaintObservedAt,
      unavailable_reason: null
    },
    evidence_receipt: {
      protocol: 'maestro-browser-evidence/v1',
      artifact_ref: artifact.artifactRef,
      artifact_hash: artifact.artifactHash,
      format: capture.format,
      dimensions: {
        width: artifact.width,
        height: artifact.height,
        device_scale_factor: request.viewport.device_scale_factor
      },
      route_or_component: request.evidence.route_or_component,
      state: request.evidence.state,
      theme: request.evidence.theme,
      source_revision: request.evidence.source_revision,
      capture_mode: request.evidence.capture_mode,
      captured_at: now,
      vision_review: { outcome: 'pending', reviewer: null, observation: null }
    }
  })).receipt
}

export const ORCHESTRATION_BROWSER_SURFACE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.browserSurface.ensure',
    params: MaestroBrowserSurfaceRequestSchema,
    handler: async (request, context) => {
      const principal = await resolveMaestroPrincipal(context, request.workspace)
      requireCoordinator(principal, request.workspace, request.coordinator_generation)
      return ensureMaestroBrowserSurface(
        {
          ...request,
          actor: {
            actor_id: principal.actor_id,
            kind: principal.kind,
            authenticated: true,
            session_id: principal.session_id
          }
        },
        context
      )
    }
  }),
  defineMethod({
    name: 'orchestration.browserSurface.focus',
    params: MaestroBrowserSurfaceActionRequestSchema,
    handler: async (request, context) => {
      const principal = await resolveMaestroPrincipal(context, request.workspace)
      requireCoordinator(principal, request.workspace, request.coordinator_generation)
      const { page, record } = await showExactSurface(request, context)
      const worktree = browserSurfaceWorktreeSelector(request.workspace.workspace_key)
      await context.runtime.activateManagedWorktree(worktree, { navigation: 'host' })
      const switched = await context.runtime.browserTabSwitch({
        page,
        worktree,
        focus: true
      })
      const { shown } = await showExactSurface(request, context)
      return context.runtime
        .getOrchestrationDb()
        .updateMaestroBrowserSurface(record.receipt.surface_id, (receipt) => {
          // Why: focus re-observes the pane it just switched to, so a real verdict upgrades the
          // receipt; without one the recorded verdict stands rather than being restamped as fresh.
          const focus_receipt = withPanePaintObservation(
            receipt.focus_receipt,
            switched.focusReceipt
          )
          return {
            ...receipt,
            observed_visibility: observedVisibility(
              shown.tab.active,
              focus_receipt.native_pane_paint
            ),
            focus_receipt: {
              ...focus_receipt,
              requested: true,
              workspace_activated: true,
              exact_page_selected: shown.tab.active
            }
          }
        }).receipt
    }
  }),
  defineMethod({
    name: 'orchestration.browserSurface.capture',
    params: MaestroBrowserSurfaceActionRequestSchema,
    handler: async (request, context) => {
      const principal = await resolveMaestroPrincipal(context, request.workspace)
      requireCoordinator(principal, request.workspace, request.coordinator_generation)
      const { page, record, shown } = await showExactSurface(request, context)
      const worktree = browserSurfaceWorktreeSelector(request.workspace.workspace_key)
      const capture =
        record.receipt.evidence.capture_mode === 'native-full-page'
          ? await context.runtime.browserFullScreenshot({ format: 'png', page, worktree })
          : await context.runtime.browserScreenshot({ format: 'png', page, worktree })
      const artifact = await persistMaestroBrowserEvidence(capture.data, capture.format)
      const now = new Date().toISOString()
      return context.runtime
        .getOrchestrationDb()
        .updateMaestroBrowserSurface(record.receipt.surface_id, (receipt) => ({
          ...receipt,
          // Why: a validated native screenshot of the exact page is paint evidence, so it recovers a
          // surface that settled unavailable before the page had a chance to paint.
          state: capturedSurfaceState(receipt),
          observed_visibility: observedVisibility(shown.tab.active, 'painted'),
          focus_receipt: {
            ...receipt.focus_receipt,
            exact_page_selected: shown.tab.active,
            native_pane_paint: 'painted',
            observed_at: now,
            unavailable_reason: null
          },
          evidence_receipt: {
            protocol: MAESTRO_BROWSER_EVIDENCE_PROTOCOL,
            artifact_ref: artifact.artifactRef,
            artifact_hash: artifact.artifactHash,
            format: capture.format,
            dimensions: {
              width: artifact.width,
              height: artifact.height,
              device_scale_factor: receipt.viewport.device_scale_factor
            },
            route_or_component: receipt.evidence.route_or_component,
            state: receipt.evidence.state,
            theme: receipt.evidence.theme,
            source_revision: receipt.evidence.source_revision,
            capture_mode: receipt.evidence.capture_mode,
            captured_at: now,
            vision_review: { outcome: 'pending', reviewer: null, observation: null }
          }
        })).receipt
    }
  }),
  ...BROWSER_SURFACE_LIFECYCLE_METHODS
]
