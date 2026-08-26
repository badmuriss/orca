import type { CodexSessionBackfillDate } from './codex-session-backfill-types'

// Set algebra over the UTC date directories that make up a bounded backfill
// pass. Kept apart from the walk itself so the durable marker, the scheduler,
// and the pass all agree on identity, ordering, and range expansion.

export function getCodexSessionBackfillDate(date = new Date()): CodexSessionBackfillDate {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ]
}

export function isCodexSessionBackfillDate(value: unknown): value is CodexSessionBackfillDate {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    /^\d{4}$/.test(String(value[0])) &&
    /^\d{2}$/.test(String(value[1])) &&
    /^\d{2}$/.test(String(value[2]))
  )
}

export function toCodexSessionBackfillDateKey(date: CodexSessionBackfillDate): string {
  return date.join('-')
}

export function compareCodexSessionBackfillDates(
  left: CodexSessionBackfillDate,
  right: CodexSessionBackfillDate
): number {
  return toCodexSessionBackfillDateKey(left).localeCompare(toCodexSessionBackfillDateKey(right))
}

/** Deduplicated ascending union; invalid entries are dropped. */
export function mergeCodexSessionBackfillDates(
  ...groups: readonly (readonly CodexSessionBackfillDate[] | undefined)[]
): CodexSessionBackfillDate[] {
  const merged = new Map<string, CodexSessionBackfillDate>()
  for (const group of groups) {
    for (const date of group ?? []) {
      if (isCodexSessionBackfillDate(date)) {
        merged.set(toCodexSessionBackfillDateKey(date), date)
      }
    }
  }
  return [...merged.values()].sort(compareCodexSessionBackfillDates)
}

export function subtractCodexSessionBackfillDates(
  dates: readonly CodexSessionBackfillDate[],
  removed: readonly CodexSessionBackfillDate[]
): CodexSessionBackfillDate[] {
  const removedKeys = new Set(removed.map(toCodexSessionBackfillDateKey))
  return dates.filter((date) => !removedKeys.has(toCodexSessionBackfillDateKey(date)))
}

/** Reads persisted marker dates; anything unrecognized is discarded. */
export function parseCodexSessionBackfillDates(value: unknown): CodexSessionBackfillDate[] {
  return Array.isArray(value)
    ? mergeCodexSessionBackfillDates(value.filter(isCodexSessionBackfillDate))
    : []
}

export function getCodexSessionBackfillDatesBetween(
  startedAt: Date,
  finishedAt: Date
): CodexSessionBackfillDate[] {
  const dates: CodexSessionBackfillDate[] = []
  const cursor = toUtcMidnight(startedAt)
  const last = toUtcMidnight(finishedAt)
  while (cursor <= last) {
    dates.push(getCodexSessionBackfillDate(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/**
 * Widens a pending set into the contiguous range that ends at `today`.
 *
 * Why: an abnormal exit or a pane held open across midnight leaves activity on
 * dates nobody got to record. The gap between the oldest pending date and today
 * is the smallest window that provably contains them. Returns null once that
 * window outgrows `maxDates`, where a full walk is the cheaper certainty.
 */
export function expandCodexSessionBackfillDatesThroughToday(
  dates: readonly CodexSessionBackfillDate[],
  today: CodexSessionBackfillDate,
  maxDates: number
): CodexSessionBackfillDate[] | null {
  if (dates.length === 0) {
    return []
  }
  const bounds = mergeCodexSessionBackfillDates(dates, [today])
  const range = getCodexSessionBackfillDatesBetween(toUtcDate(bounds[0]), toUtcDate(bounds.at(-1)!))
  return range.length > maxDates ? null : range
}

function toUtcDate([year, month, day]: CodexSessionBackfillDate): Date {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
