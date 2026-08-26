import type {
  MaestroBrowserSurfaceReceipt,
  MaestroBrowserSurfaceRequest
} from '../../../../../shared/maestro-browser-surface'
import { MaestroBrowserSurfaceReceiptSchema } from '../../../../../shared/maestro-browser-surface'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'

type BrowserSurfaceRow = {
  surface_id: string
  request_id: string
  execution_host_id: string
  workspace_key: string
  run_id: string
  task_id: string
  attempt_id: string
  agent_id: string
  owner_principal: string
  ownership: 'harness' | 'user'
  browser_page_id: string | null
  navigation_url: string
  state: MaestroBrowserSurfaceReceipt['state']
  retention: MaestroBrowserSurfaceReceipt['retention']
  receipt_json: string
  created_at: string
  updated_at: string
}

export type MaestroBrowserSurfaceRecord = {
  receipt: MaestroBrowserSurfaceReceipt
  navigationUrl: string
}

function isoDate(value: string): string {
  return `${value.replace(' ', 'T')}Z`
}

function publicUrl(value: string): { url: string; origin: string } {
  const parsed = new URL(value)
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return { url: parsed.toString(), origin: parsed.origin }
}

function parseRow(row: BrowserSurfaceRow): MaestroBrowserSurfaceRecord {
  let receiptValue: unknown
  try {
    receiptValue = JSON.parse(row.receipt_json)
  } catch {
    throw new OrchestrationError(
      'browser_surface_receipt_invalid',
      `Browser surface ${row.surface_id} has an invalid receipt.`
    )
  }
  const storedReceipt = MaestroBrowserSurfaceReceiptSchema.parse(receiptValue)
  const receipt = MaestroBrowserSurfaceReceiptSchema.parse({
    ...storedReceipt,
    browser_page_id: row.browser_page_id,
    state: row.state,
    retention: row.retention,
    created_at: isoDate(row.created_at),
    updated_at: isoDate(row.updated_at)
  })
  return { receipt, navigationUrl: row.navigation_url }
}

function getRowByRequest(
  database: OrchestrationDb,
  requestId: string
): BrowserSurfaceRow | undefined {
  return database.db
    .prepare('SELECT * FROM maestro_browser_surfaces WHERE request_id = ?')
    .get(requestId) as BrowserSurfaceRow | undefined
}

