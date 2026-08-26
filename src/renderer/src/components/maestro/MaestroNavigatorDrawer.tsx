import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Network, Search, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import {
  STATUS_BAR_RESERVE_HEIGHT,
  WORKSPACE_TOP_CHROME_HEIGHT
} from '../sidebar/workspace-chrome-metrics'
import {
  maestroNavigatorRows,
  moveMaestroNavigatorSelection,
  type MaestroNavigatorRow
} from './maestro-navigator-view-model'
import { useMaestroNavigator } from './useMaestroNavigator'
import { MaestroNavigatorHostEntries } from './MaestroNavigatorEntries'

type MaestroNavigatorDrawerProps = {
  leftSidebarStyle?: React.CSSProperties
  statusBarVisible: boolean
}

export function MaestroNavigatorDrawer({
  leftSidebarStyle,
  statusBarVisible
}: MaestroNavigatorDrawerProps): React.JSX.Element {
  const open = useAppStore((state) => state.maestroNavigatorOpen)
  const setOpen = useAppStore((state) => state.setMaestroNavigatorOpen)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const activeWorkspaceKey = useAppStore((state) => state.activeWorkspaceKey)
  const activeWorkspaceExecutionHostId = useAppStore(
    (state) => state.activeWorkspaceExecutionHostId
  )
  const [query, setQuery] = useState('')
  const [recentOnly, setRecentOnly] = useState(false)
  const [recentKeys, setRecentKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const navigator = useMaestroNavigator(query, recentKeys)
  const recentKeySet = useMemo(() => new Set(recentKeys), [recentKeys])
  const groups = useMemo(
    () =>
      recentOnly
        ? navigator.groups.map((host) => ({
            ...host,
            projects: host.projects
              .map((project) => ({
                ...project,
                rows: project.rows.filter((row) => recentKeySet.has(row.key))
              }))
              .filter((project) => project.rows.length > 0)
          }))
        : navigator.groups,
    [navigator.groups, recentKeySet, recentOnly]
  )
  const rows = useMemo(() => maestroNavigatorRows(groups), [groups])

  const selectRow = useCallback(
    (row: MaestroNavigatorRow) => {
      setSelectedKey(row.key)
      if (navigator.openWorkspace(row)) {
        setRecentKeys((current) =>
          [row.key, ...current.filter((key) => key !== row.key)].slice(0, 12)
        )
      }
    },
    [navigator]
  )
  const openCurrentWorkspace = useCallback(() => {
    if (!activeWorkspaceKey || !activeWorkspaceExecutionHostId) {
      return
    }
    navigator.openWorkspace({
      executionHostId: activeWorkspaceExecutionHostId,
      workspaceKey: activeWorkspaceKey
    })
  }, [activeWorkspaceExecutionHostId, activeWorkspaceKey, navigator])
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedKey(
          moveMaestroNavigatorSelection(rows, selectedKey, event.key === 'ArrowDown' ? 1 : -1)
        )
        return
      }
      if (event.key === 'Enter') {
        const selected = rows.find((row) => row.key === selectedKey)
        if (selected?.reachable) {
          selectRow(selected)
        }
      }
    },
    [rows, selectRow, selectedKey]
  )

  const drawerLeftCss = sidebarOpen
    ? `var(--workspace-sidebar-live-width, ${sidebarWidth}px)`
    : '0px'
  const drawerBottom = `${statusBarVisible ? STATUS_BAR_RESERVE_HEIGHT : 0}px`
  const visibleRowCount = rows.length

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex w-[420px] max-w-[calc(100vw-24px)] flex-col border-r bg-worktree-sidebar p-0 sm:max-w-[420px]"
        style={{
          ...leftSidebarStyle,
          left: drawerLeftCss,
          top: WORKSPACE_TOP_CHROME_HEIGHT,
          bottom: drawerBottom,
          height: 'auto'
        }}
        onKeyDown={handleKeyDown}
        data-maestro-navigator-sheet=""
      >
        <header className="border-b px-3 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-muted-foreground" />
            <SheetTitle className="min-w-0 flex-1 text-sm font-semibold">
              {translate('auto.components.maestro.navigator.title', 'Maestro')}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setOpen(false)}
              aria-label={translate('auto.components.maestro.navigator.close', 'Close navigator')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.maestro.navigator.description',
              'Canvas summaries stay isolated by host and workspace.'
            )}
          </p>
          <div className="mt-3 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate(
                  'auto.components.maestro.navigator.search',
                  'Search Canvases'
                )}
                className="h-8 pl-7 text-xs"
                autoFocus
              />
            </div>
            <Button
              variant={recentOnly ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setRecentOnly((current) => !current)}
              aria-pressed={recentOnly}
            >
              {translate('auto.components.maestro.navigator.recent', 'Recent')}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              {navigator.loading
                ? translate('auto.components.maestro.navigator.discovering', 'Discovering hosts…')
                : translate('auto.components.maestro.navigator.count', '{{value0}} Canvases', {
                    value0: visibleRowCount
                  })}
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3" />
              <ArrowDown className="size-3" />
              {translate('auto.components.maestro.navigator.navigate', 'to navigate')}
            </span>
          </div>
          <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-3">
            {navigator.loading ? (
              <div className="flex min-h-36 items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {translate(
                  'auto.components.maestro.navigator.loading',
                  'Loading Canvas summaries…'
                )}
              </div>
            ) : visibleRowCount === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center rounded-md border border-dashed px-6 text-center">
                <Network className="size-5 text-muted-foreground" />
                <div className="mt-2 text-sm font-medium">
                  {recentOnly || query
                    ? translate(
                        'auto.components.maestro.navigator.noMatches',
                        'No matching Canvases'
                      )
                    : translate('auto.components.maestro.navigator.empty', 'No Canvases yet')}
                </div>
                <p className="mt-1 max-w-64 text-[11px] text-muted-foreground">
                  {recentOnly || query
                    ? translate(
                        'auto.components.maestro.navigator.noMatchesDetail',
                        'Clear the search or recent filter to see other workspaces.'
                      )
                    : translate(
                        'auto.components.maestro.navigator.emptyDetail',
                        'Open Maestro for this workspace to create its first isolated Canvas.'
                      )}
                </p>
                {!recentOnly && !query ? (
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={!activeWorkspaceKey || !activeWorkspaceExecutionHostId}
                    onClick={openCurrentWorkspace}
                  >
                    {translate(
                      'auto.components.maestro.navigator.createCurrent',
                      'Open Canvas here'
                    )}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <MaestroNavigatorHostEntries
                    key={group.id}
                    group={group}
                    selectedKey={selectedKey}
                    onSelect={selectRow}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
