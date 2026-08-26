import { basename } from 'node:path'
import type { AiVaultScanIssue } from '../../shared/ai-vault-types'
import { isWslUncPath } from '../../shared/wsl-paths'
import SyncDatabase from '../sqlite/sync-database'
import {
  classifySqliteReadFailure,
  isTransientSqliteContention
} from '../sqlite/sqlite-read-failure'
import { errorMessage } from './session-scanner-values'

// Why (#15036): OpenCode keeps opencode.db open while it runs, so a scan lands
// mid-write routinely. With no busy timeout sqlite3 gives up in ~1 ms with
// SQLITE_BUSY, and one contended DB emptied the entire Agent Session History
// panel. Every OpenCode read now opens with a bounded busy timeout.
const OPENCODE_SQLITE_BUSY_TIMEOUT_MS = 1_500
// Bounded, never unbounded: one extra attempt covers a write that outlives the
// busy timeout without turning a wedged DB into an open-ended stall.
const OPENCODE_SQLITE_MAX_ATTEMPTS = 2
const OPENCODE_SQLITE_RETRY_DELAY_MS = 250
// Ceiling for a whole list pass: N contended DBs must still finish well inside
// the worker's 30 s LIST_TIMEOUT_MS, so waiting stops once the budget is spent.
export const OPENCODE_SQLITE_CONTENTION_BUDGET_MS = 12_000
// Why: parses run one session at a time, so a wedged DB would charge the full
// wait once per session and eat the whole scan's budget. After a contended read
// the same DB fast-fails (its pre-#15036 cost) until this expires; any success
// clears it, and the window matches the panel's 15 s host-leg cache so the next
// natural refresh still gets a full-wait attempt.
const OPENCODE_SQLITE_CONTENTION_BACKOFF_MS = 15_000

const contendedUntilByDbPath = new Map<string, number>()

function isBackingOffFromContention(dbPath: string): boolean {
  const until = contendedUntilByDbPath.get(dbPath)
  if (until === undefined) {
    return false
  }
  if (until > Date.now()) {
    return true
  }
  contendedUntilByDbPath.delete(dbPath)
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

// Read-only, plus `query_only` as a belt-and-suspenders guard so a bug in a
// SELECT list can never mutate the user's opencode.db.
function openOpenCodeDatabaseReadonly(dbPath: string, busyTimeoutMs: number): SyncDatabase {
  const db = new SyncDatabase(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: busyTimeoutMs
  })
  db.pragma('query_only = ON')
  return db
}

/**
 * Run one synchronous read against an OpenCode database, retrying a bounded
 * number of times while the failure is lock contention and the budget allows.
 * @param args.dbPath - Absolute path to an opencode.db file.
 * @param args.read - Synchronous reader; its result must be fully materialized.
 * @param args.contentionDeadline - `Date.now()` ceiling past which retries stop.
 * @returns The reader's value; rethrows the last error when retries are exhausted.
 */
export async function readOpenCodeDatabase<T>(args: {
  dbPath: string
  read: (db: SyncDatabase) => T
  contentionDeadline?: number
}): Promise<T> {
  const backingOff = isBackingOffFromContention(args.dbPath)
  const maxAttempts = backingOff ? 1 : OPENCODE_SQLITE_MAX_ATTEMPTS
  const busyTimeoutMs = backingOff ? 0 : OPENCODE_SQLITE_BUSY_TIMEOUT_MS
  for (let attempt = 1; ; attempt += 1) {
    let db: SyncDatabase | null = null
    try {
      db = openOpenCodeDatabaseReadonly(args.dbPath, busyTimeoutMs)
      const value = args.read(db)
      contendedUntilByDbPath.delete(args.dbPath)
      return value
    } catch (error) {
      const contended = isTransientSqliteContention(error)
      if (contended) {
        contendedUntilByDbPath.set(args.dbPath, Date.now() + OPENCODE_SQLITE_CONTENTION_BACKOFF_MS)
      }
      const budgetLeft =
        args.contentionDeadline === undefined || Date.now() < args.contentionDeadline
      if (attempt >= maxAttempts || !budgetLeft || !contended) {
        throw error
      }
    } finally {
      db?.close()
    }
    await delay(OPENCODE_SQLITE_RETRY_DELAY_MS)
  }
}

function walIndexAdvice(dbPath: string): string {
  // Named only when the evidence supports it; a generic share gets generic copy.
  return isWslUncPath(dbPath)
    ? 'Windows cannot open its write-ahead log over the \\\\wsl.localhost share. Run OpenCode inside the distro and exit it cleanly to flush the log.'
    : 'Its write-ahead log cannot be opened read-only on this filesystem. Exit OpenCode cleanly to flush the log.'
}

/**
 * Describe a whole-database read failure as a scan issue.
 *
 * Kinded so the panel renders this copy instead of counting a failed *source*
 * as a skipped *transcript*; `scope` rather than a new member — see
 * `aiVaultScanIssueSchema` in session-list-result-validation.ts.
 * @param dbPath - Absolute path to the opencode.db that could not be read.
 * @param error - The thrown value from the read.
 * @returns A kinded scan issue with actionable copy.
 */
export function openCodeDatabaseScanIssue(dbPath: string, error: unknown): AiVaultScanIssue {
  const name = basename(dbPath)
  // `fileMustExist` already proved the database file is there before SQLite ran,
  // so this needs no fs probe of its own — an extra sync stat on a 9p share is
  // exactly the hang the WSL transcript gate exists to prevent.
  const kind = classifySqliteReadFailure({ error, databaseFileExists: true })
  const detail =
    kind === 'contended'
      ? `OpenCode is writing to ${name} right now, so its history was skipped. It is read again on the next refresh.`
      : kind === 'wal-index-unavailable'
        ? `OpenCode history in ${name} could not be read. ${walIndexAdvice(dbPath)}`
        : `OpenCode history in ${name} could not be read: ${errorMessage(error)}`
  return { agent: 'opencode', kind: 'scope', path: dbPath, message: detail }
}
