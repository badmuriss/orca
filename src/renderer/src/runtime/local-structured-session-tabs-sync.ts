import { useEffect } from 'react'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { useAppStore } from '../store'
import { applyWebSessionTabsSnapshot, applyWebSessionTabsStorePatch } from './web-session-tabs-sync'
import { resolveStructuredTuiHandoffBinding } from './web-structured-tui-handoff'

export const LOCAL_STRUCTURED_SESSION_OWNER = 'local-structured-session'
let localStructuredSessionTabsRestorePromise: Promise<void> | null = null

type SessionTabsEvent =
  | (RuntimeMobileSessionTabsResult & { type: 'snapshot' | 'updated' })
  | { type: 'snapshots'; snapshots: RuntimeMobileSessionTabsResult[] }
  | { type: 'end' }

export function projectLocalStructuredSessionTabs(
  snapshot: RuntimeMobileSessionTabsResult
): RuntimeMobileSessionTabsResult {
  const structuredIds = new Set(
    snapshot.tabs.filter((tab) => tab.type === 'agent-session').map((tab) => tab.id)
  )
  const handoffTerminalIds = new Set(
    snapshot.tabs
      .filter((tab) => tab.type === 'terminal')
      .filter((tab) =>
        resolveStructuredTuiHandoffBinding({
          environmentId: LOCAL_STRUCTURED_SESSION_OWNER,
          worktreeId: snapshot.worktree,
          hostTabId: tab.parentTabId
        })
      )
      .map((tab) => tab.id)
  )
  const handoffTerminalTabs = snapshot.tabs.filter(
    (tab): tab is Extract<(typeof snapshot.tabs)[number], { type: 'terminal' }> =>
      tab.type === 'terminal' && handoffTerminalIds.has(tab.id)
  )
  const visibleHostTabIds = new Set([
    ...structuredIds,
    ...handoffTerminalTabs.map((tab) => tab.parentTabId)
  ])
  const visibleIds = new Set([...structuredIds, ...handoffTerminalIds])
  const activeHandoffTerminal = handoffTerminalTabs.find(
    (tab) =>
      tab.id === snapshot.activeTabId ||
      tab.parentTabId === snapshot.activeTabId ||
      tab.isActive === true
  )
  let projectedTabGroups = snapshot.tabGroups
    ?.map((group) => ({
      ...group,
      tabOrder: group.tabOrder.filter((id) => visibleHostTabIds.has(id)),
      activeTabId:
        group.activeTabId && visibleHostTabIds.has(group.activeTabId) ? group.activeTabId : null,
      recentTabIds: group.recentTabIds?.filter((id) => visibleHostTabIds.has(id))
    }))
    .filter((group) => group.tabOrder.length > 0)

  let activeTabId = snapshot.activeTabId
  let activeTabType = snapshot.activeTabType
  let activeGroupId = snapshot.activeGroupId
  if (activeHandoffTerminal) {
    const hostTabId = activeHandoffTerminal.parentTabId
    const containingGroupIndex =
      projectedTabGroups?.findIndex(
        (group) => group.tabOrder.includes(hostTabId) || group.activeTabId === hostTabId
      ) ?? -1
    const fallbackGroupIndex =
      containingGroupIndex >= 0
        ? containingGroupIndex
        : (projectedTabGroups?.findIndex(
            (group) =>
              (snapshot.activeTabId !== null && group.tabOrder.includes(snapshot.activeTabId)) ||
              (snapshot.activeTabId !== null && group.activeTabId === snapshot.activeTabId)
          ) ?? -1)
    if (fallbackGroupIndex >= 0 && projectedTabGroups) {
      projectedTabGroups = projectedTabGroups.map((group, index) => {
        if (index !== fallbackGroupIndex || group.tabOrder.includes(hostTabId)) {
          return index === fallbackGroupIndex && group.activeTabId !== hostTabId
            ? { ...group, activeTabId: hostTabId }
            : group
        }
        return {
          ...group,
          tabOrder: [...group.tabOrder, hostTabId],
          activeTabId: hostTabId
        }
      })
      activeGroupId = projectedTabGroups[fallbackGroupIndex]?.id ?? activeGroupId
    }
    activeTabId = activeHandoffTerminal.id
    activeTabType = 'terminal'
  }
  return {
    ...snapshot,
    activeTabId,
    activeTabType,
    activeGroupId,
    tabs: snapshot.tabs.filter((tab) => visibleIds.has(tab.id)),
    tabGroups: projectedTabGroups,
    // Why: group membership locates chats; the renderer's split tree remains locally authoritative.
    tabGroupLayout: undefined
  }
}

export function applyStructuredSessionTabSnapshots(
  snapshots: readonly RuntimeMobileSessionTabsResult[],
  owner = LOCAL_STRUCTURED_SESSION_OWNER
): void {
  const settleStructuredSessionMirror = applyWebSessionTabsStorePatch(
    (state) => {
      let next = state
      for (const snapshot of snapshots) {
        const patch = applyWebSessionTabsSnapshot(
          next,
          projectLocalStructuredSessionTabs(snapshot),
          owner,
          Date.now(),
          { preserveLocalLayout: true, terminalPtyMode: 'local' }
        )
        next = patch === next ? next : ({ ...next, ...patch } as typeof state)
      }
      return next
    },
    { frames: [] }
  )
  settleStructuredSessionMirror()
}

export function restoreLocalStructuredSessionTabsOnce(): Promise<void> {
  localStructuredSessionTabsRestorePromise ??= window.api.runtime
    .call({ method: 'session.tabs.listAll', params: {} })
    .then((response) => {
      if (!response.ok) {
        throw new Error('structured session inventory unavailable')
      }
      const result = response.result as { snapshots?: RuntimeMobileSessionTabsResult[] }
      applyStructuredSessionTabSnapshots(result.snapshots ?? [])
    })
    .catch((error) => {
      localStructuredSessionTabsRestorePromise = null
      throw error
    })
  return localStructuredSessionTabsRestorePromise
}

async function startLocalStructuredSessionTabsSync(args: {
  isDisposed: () => boolean
  setUnsubscribe: (unsubscribe: () => void) => void
}): Promise<void> {
  const status = await window.api.runtime.getStatus()
  if (args.isDisposed()) {
    return
  }
  const supported = status.capabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
  await restoreLocalStructuredSessionTabsOnce()
  if (args.isDisposed()) {
    return
  }
  if (!supported) {
    return
  }
  const handle = await window.api.runtime.subscribe(
    { method: 'session.tabs.subscribeAll', params: {} },
    (response) => {
      if (args.isDisposed() || !response.ok) {
        return
      }
      const event = response.result as SessionTabsEvent
      if (event.type === 'snapshots') {
        applyStructuredSessionTabSnapshots(event.snapshots)
      } else if (event.type === 'snapshot' || event.type === 'updated') {
        applyStructuredSessionTabSnapshots([event])
      }
    }
  )
  if (args.isDisposed()) {
    handle.unsubscribe()
  } else {
    args.setUnsubscribe(handle.unsubscribe)
  }
}

export function useLocalStructuredSessionTabsSync(): void {
  const ready = useAppStore(
    (state) => state.workspaceSessionReady && state.terminalStartupRestorationReady
  )
  useEffect(() => {
    if (!ready) {
      return
    }
    let disposed = false
    let unsubscribe = (): void => {}
    void startLocalStructuredSessionTabsSync({
      isDisposed: () => disposed,
      setUnsubscribe: (next) => {
        unsubscribe = next
      }
    }).catch((error) => console.warn('[structured-session-tabs] sync failed', error))
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [ready])
}
