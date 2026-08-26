import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiVaultScanIssue } from '../../shared/ai-vault-types'
import Database from '../sqlite/sync-database'
import { listOpenCodeSqliteSessions } from './session-scanner-opencode-sqlite-list'
import {
  openCodeDatabaseScanIssue,
  readOpenCodeDatabase,
  OPENCODE_SQLITE_BUSY_TIMEOUT_MS,
  OPENCODE_SQLITE_MAX_ATTEMPTS
} from './session-scanner-opencode-sqlite-open'

// Reproduces #15036: OpenCode holds opencode.db open while it runs, so a scan
// lands mid-write. The reader had no busy timeout, failed in ~1 ms with the bare
// driver string "database is locked", and one failed DB emptied both scopes.

let tempDirs: string[] = []
let lockHolders: Worker[] = []

afterEach(async () => {
  await Promise.all(lockHolders.splice(0).map((worker) => worker.terminate()))
  lockHolders = []
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

const SCHEMA = `
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  )
`

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-opencode-open-'))
  tempDirs.push(dir)
  return dir
}

function seededDatabase(name: string, sessionId: string): string {
  const path = join(tempDir(), name)
  const db = new Database(path)
  db.exec('PRAGMA journal_mode=DELETE')
  db.exec(SCHEMA)
  db.prepare('INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)').run(
    sessionId,
    1_700_000_000_000,
    1_700_000_001_000
  )
  db.close()
  return path
}

// The lock holder must live on another thread: sqlite3_busy_timeout sleeps
// synchronously, so a same-thread timer could never fire to release it.
const LOCK_HOLDER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads')
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(workerData.path)
  db.exec('BEGIN EXCLUSIVE')
  db.exec("INSERT INTO session (id, time_created, time_updated) VALUES ('locked-write', 1, 1)")
  parentPort.postMessage('locked')
  setTimeout(() => {
    db.exec('ROLLBACK')
    db.close()
    parentPort.postMessage('released')
  }, workerData.holdMs)
`

async function holdWriteLock(path: string, holdMs: number): Promise<void> {
  const worker = new Worker(LOCK_HOLDER_SOURCE, { eval: true, workerData: { path, holdMs } })
  lockHolders.push(worker)
  await new Promise<void>((resolve, reject) => {
    worker.once('message', () => resolve())
    worker.once('error', reject)
  })
}

describe('listOpenCodeSqliteSessions against a database OpenCode is writing to', () => {
  it('reports the failure as a whole source, not as a skipped transcript', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    await holdWriteLock(path, 60_000)
    const issues: AiVaultScanIssue[] = []

    const candidates = await listOpenCodeSqliteSessions({ dbPaths: [path], limit: 10, issues })

    expect(candidates).toEqual([])
    expect(issues).toHaveLength(1)
    // The panel counts only unkinded issues as skipped transcripts.
    expect(issues[0]?.kind).toBe('scope')
    expect(issues[0]?.message).toContain('OpenCode is writing to opencode.db')
    expect(issues[0]?.message).not.toBe('database is locked')
  })

  it('still returns sessions from every other database', async () => {
    const contended = seededDatabase('opencode.db', 'session-a')
    const healthy = seededDatabase('opencode-alt.db', 'session-b')
    await holdWriteLock(contended, 60_000)
    const issues: AiVaultScanIssue[] = []

    const candidates = await listOpenCodeSqliteSessions({
      dbPaths: [contended, healthy],
      limit: 10,
      issues
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.file.path).toContain('session-b')
    expect(issues).toHaveLength(1)
  })

  it('reads the sessions once the write finishes inside the busy timeout', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    await holdWriteLock(path, 200)
    const issues: AiVaultScanIssue[] = []

    const candidates = await listOpenCodeSqliteSessions({ dbPaths: [path], limit: 10, issues })

    expect(issues).toEqual([])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.file.path).toContain('session-a')
  })

  it('retries once past the busy timeout when the writer outlives it', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    await holdWriteLock(path, OPENCODE_SQLITE_BUSY_TIMEOUT_MS + 200)
    const issues: AiVaultScanIssue[] = []

    const candidates = await listOpenCodeSqliteSessions({ dbPaths: [path], limit: 10, issues })

    expect(issues).toEqual([])
    expect(candidates).toHaveLength(1)
  }, 20_000)
})

describe('readOpenCodeDatabase retry bounds', () => {
  const busy = Object.assign(new Error('database is locked'), { errcode: 5 })

  it('stops after the attempt cap instead of retrying without bound', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    let attempts = 0

    await expect(
      readOpenCodeDatabase({
        dbPath: path,
        read: () => {
          attempts += 1
          throw busy
        }
      })
    ).rejects.toThrow('database is locked')
    expect(attempts).toBe(OPENCODE_SQLITE_MAX_ATTEMPTS)
  })

  it('makes a single attempt once the contention budget is spent', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    let attempts = 0

    await expect(
      readOpenCodeDatabase({
        dbPath: path,
        contentionDeadline: Date.now() - 1,
        read: () => {
          attempts += 1
          throw busy
        }
      })
    ).rejects.toThrow('database is locked')
    expect(attempts).toBe(1)
  })

  it('does not retry a failure that retrying cannot fix', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    let attempts = 0

    await expect(
      readOpenCodeDatabase({
        dbPath: path,
        read: () => {
          attempts += 1
          throw Object.assign(new Error('database disk image is malformed'), { errcode: 11 })
        }
      })
    ).rejects.toThrow('malformed')
    expect(attempts).toBe(1)
  })

  it('closes the handle on the success path', async () => {
    const path = seededDatabase('opencode.db', 'session-a')
    let captured: Database.Database | null = null

    const rows = await readOpenCodeDatabase({
      dbPath: path,
      read: (db) => {
        captured = db
        return db.prepare('SELECT id FROM session').all()
      }
    })

    expect(rows).toEqual([{ id: 'session-a' }])
    expect(() => captured!.prepare('SELECT 1')).toThrow(/not open/i)
  })
})

describe('openCodeDatabaseScanIssue', () => {
  const cantOpen = Object.assign(new Error('unable to open database file'), { errcode: 14 })

  it('names the wal-index over a WSL share rather than repeating the driver string', () => {
    const issue = openCodeDatabaseScanIssue(
      '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.local\\share\\opencode\\opencode.db',
      cantOpen
    )

    expect(issue.kind).toBe('scope')
    expect(issue.message).toContain('\\\\wsl.localhost')
    expect(issue.message).toContain('write-ahead log')
  })

  it('keeps the advice generic for a non-WSL path', () => {
    const issue = openCodeDatabaseScanIssue('/home/ada/.local/share/opencode/opencode.db', cantOpen)

    expect(issue.message).not.toContain('wsl.localhost')
    expect(issue.message).toContain('write-ahead log')
  })

  it('reports anything else with its underlying cause', () => {
    const issue = openCodeDatabaseScanIssue(
      '/home/ada/.local/share/opencode/opencode.db',
      Object.assign(new Error('database disk image is malformed'), { errcode: 11 })
    )

    expect(issue.kind).toBe('scope')
    expect(issue.message).not.toContain('write-ahead log')
    expect(issue.message).toContain('database disk image is malformed')
  })
})
