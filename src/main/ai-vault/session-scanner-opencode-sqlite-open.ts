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
export const OPENCODE_SQLITE_BUSY_TIMEOUT_MS = 1_500
// Bounded, never unbounded: one extra attempt covers a write that outlives the
// busy timeout without turning a wedged DB into an open-ended stall.
export const OPENCODE_SQLITE_MAX_ATTEMPTS = 2
export const OPENCODE_SQLITE_RETRY_DELAY_MS = 250
// Ceiling for a whole list pass: N contended DBs must still finish well inside
// the worker's 30 s LIST_TIMEOUT_MS, so waiting stops once the budget is spent.
export const OPENCODE_SQLITE_CONTENTION_BUDGET_MS = 12_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * Open an OpenCode database read-only with a bounded SQLite busy timeout.
 * @param dbPath - Absolute path to an opencode.db file.
 * @returns An open read-only handle the caller must close.
 */
export function openOpenCodeDatabaseReadonly(dbPath: string): SyncDatabase {
  const db = new SyncDatabase(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: OPENCODE_SQLITE_BUSY_TIMEOUT_MS
  })
  // Belt-and-suspenders guard so a bug in a SELECT list can never mutate the
  // user's opencode.db.
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
  for (let attempt = 1; ; attempt += 1) {
    let db: SyncDatabase | null = null
    try {
      db = openOpenCodeDatabaseReadonly(args.dbPath)
      return args.read(db)
    } catch (error) {
      const budgetLeft =
        args.contentionDeadline === undefined || Date.now() < args.contentionDeadline
      if (
        attempt >= OPENCODE_SQLITE_MAX_ATTEMPTS ||
        !budgetLeft ||
        !isTransientSqliteContention(error)
      ) {
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
 * Kinded so the panel renders the scanner's own copy instead of counting a
 * failed *source* as a skipped *transcript* — the DB holds every OpenCode
 * session, so "1 transcript skipped" understates it by orders of magnitude.
 * `scope` (not a new member) because a shipped client validates `kind` against
 * a closed enum and reports a non-matching issue as an invalid, *unkinded*
 * entry — which would resurrect the very miscount this replaces.
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
