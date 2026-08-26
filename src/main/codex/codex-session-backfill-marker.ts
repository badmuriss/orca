import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  expandCodexSessionBackfillDatesThroughToday,
  getCodexSessionBackfillDate,
  mergeCodexSessionBackfillDates,
  parseCodexSessionBackfillDates,
  subtractCodexSessionBackfillDates
} from './codex-session-backfill-scan-dates'
import type {
  CodexSessionBackfillDate,
  CodexSessionBackfillSummary
} from './codex-session-backfill-types'

// Why: bump to re-run the backfill for every host after a layout or semantics
// change; the run itself stays skip-existing so re-runs never overwrite.
const CODEX_SESSION_BACKFILL_MARKER_VERSION = 4
// Why: v3 was only ever written after a certified full-tree walk, so it reads
// as a v4 baseline and existing installs never pay one more full scan.
const MARKER_BASELINE_VERSIONS: ReadonlySet<number> = new Set([3, 4])
// Why: bounds abnormal-exit recovery; past this many dates a full walk is the
// cheaper certainty.
const MAX_PENDING_SCAN_DATES = 31

let markerInvalidationGeneration = 0

export type CodexSessionBackfillBaseline = {
  /** Dates whose managed rollouts may not be published yet, widened through today. */
  pendingScanDates: readonly CodexSessionBackfillDate[]
}

export function captureCodexSessionBackfillMarkerGeneration(): number {
  return markerInvalidationGeneration
}

/**
 * Reads the certified full-history baseline for this target, if one exists.
 *
 * Null means no usable baseline, which is the only state that justifies a
 * full-tree walk. A baseline with pending dates still needs a bounded pass.
 */
export function readCodexSessionBackfillBaseline(
  markerPath: string,
  systemSessionsRoot: string,
  today: CodexSessionBackfillDate = getCodexSessionBackfillDate()
): CodexSessionBackfillBaseline | null {
  const record = readMarkerRecord(markerPath)
  if (!record?.hasBaseline || !matchesTargetRoot(record, systemSessionsRoot)) {
    return null
  }
  // Why: an empty source can become populated after an early migration run;
  // let the incremental async walk verify it without blocking the main thread.
  if (record.baselineScannedFiles === 0 || record.needsFullScan) {
    return null
  }
  // Why: only a pane that was still running when the pass ended can have written
  // dates nobody recorded — a pane held open across midnight, then force-quit.
  const pendingScanDates = record.launchActive
    ? expandCodexSessionBackfillDatesThroughToday(
        record.pendingScanDates,
        today,
        MAX_PENDING_SCAN_DATES
      )
    : record.pendingScanDates
  return pendingScanDates ? { pendingScanDates } : null
}

export function hasCompletedCodexSessionBackfillMarker(
  markerPath: string,
  systemSessionsRoot: string
): boolean {
  return readCodexSessionBackfillBaseline(markerPath, systemSessionsRoot) !== null
}

export function writeCodexSessionBackfillMarker(
  markerPath: string,
  systemSessionsRoot: string,
  summary: CodexSessionBackfillSummary,
  expectedGeneration: number,
  options: {
    /** A full pass certifies the whole tree; a bounded one may only extend that. */
    coverage: 'full' | 'bounded'
    coveredScanDates: readonly CodexSessionBackfillDate[]
    /** A live Codex pane keeps writing into its own date, so it stays pending. */
    retainPendingScanDates?: boolean
  }
): void {
  const record = readMarkerRecord(markerPath)
  const current = record && matchesTargetRoot(record, systemSessionsRoot) ? record : null
  // Why: a date-limited pass cannot certify the dates it never looked at, so
  // without an existing baseline it must publish nothing at all.
  if (options.coverage !== 'full' && !current?.hasBaseline) {
    return
  }
  // Why: a launch that began during this pass can have written rollouts the
  // walk had already gone past, so its dates must survive as pending.
  const clearCovered =
    expectedGeneration === markerInvalidationGeneration && options.retainPendingScanDates !== true
  const pendingScanDates = clearCovered
    ? subtractCodexSessionBackfillDates(current?.pendingScanDates ?? [], options.coveredScanDates)
    : mergeCodexSessionBackfillDates(current?.pendingScanDates, options.coveredScanDates)
  writeMarkerRecord(markerPath, {
    ...current?.raw,
    version: CODEX_SESSION_BACKFILL_MARKER_VERSION,
    systemSessionsRoot,
    coverage: 'full',
    completedAt: Date.now(),
    launchActive: options.retainPendingScanDates === true,
    // Why: only a full walk can speak for the whole tree, so a bounded pass
    // that legitimately scanned nothing must not read back as an empty source.
    baselineScannedFiles:
      options.coverage === 'full' ? summary.scannedFiles : current?.baselineScannedFiles,
    summary,
    ...describePendingScanDates(pendingScanDates)
  })
}