function getRowByAttempt(
  database: OrchestrationDb,
  request: MaestroBrowserSurfaceRequest
): BrowserSurfaceRow | undefined {
  return database.db
    .prepare(
      `SELECT * FROM maestro_browser_surfaces
       WHERE execution_host_id = ? AND workspace_key = ? AND run_id = ?
         AND task_id = ? AND attempt_id = ? AND state != 'released'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(
      request.workspace.execution_host_id,
      request.workspace.workspace_key,
      request.workspace.run_id,
      request.task_id,
      request.attempt_id
    ) as BrowserSurfaceRow | undefined
}

function assertSameRequest(
  receipt: MaestroBrowserSurfaceReceipt,
  request: MaestroBrowserSurfaceRequest
): void {
  if (
    receipt.run_id !== request.workspace.run_id ||
    receipt.execution_host_id !== request.workspace.execution_host_id ||
    receipt.workspace_key !== request.workspace.workspace_key ||
    receipt.task_id !== request.task_id ||
    receipt.attempt_id !== request.attempt_id ||
    receipt.agent_id !== request.agent_id ||
    receipt.owner_principal !== request.actor.actor_id ||
    receipt.ownership !== request.ownership ||
    receipt.requested_visibility !== request.requested_visibility ||
    receipt.retention !== request.retention ||
    receipt.profile_id !== request.profile_id
  ) {
    throw new OrchestrationError(
      'request_mismatch',
      `Browser surface request ${request.request_id} is already bound to another identity.`
    )
  }
}

export function getMaestroBrowserSurface(
  this: OrchestrationDb,
  surfaceId: string
): MaestroBrowserSurfaceRecord | undefined {
  const row = this.db
    .prepare('SELECT * FROM maestro_browser_surfaces WHERE surface_id = ?')
    .get(surfaceId) as BrowserSurfaceRow | undefined
  return row ? parseRow(row) : undefined
}

export function getMaestroBrowserSurfaceByRequest(
  this: OrchestrationDb,
  requestId: string
): MaestroBrowserSurfaceRecord | undefined {
  const row = getRowByRequest(this, requestId)
  return row ? parseRow(row) : undefined
}

export function reserveMaestroBrowserSurface(
  this: OrchestrationDb,
  request: MaestroBrowserSurfaceRequest
): MaestroBrowserSurfaceRecord {
  this.db.exec('SAVEPOINT maestro_browser_surface_reserve')
  try {
    const existingRow = getRowByRequest(this, request.request_id) ?? getRowByAttempt(this, request)
    if (existingRow) {
      const existing = parseRow(existingRow)
      assertSameRequest(existing.receipt, request)
      this.db.exec('RELEASE maestro_browser_surface_reserve')
      return existing
    }

    const surfaceId = `browser-surface-${request.request_id}`
    const browserPageId = request.browser_page_id ?? `maestro-${request.request_id}`
    const publicLocation = publicUrl(request.url)
    const now = new Date().toISOString()
    const receipt = MaestroBrowserSurfaceReceiptSchema.parse({
      schema_version: 1,
      protocol: 'maestro-browser-surface/v1',
      surface_id: surfaceId,
      request_id: request.request_id,
      run_id: request.workspace.run_id,
      task_id: request.task_id,
      attempt_id: request.attempt_id,
      agent_id: request.agent_id,
      owner_principal: request.actor.actor_id,
      ownership: request.ownership,
      execution_host_id: request.workspace.execution_host_id,
      workspace_key: request.workspace.workspace_key,
      browser_page_id: browserPageId,
      title: request.title,
      url: publicLocation.url,
      origin: publicLocation.origin,
      profile_id: request.profile_id,
      requested_visibility: request.requested_visibility,
      observed_visibility: 'unverifiable',
      viewport: request.viewport,
      retention: request.retention,
      state: 'reserved',
      focus_receipt: {
        requested: request.requested_visibility === 'visible',
        workspace_activated: false,
        exact_page_selected: false,
        native_pane_paint: 'unobserved',
        observed_at: null,
        unavailable_reason: null
      },
      evidence: request.evidence,
      evidence_receipt: null,
      release_receipt: {
        requested: false,
        outcome: 'not_requested',
        exact_page_closed: false,
        profile_affected: false,
        observed_at: null,
        reason: null
      },
      created_at: now,
      updated_at: now
    })
    this.db
      .prepare(
        `INSERT INTO maestro_browser_surfaces (
          surface_id, request_id, execution_host_id, workspace_key, run_id, task_id,
          attempt_id, agent_id, owner_principal, ownership, browser_page_id,
          navigation_url, state, retention, receipt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`
      )
      .run(
        surfaceId,
        request.request_id,
        request.workspace.execution_host_id,
        request.workspace.workspace_key,
        request.workspace.run_id,
        request.task_id,
        request.attempt_id,
        request.agent_id,
        request.actor.actor_id,
        request.ownership,
        browserPageId,
        request.url,
        request.retention,
        JSON.stringify(receipt)
      )
    const created = this.getMaestroBrowserSurface(surfaceId)
    this.db.exec('RELEASE maestro_browser_surface_reserve')
    return created as MaestroBrowserSurfaceRecord
  } catch (error) {
    this.db.exec('ROLLBACK TO maestro_browser_surface_reserve')
    this.db.exec('RELEASE maestro_browser_surface_reserve')
    throw error
  }
}

export function updateMaestroBrowserSurface(
  this: OrchestrationDb,
  surfaceId: string,
  update: (receipt: MaestroBrowserSurfaceReceipt) => MaestroBrowserSurfaceReceipt
): MaestroBrowserSurfaceRecord {
  const current = this.getMaestroBrowserSurface(surfaceId)
  if (!current) {
    throw new OrchestrationError(
      'browser_surface_not_found',
      `Browser surface ${surfaceId} was not found.`
    )
  }
  const next = MaestroBrowserSurfaceReceiptSchema.parse({
    ...update(current.receipt),
    surface_id: current.receipt.surface_id,
    request_id: current.receipt.request_id,
    created_at: current.receipt.created_at,
    updated_at: new Date().toISOString()
  })
  const changed = this.db
    .prepare(
      `UPDATE maestro_browser_surfaces SET browser_page_id = ?, state = ?, retention = ?,
       receipt_json = ?, updated_at = datetime('now') WHERE surface_id = ?`
    )
    .run(next.browser_page_id, next.state, next.retention, JSON.stringify(next), surfaceId)
  if (changed.changes !== 1) {
    throw new OrchestrationError(
      'browser_surface_not_found',
      `Browser surface ${surfaceId} was not found.`
    )
  }
  return this.getMaestroBrowserSurface(surfaceId) as MaestroBrowserSurfaceRecord
}

export function listReconcilableMaestroBrowserSurfaces(
  this: OrchestrationDb
): MaestroBrowserSurfaceRecord[] {
  const rows = this.db
    .prepare(
      `SELECT * FROM maestro_browser_surfaces
       WHERE state IN ('reserved', 'creating', 'active', 'retained', 'release_pending', 'outcome_unknown')
       ORDER BY created_at, surface_id`
    )
    .all() as BrowserSurfaceRow[]
  return rows.map(parseRow)
}

export type MaestroBrowserSurfaceStoreMethods = {
  getMaestroBrowserSurface: typeof getMaestroBrowserSurface
  getMaestroBrowserSurfaceByRequest: typeof getMaestroBrowserSurfaceByRequest
  reserveMaestroBrowserSurface: typeof reserveMaestroBrowserSurface
  updateMaestroBrowserSurface: typeof updateMaestroBrowserSurface
  listReconcilableMaestroBrowserSurfaces: typeof listReconcilableMaestroBrowserSurfaces
}

export function attachMaestroBrowserSurfaceStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getMaestroBrowserSurface,
    getMaestroBrowserSurfaceByRequest,
    reserveMaestroBrowserSurface,
    updateMaestroBrowserSurface,
    listReconcilableMaestroBrowserSurfaces
  })
}
