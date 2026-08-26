import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { canConsumeMaestroIntent } from '../../../../shared/maestro-actor'
import type {
  MaestroBrowserFocusReceipt,
  MaestroBrowserPanePaint,
  MaestroBrowserSurfaceActionRequest,
  MaestroBrowserSurfaceReceipt,
  MaestroBrowserSurfaceRequest
} from '../../../../shared/maestro-browser-surface'
import {
  browserSurfaceWorktreeId,
  browserSurfaceWorktreeSelector
} from '../../orchestration/maestro-browser-surface-worktree-identity'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { RpcContext } from '../core'
import type { resolveMaestroPrincipal } from '../maestro-principal'

/** Authority, exact-surface resolution and evidence persistence for Browser surfaces. */
export function requireCoordinator(
  principal: Awaited<ReturnType<typeof resolveMaestroPrincipal>>,
  workspace: MaestroBrowserSurfaceRequest['workspace'],
  generation: number
): void {
  if (!canConsumeMaestroIntent(principal, workspace, generation)) {
    throw new OrchestrationError(
      'unauthorized',
      'Only the authenticated current coordinator can manage browser surfaces.'
    )
  }
}

export function requireExactSurface(
  request: MaestroBrowserSurfaceActionRequest,
  context: RpcContext
) {
  const record = context.runtime.getOrchestrationDb().getMaestroBrowserSurface(request.surface_id)
  if (!record) {
    throw new OrchestrationError(
      'browser_surface_not_found',
      `Browser surface ${request.surface_id} was not found.`
    )
  }
  if (
    record.receipt.run_id !== request.workspace.run_id ||
    record.receipt.execution_host_id !== request.workspace.execution_host_id ||
    record.receipt.workspace_key !== request.workspace.workspace_key
  ) {
    throw new OrchestrationError(
      'browser_surface_identity_mismatch',
      'The browser surface does not belong to this run and workspace.'
    )
  }
  if (!record.receipt.browser_page_id) {
    throw new OrchestrationError(
      'browser_surface_identity_missing',
      'The browser surface has no page identity.'
    )
  }
  return record
}

export function observedVisibility(
  active: boolean,
  paint: MaestroBrowserPanePaint
): MaestroBrowserSurfaceReceipt['observed_visibility'] {
  if (!active) {
    return 'offscreen'
  }
  // Why: never-observed is not the same answer as observed-and-blank, so it keeps its own verdict.
  if (paint === 'unobserved') {
    return 'unverifiable'
  }
  return paint === 'painted' ? 'visible' : 'hidden'
}

export const NO_PANE_PAINT_REASON = 'The exact native Browser pane produced no paint.'
export const UNOBSERVED_PANE_PAINT_REASON =
  'The exact native Browser pane has not been observed for paint yet.'

/** A genuine new observation replaces the recorded verdict; no observation leaves it untouched. */
export function withPanePaintObservation(
  focusReceipt: MaestroBrowserFocusReceipt,
  observed: { nativePanePaint: MaestroBrowserPanePaint; observedAt: string | null } | undefined
): MaestroBrowserFocusReceipt {
  if (!observed || observed.nativePanePaint === 'unobserved') {
    return focusReceipt
  }
  return {
    ...focusReceipt,
    native_pane_paint: observed.nativePanePaint,
    observed_at: observed.observedAt,
    unavailable_reason: observed.nativePanePaint === 'painted' ? null : NO_PANE_PAINT_REASON
  }
}

// Why: a capture is evidence, not a release decision — it must never pull a surface back out of
// its release lifecycle, and it must respect the retention the surface was reserved with.
const RELEASE_LIFECYCLE_STATES: ReadonlySet<MaestroBrowserSurfaceReceipt['state']> = new Set([
  'release_pending',
  'released',
  'outcome_unknown'
])

export function capturedSurfaceState(
  receipt: MaestroBrowserSurfaceReceipt
): MaestroBrowserSurfaceReceipt['state'] {
  if (RELEASE_LIFECYCLE_STATES.has(receipt.state)) {
    return receipt.state
  }
  return receipt.retention === 'retain' ? 'retained' : 'active'
}

export async function showExactSurface(
  request: MaestroBrowserSurfaceActionRequest,
  context: RpcContext
) {
  const record = requireExactSurface(request, context)
  const page = record.receipt.browser_page_id
  if (!page) {
    throw new OrchestrationError(
      'browser_surface_identity_missing',
      'The browser surface has no page identity.'
    )
  }
  const worktreeId = browserSurfaceWorktreeId(request.workspace.workspace_key)
  const shown = await context.runtime.browserTabShow({
    page,
    worktree: browserSurfaceWorktreeSelector(request.workspace.workspace_key)
  })
  if (
    shown.tab.browserPageId !== record.receipt.browser_page_id ||
    (shown.tab.worktreeId !== null && shown.tab.worktreeId !== worktreeId) ||
    (shown.tab.profileId ?? null) !== record.receipt.profile_id
  ) {
    throw new OrchestrationError(
      'browser_surface_identity_mismatch',
      'The native Browser page does not match the reserved workspace, page, and profile.'
    )
  }
  return { page, record, shown }
}

export function fileErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }
  return typeof error.code === 'string' ? error.code : null
}

export async function persistMaestroBrowserEvidence(data: string, format: 'png' | 'jpeg') {
  const bytes = Buffer.from(data, 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const directory = join(app.getPath('userData'), 'maestro-browser-evidence', 'sha256')
  const filename = `${hash}.${format === 'jpeg' ? 'jpg' : 'png'}`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(join(directory, filename), bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (fileErrorCode(error) !== 'EEXIST') {
      throw error
    }
  }
  const size = nativeImage.createFromBuffer(bytes).getSize()
  if (size.width < 1 || size.height < 1) {
    throw new OrchestrationError(
      'browser_surface_capture_invalid',
      'The native Browser capture did not contain a valid image.'
    )
  }
  return {
    artifactRef: `artifact:maestro-browser-evidence/sha256/${filename}`,
    artifactHash: `sha256:${hash}` as const,
    width: size.width,
    height: size.height
  }
}
