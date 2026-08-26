import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { listMaestroCanvases } from '@/runtime/runtime-maestro-client'
import {
  getLocalExecutionHostLabel,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../../shared/workspace-scope'
import type { MaestroCanvasIndexEntry } from '../../../../shared/maestro-canvas-index'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  buildMaestroNavigatorGroups,
  isMaestroRuntimeHostReachable,
  maestroNavigatorRowKey,
  type MaestroNavigatorHost,
  type MaestroNavigatorWorkspace
} from './maestro-navigator-view-model'
import { openExactMaestroWorkspace } from '@/lib/maestro-workspace-navigation'

type FetchTarget = {
  cacheKey: string
  host: MaestroNavigatorHost
  target: RuntimeClientTarget
}

const entriesByTarget = new Map<string, MaestroCanvasIndexEntry[]>()

function deduplicateEntries(
  targetEntries: Iterable<readonly MaestroCanvasIndexEntry[]>
): MaestroCanvasIndexEntry[] {
  const entries = new Map<string, MaestroCanvasIndexEntry>()
  for (const source of targetEntries) {
    for (const entry of source) {
      const key = maestroNavigatorRowKey(entry.executionHostId, entry.workspaceKey)
      const current = entries.get(key)
      if (!current || current.updatedAt < entry.updatedAt) {
        entries.set(key, entry)
      }
    }
  }
  return [...entries.values()]
}

export function useMaestroNavigator(query: string, recentKeys: readonly string[]) {
  const open = useAppStore((state) => state.maestroNavigatorOpen)
  const catalog = useAppStore(
    useShallow((state) => ({
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo,
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId
    }))
  )
  const [entries, setEntries] = useState<MaestroCanvasIndexEntry[]>(() =>
    deduplicateEntries(entriesByTarget.values())
  )
  const [loading, setLoading] = useState(false)
  const [failedHostIds, setFailedHostIds] = useState<ReadonlySet<string>>(new Set())

  const fetchTargets = useMemo<FetchTarget[]>(() => {
    const remoteTargets = catalog.runtimeEnvironments.map((environment) => ({
      cacheKey: `environment:${environment.id}`,
      host: {
        id: toRuntimeExecutionHostId(environment.id),
        label: environment.name,
        reachable: isMaestroRuntimeHostReachable(
          catalog.runtimeStatusByEnvironmentId.get(environment.id)
        )
      },
      target: { kind: 'environment', environmentId: environment.id } as const
    }))
    return [
      {
        cacheKey: 'local',
        host: { id: 'local', label: getLocalExecutionHostLabel(), reachable: true },
        target: { kind: 'local' } as const
      },
      ...remoteTargets
    ]
  }, [catalog.runtimeEnvironments, catalog.runtimeStatusByEnvironmentId])

  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    const connectedTargets = fetchTargets.filter((target) => target.host.reachable)
    setLoading(true)
    void Promise.allSettled(
      connectedTargets.map(async (target) => {
        const result = await listMaestroCanvases(target.target, controller.signal)
        entriesByTarget.set(target.cacheKey, result.entries)
        return target.host.id
      })
    ).then((results) => {
      if (controller.signal.aborted) {
        return
      }
      const failed = new Set<string>()
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed.add(connectedTargets[index].host.id)
        }
      })
      setFailedHostIds(failed)
      setEntries(deduplicateEntries(entriesByTarget.values()))
      setLoading(false)
    })
    return () => controller.abort()
  }, [fetchTargets, open])

  const hosts = useMemo<MaestroNavigatorHost[]>(() => {
    const known = new Map(
      fetchTargets.map((target) => [
        target.host.id,
        { ...target.host, reachable: target.host.reachable && !failedHostIds.has(target.host.id) }
      ])
    )
    for (const entry of entries) {
      if (!known.has(entry.executionHostId)) {
        known.set(entry.executionHostId, {
          id: entry.executionHostId,
          label: entry.executionHostId,
          reachable: !failedHostIds.has(entry.executionHostId)
        })
      }
    }
    return [...known.values()]
  }, [entries, failedHostIds, fetchTargets])

  const workspaces = useMemo<MaestroNavigatorWorkspace[]>(() => {
    const repoById = new Map(catalog.repos.map((repo) => [repo.id, repo]))
    const groupById = new Map(catalog.projectGroups.map((group) => [group.id, group]))
    const worktreeRows = Object.values(catalog.worktreesByRepo).flatMap((worktrees) =>
      worktrees.map((worktree) => {
        const repo = repoById.get(worktree.repoId)
        const hostId = getWorktreeExecutionHostId(worktree, repo)
        const project = repo?.projectGroupId ? groupById.get(repo.projectGroupId) : null
        return {
          executionHostId: hostId,
          workspaceKey: worktreeWorkspaceKey(worktree.id),
          name: worktree.displayName,
          projectId: project?.id ?? repo?.id ?? worktree.repoId,
          projectName: project?.name ?? repo?.displayName ?? worktree.repoId,
          archived: worktree.isArchived
        }
      })
    )
    const folderRows = catalog.folderWorkspaces.map((workspace) => {
      const project = groupById.get(workspace.projectGroupId)
      return {
        executionHostId:
          workspace.executionHostId ?? project?.executionHostId ?? getRepoExecutionHostId({}),
        workspaceKey: folderWorkspaceKey(workspace.id),
        name: workspace.name,
        projectId: workspace.projectGroupId,
        projectName: project?.name ?? workspace.name,
        archived: workspace.isArchived
      }
    })
    return [...worktreeRows, ...folderRows]
  }, [catalog.folderWorkspaces, catalog.projectGroups, catalog.repos, catalog.worktreesByRepo])

  const groups = useMemo(
    () => buildMaestroNavigatorGroups({ entries, hosts, workspaces, query, recentKeys }),
    [entries, hosts, query, recentKeys, workspaces]
  )
  const openWorkspace = useCallback((target: { executionHostId: string; workspaceKey: string }) => {
    const opened = openExactMaestroWorkspace(useAppStore.getState(), target)
    if (opened) {
      useAppStore.getState().setMaestroNavigatorOpen(false)
    }
    return opened
  }, [])

  return { groups, hosts, entries, loading, openWorkspace }
}