/**
 * Records dates a launch may still be writing into, keeping the baseline.
 *
 * Why not delete: the marker is the only record that the full history was ever
 * published. Dropping it makes every launch re-walk the whole sessions tree.
 */
export function markCodexSessionBackfillMarkerPending(
  markerPath: string,
  systemSessionsRoot: string,
  scanDates: readonly CodexSessionBackfillDate[]
): void {
  // Why: an older in-flight pass must not clear dates recorded after it started.
  markerInvalidationGeneration += 1
  const record = readMarkerRecord(markerPath)
  // Why: a marker for a different history says nothing about this target, and
  // the pass that recertifies this one will replace it wholesale.
  if (record && !matchesTargetRoot(record, systemSessionsRoot)) {
    return
  }
  const pendingScanDates = mergeCodexSessionBackfillDates(record?.pendingScanDates, scanDates)
  if (pendingScanDates.length === record?.pendingScanDates.length) {
    return
  }
  try {
    writeMarkerRecord(markerPath, {
      version: CODEX_SESSION_BACKFILL_MARKER_VERSION,
      systemSessionsRoot,
      coverage: 'bounded',
      ...record?.raw,
      ...describePendingScanDates(pendingScanDates)
    })
  } catch (error) {
    console.warn('[codex-session-backfill] Failed to record pending scan dates:', error)
    try {
      // Why: fail closed — a full rescan costs one slow pass, while a silently
      // unrecorded launch date hides its rollouts forever.
      rmSync(markerPath, { force: true })
    } catch (fallbackError) {
      throw new AggregateError(
        [error, fallbackError],
        'Failed to record pending Codex session backfill scan dates'
      )
    }
  }
}

type CodexSessionBackfillMarkerRecord = {
  raw: Record<string, unknown>
  systemSessionsRoot: string
  hasBaseline: boolean
  pendingScanDates: CodexSessionBackfillDate[]
  needsFullScan: boolean
  launchActive: boolean
  /** Files the last full-tree walk saw; a bounded pass must not overwrite it. */
  baselineScannedFiles: number | undefined
}

function readMarkerRecord(markerPath: string): CodexSessionBackfillMarkerRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const marker = parsed as {
      version?: unknown
      systemSessionsRoot?: unknown
      coverage?: unknown
      pendingScanDates?: unknown
      needsFullScan?: unknown
      launchActive?: unknown
      baselineScannedFiles?: unknown
      summary?: { scannedFiles?: unknown }
    }
    if (
      typeof marker.version !== 'number' ||
      !MARKER_BASELINE_VERSIONS.has(marker.version) ||
      typeof marker.systemSessionsRoot !== 'string'
    ) {
      return null
    }
    return {
      raw: parsed as Record<string, unknown>,
      systemSessionsRoot: marker.systemSessionsRoot,
      // v3 predates `coverage` and was only written after a full-tree walk.
      hasBaseline: marker.version === 3 || marker.coverage === 'full',
      pendingScanDates: parseCodexSessionBackfillDates(marker.pendingScanDates),
      needsFullScan: marker.needsFullScan === true,
      launchActive: marker.launchActive === true,
      // v3 wrote only one summary, and it was always a full-tree one.
      baselineScannedFiles: readOptionalCount(
        marker.baselineScannedFiles ?? marker.summary?.scannedFiles
      )
    }
  } catch {
    return null
  }
}

/** Why: changing the configured real Codex home must backfill the new target
 * instead of honoring a marker written for a different history — and Windows
 * spells one directory several ways, so compare normalized. */
function matchesTargetRoot(
  record: CodexSessionBackfillMarkerRecord,
  systemSessionsRoot: string
): boolean {
  return (
    normalizeRuntimePathForComparison(record.systemSessionsRoot) ===
    normalizeRuntimePathForComparison(systemSessionsRoot)
  )
}

function readOptionalCount(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function describePendingScanDates(
  pendingScanDates: readonly CodexSessionBackfillDate[]
): Record<string, unknown> {
  return pendingScanDates.length > MAX_PENDING_SCAN_DATES
    ? { pendingScanDates: [], needsFullScan: true }
    : { pendingScanDates, needsFullScan: false }
}

function writeMarkerRecord(markerPath: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileAtomically(markerPath, `${JSON.stringify(record, null, 2)}\n`)
}
