import type { MaestroCanvasIndexEntry } from '../../../../shared/maestro-canvas-index'
import type { MaestroRunProgressSummary } from '../../../../shared/maestro-run-progress'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

export type MaestroNavigatorHost = {
  id: string
  label: string
  reachable: boolean
}

export type MaestroNavigatorWorkspace = {
  executionHostId: string
  workspaceKey: string
  name: string
  projectId: string
  projectName: string
  archived: boolean
}

export type MaestroNavigatorRow = {
  key: string
  executionHostId: string
  workspaceKey: string
  workspaceKind: 'worktree' | 'folder'
  workspaceName: string
  projectId: string
  projectName: string
  reachable: boolean
  updatedAt: string
  revision: number
  progress: MaestroRunProgressSummary | null
  progressUnavailable: boolean
}

export type MaestroNavigatorProjectGroup = {
  id: string
  label: string
  rows: MaestroNavigatorRow[]
}

export type MaestroNavigatorHostGroup = MaestroNavigatorHost & {
  projects: MaestroNavigatorProjectGroup[]
}

export function maestroNavigatorRowKey(executionHostId: string, workspaceKey: string): string {
  return `${executionHostId}\u0000${workspaceKey}`
}

export function isMaestroRuntimeHostReachable(
  runtimeStatus: { status: unknown } | undefined
): boolean {
  return runtimeStatus?.status !== null && runtimeStatus?.status !== undefined
}

function progressForEntry(entry: MaestroCanvasIndexEntry): {
  progress: MaestroRunProgressSummary | null
  progressUnavailable: boolean
} {
  if (!entry.runProgress) {
    return { progress: null, progressUnavailable: false }
  }
  if (!entry.runProgress.available) {
    return { progress: null, progressUnavailable: true }
  }
  if (
    entry.runProgress.authority.workspace.executionHostId !== entry.executionHostId ||
    entry.runProgress.authority.workspace.workspaceKey !== entry.workspaceKey
  ) {
    return { progress: null, progressUnavailable: true }
  }
  return { progress: entry.runProgress.summary, progressUnavailable: false }
}

export function buildMaestroNavigatorGroups(input: {
  entries: readonly MaestroCanvasIndexEntry[]
  hosts: readonly MaestroNavigatorHost[]
  workspaces: readonly MaestroNavigatorWorkspace[]
  query: string
  recentKeys: readonly string[]
}): MaestroNavigatorHostGroup[] {
  const hosts = new Map(input.hosts.map((host) => [host.id, host]))
  const workspaces = new Map(
    input.workspaces.map((workspace) => [
      maestroNavigatorRowKey(workspace.executionHostId, workspace.workspaceKey),
      workspace
    ])
  )
  const recentRank = new Map(input.recentKeys.map((key, index) => [key, index]))
  const query = input.query.trim().toLocaleLowerCase()
  const rows: MaestroNavigatorRow[] = []

  for (const entry of input.entries) {
    const scope = parseWorkspaceKey(entry.workspaceKey)
    const key = maestroNavigatorRowKey(entry.executionHostId, entry.workspaceKey)
    const workspace = workspaces.get(key)
    if (!scope || !workspace || workspace.archived) {
      continue
    }
    const host = hosts.get(entry.executionHostId)
    const searchable =
      `${workspace.name} ${workspace.projectName} ${host?.label ?? entry.executionHostId}`.toLocaleLowerCase()
    if (query && !searchable.includes(query)) {
      continue
    }
    rows.push({
      key,
      executionHostId: entry.executionHostId,
      workspaceKey: entry.workspaceKey,
      workspaceKind: scope.type,
      workspaceName: workspace.name,
      projectId: workspace.projectId,
      projectName: workspace.projectName,
      reachable: host?.reachable ?? false,
      updatedAt: entry.updatedAt,
      revision: entry.revision,
      ...progressForEntry(entry)
    })
  }

  rows.sort((left, right) => {
    const leftRank = recentRank.get(left.key)
    const rightRank = recentRank.get(right.key)
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER)
    }
    return right.updatedAt.localeCompare(left.updatedAt)
  })

  const rowsByHost = new Map<string, Map<string, MaestroNavigatorProjectGroup>>()
  for (const row of rows) {
    const projects = rowsByHost.get(row.executionHostId) ?? new Map()
    const project = projects.get(row.projectId) ?? {
      id: row.projectId,
      label: row.projectName,
      rows: []
    }
    project.rows.push(row)
    projects.set(row.projectId, project)
    rowsByHost.set(row.executionHostId, projects)
  }

  return input.hosts.map((host) => ({
    ...host,
    projects: [...(rowsByHost.get(host.id)?.values() ?? [])]
  }))
}

export function maestroNavigatorRows(
  groups: readonly MaestroNavigatorHostGroup[]
): MaestroNavigatorRow[] {
  return groups.flatMap((host) => host.projects.flatMap((project) => project.rows))
}

export function moveMaestroNavigatorSelection(
  rows: readonly MaestroNavigatorRow[],
  selectedKey: string | null,
  direction: 1 | -1
): string | null {
  if (rows.length === 0) {
    return null
  }
  const currentIndex = rows.findIndex((row) => row.key === selectedKey)
  const nextIndex =
    currentIndex === -1 ? (direction === 1 ? 0 : rows.length - 1) : currentIndex + direction
  return rows[(nextIndex + rows.length) % rows.length].key
}
