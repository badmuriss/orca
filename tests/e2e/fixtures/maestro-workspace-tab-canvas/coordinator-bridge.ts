import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@stablyai/playwright-test'
import { RuntimeClient } from '../../../../src/cli/runtime-client'
import { AgentGraphViewSchema } from '../../../../src/shared/maestro-contract'
import { waitForActivePaneHookDescriptor } from '../../helpers/terminal'
import { buildBrowserSurfaceReceipt } from './browser-surface-receipt'
import { buildCodexCoordinatorSource } from './codex-coordinator-source'
import { activeWorkspaceTabContentType, openMaestro, type MaestroScope } from './evidence'

async function call(dir: string, method: string, params: unknown): Promise<void> {
  const label = method.replaceAll('.', '-')
  const result = path.join(dir, `${label}-result.json`)
  writeFileSync(path.join(dir, `${label}-request.json`), JSON.stringify({ method, params }))
  await expect.poll(() => existsSync(result), { timeout: 60_000 }).toBe(true)
  const response = JSON.parse(readFileSync(result, 'utf8')) as { ok?: boolean; error?: unknown }
  expect(response.ok, JSON.stringify(response.error ?? response)).toBe(true)
}

function graphView(p: {
  repositoryId: string
  workspacePath: string
  scope: MaestroScope
  runId: string
  generation: number
  taskId: string
  attemptId: string
  terminalHandle: string
  browserPageId: string
  browserUrl: string
  now: string
}): Record<string, unknown> {
  const workspace = {
    execution_host_id: p.scope.host,
    workspace_key: p.scope.workspace,
    kind: 'git-worktree',
    path: p.workspacePath
  }
  const empty = { count: 0, ids: [], truncated: false }
  const browserSurface = buildBrowserSurfaceReceipt(p)
  return {
    schema_version: 1,
    protocol: 'agent-graph-view/v1',
    kind: 'snapshot',
    workspace_scope: {
      schema_version: 1,
      repository_id: p.repositoryId,
      canonical_root: p.workspacePath,
      execution_host: { id: p.scope.host, boundary: 'local' },
      orchestration_home: workspace,
      execution_workspace: workspace,
      base_revision: 'mwc-e2e',
      dirty_paths: [],
      run_id: p.runId,
      coordinator_generation: p.generation,
      binding_receipt_ref: 'artifact:mwc-e2e-workspace-binding.json',
      binding_receipt_hash: `sha256:${'b'.repeat(64)}`
    },
    change: 'maestro-workspace-tab-canvas',
    run_id: p.runId,
    coordinator: { id: 'mwc-codex-coordinator', generation: p.generation },
    capabilities: {
      agents: ['codex'],
      efforts: ['high'],
      placement_kinds: ['current-workspace'],
      watch_deltas: false
    },
    nodes: [
      {
        id: 'mwc-terminal-receipt',
        type: 'terminal-receipt',
        status: 'active',
        summary: 'Codex-designated deterministic PTY worker',
        task_id: p.taskId,
        attempt_id: p.attemptId,
        resource: { terminal_id: p.terminalHandle, terminal_status: 'running', liveness: 'live' }
      },
      {
        id: 'mwc-browser-receipt',
        type: 'browser-surface',
        status: 'active',
        summary: 'Existing exact Browser page',
        task_id: p.taskId,
        attempt_id: p.attemptId,
        resource: browserSurface
      }
    ],
    edges: [
      {
        id: 'mwc-worker-executes-browser',
        type: 'executes',
        source_id: 'mwc-terminal-receipt',
        target_id: 'mwc-browser-receipt'
      }
    ],
    removed_node_ids: [],
    removed_edge_ids: [],
    revision: 9,
    cursor: null,
    from_cursor: null,
    reset_required: false,
    progress: {
      schema_version: 1,
      state: 'active',
      progress_percent: 60,
      task_counts: {
        approved: 1,
        running: 1,
        input_required: 0,
        blocked: 1,
        pending: 1,
        failed: 0
      },
      current_tasks: [{ task_id: p.taskId, attempt_id: p.attemptId, status: 'running' }],
      next_tasks: [{ task_id: 'MWC-NEXT', attempt_id: null, status: 'pending' }],
      cleanup: { pending: empty, unverifiable: empty, failed: empty, retained: empty },
      last_activity: { sequence: 9, timestamp: p.now, type: 'attempt_started' },
      blockers: [{ task_id: 'MWC-BLOCKED', attempt_id: null, finding_ref: null, cleanup_id: null }],
      material_findings: []
    }
  }
}

