import { AlertCircle, CheckCircle2, Clock3, Folder, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { MaestroNavigatorHostGroup, MaestroNavigatorRow } from './maestro-navigator-view-model'

function cleanupCount(row: MaestroNavigatorRow): number | null {
  if (!row.progress) {
    return null
  }
  return Object.values(row.progress.cleanup).reduce((sum, group) => sum + group.count, 0)
}

function taskCount(row: MaestroNavigatorRow): number | null {
  if (!row.progress) {
    return null
  }
  return Object.values(row.progress.task_counts).reduce((sum, count) => sum + count, 0)
}

function formatLastActivity(updatedAt: string): string {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return updatedAt
  }
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ProgressDigest({ row }: { row: MaestroNavigatorRow }): React.JSX.Element {
  if (!row.reachable) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <AlertCircle className="size-3" />
        {translate('auto.components.maestro.navigator.unavailable', 'Unavailable')}
      </span>
    )
  }
  if (row.progressUnavailable) {
    return (
      <span className="text-muted-foreground">
        {translate('auto.components.maestro.navigator.unknown', 'Progress unavailable')}
      </span>
    )
  }
  if (!row.progress) {
    return (
      <span className="text-muted-foreground">
        {translate('auto.components.maestro.navigator.noRun', 'No active run')}
      </span>
    )
  }
  const tasks = taskCount(row)
  const cleanup = cleanupCount(row)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
      <span className="inline-flex items-center gap-1 font-medium text-foreground/75">
        {row.progress.state === 'complete' ? (
          <CheckCircle2 className="size-3" />
        ) : (
          <Clock3 className="size-3" />
        )}
        {row.progress.state.replaceAll('_', ' ')} · {row.progress.progress_percent}%
      </span>
      <span>
        {translate('auto.components.maestro.navigator.tasks', '{{value0}} tasks', {
          value0: tasks ?? 0
        })}
      </span>
      <span>
        {translate('auto.components.maestro.navigator.cleanup', '{{value0}} cleanup', {
          value0: cleanup ?? 0
        })}
      </span>
    </span>
  )
}

function NavigatorRow({
  row,
  selected,
  onSelect
}: {
  row: MaestroNavigatorRow
  selected: boolean
  onSelect: (row: MaestroNavigatorRow) => void
}): React.JSX.Element {
  const WorkspaceIcon = row.workspaceKind === 'folder' ? Folder : GitBranch
  return (
    <button
      type="button"
      disabled={!row.reachable}
      onClick={() => onSelect(row)}
      className={cn(
        'group flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-ring/60 bg-accent text-accent-foreground'
          : 'border-transparent hover:border-border hover:bg-accent/50',
        !row.reachable && 'cursor-not-allowed opacity-60'
      )}
    >
      <WorkspaceIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{row.workspaceName}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            r{row.revision}
          </span>
        </span>
        <span className="mt-1 block text-[11px]">
          <ProgressDigest row={row} />
        </span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground/75">
          {formatLastActivity(row.updatedAt)}
        </span>
      </span>
    </button>
  )
}

export function MaestroNavigatorHostEntries({
  group,
  selectedKey,
  onSelect
}: {
  group: MaestroNavigatorHostGroup
  selectedKey: string | null
  onSelect: (row: MaestroNavigatorRow) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2" aria-label={group.label}>
      <div className="flex items-center gap-2 px-1">
        <span
          className={cn(
            'size-1.5 rounded-full',
            group.reachable ? 'bg-status-success' : 'bg-muted-foreground/40'
          )}
        />
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {group.label}
        </h3>
        {!group.reachable ? (
          <span className="text-[10px] text-muted-foreground">
            {translate('auto.components.maestro.navigator.offline', 'Offline')}
          </span>
        ) : null}
      </div>
      {group.projects.map((project) => (
        <div key={project.id} className="space-y-1">
          <div className="px-1 text-[11px] font-medium text-foreground/60">{project.label}</div>
          {project.rows.map((row) => (
            <NavigatorRow
              key={row.key}
              row={row}
              selected={selectedKey === row.key}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
      {!group.reachable && group.projects.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          {translate(
            'auto.components.maestro.navigator.offlineDetail',
            'Saved Canvases stay unavailable until this host reconnects.'
          )}
        </div>
      ) : null}
    </section>
  )
}
