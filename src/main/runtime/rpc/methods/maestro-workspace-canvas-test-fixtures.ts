import { vi } from 'vitest'
import { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { applyMaestroProjection } from '../../orchestration/db/maestro/maestro-projection-store'
import {
  MaestroWorkspaceCanvasAuthority,
  type MaestroWorkspaceCanvasRuntime
} from '../../services/maestro-workspace-canvas/maestro-workspace-canvas-authority'
import {
  browserReceipt,
  editorSession,
  linkedSession,
  scope,
  session
} from './maestro-workspace-canvas-session-fixtures'

export { editorSession, linkedSession, scope, session }

export function publishLinkGraph(
  database: OrchestrationDb,
  params?: {
    revision?: number
    browserIdentity?: Parameters<typeof browserReceipt>[0]
    duplicateBrowserReceipt?: boolean
  }
): void {
  const revision = params?.revision ?? 7
  const browser = browserReceipt(params?.browserIdentity)
  applyMaestroProjection.call(
    database,
    {
      repository_id: 'repo-1',
      execution_host_id: scope.execution_host_id,
      workspace_key: scope.workspace_key,
      run_id: 'run-1'
    },
    {
      schema_version: 1,
      protocol: 'agent-graph-view/v1',
      kind: 'snapshot',
      workspace_scope: {
        schema_version: 1,
        repository_id: 'repo-1',
        canonical_root: '/workspace',
        execution_host: { id: scope.execution_host_id, boundary: 'local' },
        orchestration_home: {
          execution_host_id: scope.execution_host_id,
          workspace_key: scope.workspace_key,
          kind: 'folder',
          path: '/workspace'
        },
        execution_workspace: {
          execution_host_id: scope.execution_host_id,
          workspace_key: scope.workspace_key,
          kind: 'folder',
          path: '/workspace'
        },
        base_revision: 'base-1',
        dirty_paths: [],
        run_id: 'run-1',
        coordinator_generation: 2,
        binding_receipt_ref: 'artifact:workspace-bootstrap.json',
        binding_receipt_hash: `sha256:${'a'.repeat(64)}`
      },
      change: 'maestro-workspace-tab-canvas',
      run_id: 'run-1',
      coordinator: { id: 'coordinator-generation-2', generation: 2 },
      capabilities: {
        agents: ['codex'],
        efforts: ['high'],
        placement_kinds: ['current-workspace'],
        watch_deltas: false
      },
      nodes: [
        {
          id: 'terminal-receipt-1',
          type: 'terminal-receipt',
          status: 'active',
          summary: 'Exact Codex terminal receipt',
          resource: {
            terminal_id: 'terminal-handle-1',
            terminal_status: 'running',
            liveness: 'live'
          }
        },
        {
          id: 'browser-receipt-1',
          type: 'browser-surface',
          status: 'active',
          summary: 'Exact Browser surface receipt',
          resource: browser
        },
        ...(params?.duplicateBrowserReceipt
          ? [
              {
                id: 'browser-receipt-duplicate',
                type: 'browser-surface' as const,
                status: 'active',
                summary: 'Duplicate exact Browser receipt',
                resource: {
                  ...browser,
                  surface_id: 'browser-surface-duplicate',
                  request_id: 'browser-request-duplicate'
                }
              }
            ]
          : [])
      ],
      edges: [
        {
          id: 'edge-terminal-executes-browser',
          type: 'executes',
          source_id: 'terminal-receipt-1',
          target_id: 'browser-receipt-1'
        }
      ],
      removed_node_ids: [],
      removed_edge_ids: [],
      revision,
      cursor: null,
      from_cursor: null,
      reset_required: false,
      progress: undefined
    }
  )
}

export function attachLinkLease(
  database: OrchestrationDb,
  overrides: {
    runId?: string
    taskId?: string
    attemptId?: string
    agent?: 'codex' | null
  } = {}
): void {
  const lease = database.reserveMaestroTerminalLease({
    requestId: `terminal-request-${overrides.runId ?? 'run-1'}-${overrides.taskId ?? 'MWC-INTEG'}-${overrides.attemptId ?? 'attempt-mwc-integ-002'}-${overrides.agent ?? 'none'}`,
    executionHostId: scope.execution_host_id,
    workspaceKey: scope.workspace_key,
    runId: overrides.runId ?? 'run-1',
    taskId: overrides.taskId ?? 'MWC-INTEG',
    attemptId: overrides.attemptId ?? 'attempt-mwc-integ-002',
    role: 'worker',
    workerTerminalResourceId: 'terminal-receipt-1',
    title: 'MWC-INTEG · worker · Codex',
    launchProfile: {
      agent: overrides.agent === undefined ? 'codex' : overrides.agent,
      model: null,
      effort: 'high',
      permissionMode: 'default',
      routeRef: null
    },
    spawnedBy: 'coordinator-generation-2',
    ownerPrincipal: 'worker:attempt-mwc-integ-002',
    retentionPolicy: 'retain'
  })
  database.attachMaestroTerminalLease({
    leaseId: lease.id,
    terminalHandle: 'terminal-handle-1',
    tabId: 'terminal-tab-1',
    paneKey: 'leaf-1',
    ptyIncarnation: 'pty-1:incarnation-7',
    processRootId: 'pid:1'
  })
}

export function harness() {
  const database = new OrchestrationDb(':memory:')
  const listMobileSessionTabs = vi.fn().mockResolvedValue(session())
  const runtime = {
    listMobileSessionTabs,
    activateMobileSessionTab: vi.fn().mockResolvedValue(session()),
    closeMobileSessionTab: vi.fn().mockResolvedValue({ closed: true }),
    createMobileSessionTerminal: vi.fn().mockResolvedValue({
      tab: session().tabs[0],
      publicationEpoch: 'renderer-1',
      snapshotVersion: 2
    }),
    browserTabCreate: vi.fn().mockResolvedValue({ browserPageId: 'browser-page-2' }),
    createMaestroWorkspaceAnnotation: vi.fn().mockResolvedValue({
      worktreeId: 'folder-1',
      filePath: '/workspace/.orca/maestro/annotation.md'
    }),
    commandMaestroWorkspaceTab: vi.fn().mockResolvedValue({ tabId: 'annotation-tab-1' }),
    readMobileFile: vi
      .fn()
      .mockResolvedValue({ content: 'exact content', truncated: false, byteLength: 13 }),
    getTerminalProcessIncarnation: vi.fn().mockReturnValue('pty-1:incarnation-7'),
    getOrchestrationDb: () => database
  } satisfies MaestroWorkspaceCanvasRuntime
  return { authority: new MaestroWorkspaceCanvasAuthority(runtime), database, runtime }
}