export async function publishAuthenticatedHarness(params: {
  page: Page
  userDataDir: string
  scope: MaestroScope
  browserPageId: string
  browserUrl: string
}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-mwc-codex-bridge-'))
  const bridge = path.join(dir, 'codex-coordinator.cjs')
  writeFileSync(
    bridge,
    buildCodexCoordinatorSource(dir, path.resolve('out/cli'), params.userDataDir)
  )
  await params.page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: command },
      agentDefaultArgs: { codex: '' }
    })
  }, `node ${bridge}`)
  await params.page.getByRole('button', { name: 'New tab' }).click()
  await params.page
    .getByRole('menuitem', { name: /^Codex(?:\s|$)/ })
    .first()
    .click()
  const livePath = path.join(dir, 'coordinator-live.json')
  await expect
    .poll(
      () => {
        if (!existsSync(livePath)) {
          return false
        }
        const receipt = JSON.parse(readFileSync(livePath, 'utf8')) as Record<string, unknown>
        return (
          Object.keys(receipt).sort().join(',') === 'pid,terminalHandle' &&
          Number.isInteger(receipt.pid) &&
          Number(receipt.pid) > 0 &&
          typeof receipt.terminalHandle === 'string' &&
          receipt.terminalHandle.length > 0
        )
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  const liveReceipt = JSON.parse(readFileSync(livePath, 'utf8')) as {
    pid: number
    terminalHandle: string
  }
  const pane = await waitForActivePaneHookDescriptor(params.page)
  const client = new RuntimeClient(params.userDataDir, 30_000, null, null)
  const coordinator = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
    paneKey: pane.paneKey
  })
  const handle = coordinator.result.terminal.handle
  expect(handle).toBe(liveReceipt.terminalHandle)
  const run = await client.call<{ run: { id: string; consumer_generation: number } }>(
    'orchestration.runCreate',
    { objective: 'MWC authenticated progress evidence', from: handle }
  )
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    run: run.result.run.id,
    spec: 'Codex-only exact workspace evidence',
    callerTerminalHandle: handle
  })
  const attemptId = `attempt-mwc-e2e-${process.pid}`
  const workerFixture = path.resolve(
    'tests/e2e/fixtures/maestro-workspace-tab-canvas/codex-worker.cjs'
  )
  await params.page.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: command },
      agentDefaultArgs: { codex: '' }
    })
  }, `node ${workerFixture}`)
  await openMaestro(params.page, true)
  const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
    'orchestration.workerStart',
    {
      task: task.result.task.id,
      from: handle,
      agent: 'codex',
      attemptId,
      timeoutMs: 30_000
    }
  )
  const workerHandle = started.result.effects.find(
    (effect) => effect.kind === 'terminal' && effect.role === 'agent'
  )?.id
  if (!workerHandle) {
    throw new Error('Codex worker terminal receipt was not created')
  }
  const workerTerminal = await client.call<{ terminal: { tabId: string } }>('terminal.show', {
    terminal: workerHandle
  })
  await expect
    .poll(() =>
      params.page.evaluate((expectedTabId) => {
        const state = window.__store?.getState()
        return Object.values(state?.unifiedTabsByWorktree ?? {})
          .flat()
          .some((tab) => tab.contentType === 'terminal' && tab.id === expectedTabId)
      }, workerTerminal.result.terminal.tabId)
    )
    .toBe(true)
  await expect.poll(() => activeWorkspaceTabContentType(params.page)).toBe('maestro')
  await expect(params.page.locator('[data-maestro-workspace-canvas]')).toBeVisible()
  const terminal = await client.call<{ terminal: { worktreeId: string } }>('terminal.show', {
    terminal: handle
  })
  const separator = terminal.result.terminal.worktreeId.indexOf('::')
  const repositoryId = terminal.result.terminal.worktreeId.slice(0, separator)
  const workspacePath = terminal.result.terminal.worktreeId.slice(separator + 2)
  const now = new Date().toISOString()
  const view = graphView({
    ...params,
    repositoryId,
    workspacePath,
    runId: run.result.run.id,
    generation: run.result.run.consumer_generation,
    taskId: task.result.task.id,
    attemptId,
    terminalHandle: workerHandle,
    now
  })
  const parsedView = AgentGraphViewSchema.safeParse(view)
  expect(parsedView.error?.issues ?? []).toEqual([])
  expect(parsedView.success && parsedView.data.progress !== undefined).toBe(true)
  await call(dir, 'maestro.projection.apply', {
    workspace: {
      repository_id: repositoryId,
      execution_host_id: params.scope.host,
      workspace_key: params.scope.workspace,
      run_id: run.result.run.id
    },
    view
  })
  const projection = await client.call<{
    nodes: { id: string; browserSurface?: unknown }[]
  } | null>('maestro.projection.get', {
    scope: { execution_host_id: params.scope.host, workspace_key: params.scope.workspace }
  })
  expect(
    projection.result?.nodes.find((node) => node.id === 'mwc-browser-receipt')?.browserSurface
  ).toEqual(
    buildBrowserSurfaceReceipt({
      ...params,
      runId: run.result.run.id,
      taskId: task.result.task.id,
      attemptId,
      now
    })
  )
  return {
    runId: run.result.run.id,
    workerTabId: workerTerminal.result.terminal.tabId,
    cleanup: async () => {
      for (const terminalHandle of [workerHandle, handle]) {
        await client.call('terminal.close', { terminal: terminalHandle }).catch(() => undefined)
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
