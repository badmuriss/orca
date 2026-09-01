import type { OrchestrationDb } from '../orchestration-db'

type LegacyProjectionRow = {
  run_id: string
  revision: number
  view_json: string
  updated_at: string
}

type ProjectionAliases = {
  homeExecutionHostId: string
  homeWorkspaceKey: string
  executionExecutionHostId: string
  executionWorkspaceKey: string
}

export function applySchemaMigrationV35(this: OrchestrationDb, current: number): void {
  if (current >= 35) {
    return
  }
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS maestro_human_reviews (
      review_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      execution_host_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      dispatch_id TEXT NOT NULL,
      references_json TEXT NOT NULL,
      review_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maestro_human_reviews_run
      ON maestro_human_reviews(execution_host_id, workspace_key, run_id, updated_at);
  `)
  migrateMaestroRunProjections.call(this)
  if (!this.hasColumn('tasks', 'purpose')) {
    this.db.exec(`
      ALTER TABLE tasks ADD COLUMN purpose TEXT NOT NULL DEFAULT 'deliverable'
        CHECK(purpose IN ('deliverable', 'operational'));
      ALTER TABLE tasks ADD COLUMN operational_outcome TEXT
        CHECK(operational_outcome IN ('successful', 'failed', 'superseded', 'unverifiable'));
      ALTER TABLE tasks ADD COLUMN successor_task_id TEXT;
    `)
  }
  if (this.hasColumn('worker_terminal_resources', 'retention_owner')) {
    return
  }
  this.db.exec(`
    ALTER TABLE worker_terminal_resources RENAME TO worker_terminal_resources_v34;
    DROP INDEX IF EXISTS idx_worker_terminal_resources_owner;
    DROP INDEX IF EXISTS idx_worker_terminal_resources_handle;
    DROP INDEX IF EXISTS idx_worker_terminal_resources_pane;
    DROP INDEX IF EXISTS idx_worker_terminal_resources_identity;
    DROP INDEX IF EXISTS idx_worker_terminal_resources_release;

    CREATE TABLE worker_terminal_resources (
      id                       TEXT PRIMARY KEY,
      origin_dispatch_id       TEXT NOT NULL,
      owner_dispatch_id        TEXT NOT NULL,
      prior_owner_dispatch_ids TEXT NOT NULL DEFAULT '[]',
      worktree_id              TEXT,
      terminal_handle          TEXT NOT NULL,
      pane_key                 TEXT,
      process_incarnation      TEXT,
      host_scope               TEXT,
      ownership_state          TEXT NOT NULL DEFAULT 'owned'
        CHECK(ownership_state IN ('owned', 'transferred', 'user_owned', 'external', 'released')),
      release_state            TEXT NOT NULL DEFAULT 'not_requested'
        CHECK(release_state IN (
          'not_requested', 'retained', 'retained_for_review',
          'requested', 'releasing', 'released', 'unknown'
        )),
      retained_reason          TEXT,
      retention_owner          TEXT,
      retention_expires_at     TEXT,
      review_id                TEXT,
      release_requested_at     TEXT,
      release_completed_at     TEXT,
      release_error            TEXT,
      archive_source           TEXT,
      archive_status           TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO worker_terminal_resources (
      id, origin_dispatch_id, owner_dispatch_id, prior_owner_dispatch_ids,
      worktree_id, terminal_handle, pane_key, process_incarnation, host_scope,
      ownership_state, release_state, retained_reason, release_requested_at,
      release_completed_at, release_error, archive_source, archive_status, created_at, updated_at
    )
    SELECT
      id, origin_dispatch_id, owner_dispatch_id, prior_owner_dispatch_ids,
      worktree_id, terminal_handle, pane_key, process_incarnation, host_scope,
      ownership_state, release_state, retained_reason, release_requested_at,
      release_completed_at, release_error, archive_source, archive_status, created_at, updated_at
    FROM worker_terminal_resources_v34;
    DROP TABLE worker_terminal_resources_v34;

    CREATE UNIQUE INDEX idx_worker_terminal_resources_owner
      ON worker_terminal_resources(owner_dispatch_id);
    CREATE INDEX idx_worker_terminal_resources_handle
      ON worker_terminal_resources(terminal_handle);
    CREATE INDEX idx_worker_terminal_resources_pane
      ON worker_terminal_resources(pane_key);
    CREATE INDEX idx_worker_terminal_resources_identity
      ON worker_terminal_resources(process_incarnation, host_scope);
    CREATE INDEX idx_worker_terminal_resources_release
      ON worker_terminal_resources(release_state);
  `)
}

function migrateMaestroRunProjections(this: OrchestrationDb): void {
  if (!this.hasColumn('maestro_run_projections', 'home_execution_host_id')) {
    const legacyRows = this.db
      .prepare(
        `SELECT run_id, revision, view_json, updated_at
         FROM maestro_run_projections ORDER BY updated_at, rowid`
      )
      .all() as LegacyProjectionRow[]
    const projectionsByRun = new Map(legacyRows.map((row) => [row.run_id, row]))
    this.db.exec(`
      DROP INDEX IF EXISTS idx_maestro_run_projections_run;
      ALTER TABLE maestro_run_projections RENAME TO maestro_run_projections_v34;
      CREATE TABLE maestro_run_projections (
        run_id TEXT PRIMARY KEY,
        home_execution_host_id TEXT NOT NULL,
        home_workspace_key TEXT NOT NULL,
        execution_execution_host_id TEXT NOT NULL,
        execution_workspace_key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        view_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const insert = this.db.prepare(
      `INSERT INTO maestro_run_projections (
         run_id, home_execution_host_id, home_workspace_key,
         execution_execution_host_id, execution_workspace_key,
         revision, view_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of projectionsByRun.values()) {
      const aliases = parseProjectionAliases(row)
      insert.run(
        row.run_id,
        aliases.homeExecutionHostId,
        aliases.homeWorkspaceKey,
        aliases.executionExecutionHostId,
        aliases.executionWorkspaceKey,
        row.revision,
        row.view_json,
        row.updated_at
      )
    }
    this.db.exec('DROP TABLE maestro_run_projections_v34;')
  }
  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_maestro_run_projections_home
      ON maestro_run_projections(home_execution_host_id, home_workspace_key, updated_at);
    CREATE INDEX IF NOT EXISTS idx_maestro_run_projections_execution
      ON maestro_run_projections(
        execution_execution_host_id, execution_workspace_key, updated_at
      );
    DROP TABLE IF EXISTS maestro_run_projection_records;
  `)
}

function parseProjectionAliases(row: LegacyProjectionRow): ProjectionAliases {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.view_json)
  } catch {
    throw new Error(`Stored Maestro projection for Run ${row.run_id} is invalid JSON.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Stored Maestro projection for Run ${row.run_id} is invalid.`)
  }
  const view = parsed as Record<string, unknown>
  const scope = view.workspace_scope
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || view.run_id !== row.run_id) {
    throw new Error(`Stored Maestro projection for Run ${row.run_id} has invalid authority.`)
  }
  const workspaceScope = scope as Record<string, unknown>
  const home = parseWorkspaceAlias(workspaceScope.orchestration_home, row.run_id)
  const execution = parseWorkspaceAlias(workspaceScope.execution_workspace, row.run_id)
  return {
    homeExecutionHostId: home.executionHostId,
    homeWorkspaceKey: home.workspaceKey,
    executionExecutionHostId: execution.executionHostId,
    executionWorkspaceKey: execution.workspaceKey
  }
}

function parseWorkspaceAlias(value: unknown, runId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Stored Maestro projection for Run ${runId} has an invalid workspace alias.`)
  }
  const alias = value as Record<string, unknown>
  if (typeof alias.execution_host_id !== 'string' || typeof alias.workspace_key !== 'string') {
    throw new Error(`Stored Maestro projection for Run ${runId} has an invalid workspace alias.`)
  }
  return { executionHostId: alias.execution_host_id, workspaceKey: alias.workspace_key }
}
