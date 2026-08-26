import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'
import { useState } from 'react'
import type { MaestroRunProgressReference } from '../../../../shared/maestro-run-progress'
import { Badge } from '@/components/ui/badge'
import { CountLegend, ProgressMeter, ReferenceList, TaskList } from './MaestroRunProgressSections'
import { translate } from '@/i18n/i18n'

export function MaestroWorkspaceHarnessOverlay({
  progress,
  authorityUnavailable
}: {
  progress: MaestroRunProgress
  authorityUnavailable: boolean
}): React.JSX.Element {
  const [inspected, setInspected] = useState<MaestroRunProgressReference | null>(null)
  if (!progress.available) {
    return (
      <aside
        className={`absolute left-3 z-40 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground shadow-xs ${authorityUnavailable ? 'top-24' : 'top-14'}`}
        data-maestro-workspace-harness-overlay=""
      >
        {translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.3c305a1143',
          'Harness progress is unverifiable.'
        )}
      </aside>
    )
  }
  const summary = progress.summary
  return (
    <aside
      className={`scrollbar-sleek absolute left-3 z-40 max-h-[45%] w-80 overflow-auto rounded-lg border border-border bg-card p-3 shadow-xs ${authorityUnavailable ? 'top-24' : 'top-14'}`}
      data-maestro-workspace-harness-overlay=""
      aria-label={translate(
        'auto.components.maestro.MaestroWorkspaceHarnessOverlay.10512fc509',
        'Harness run {{value0}}',
        { value0: progress.authority.runId }
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">
          {translate('auto.components.maestro.MaestroWorkspaceHarnessOverlay.3246b484f4', 'Run')}{' '}
          {progress.authority.runId}
        </span>
        <Badge variant="outline">{summary.state}</Badge>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
        {summary.progress_percent}%
      </p>
      <ProgressMeter counts={summary.task_counts} percent={summary.progress_percent} />
      <CountLegend counts={summary.task_counts} />
      <TaskList
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.281b32e47d',
          'Active'
        )}
        tasks={summary.current_tasks}
        onInspectReference={setInspected}
      />
      <TaskList
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.37f99eccba',
          'Next'
        )}
        tasks={summary.next_tasks}
        onInspectReference={setInspected}
      />
      <ReferenceList
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.e10ca067b6',
          'Blocked'
        )}
        tone="blocked"
        references={summary.blockers}
        onInspectReference={setInspected}
      />
      <ReferenceList
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.87f572fa85',
          'Material findings'
        )}
        tone="input"
        references={summary.material_findings}
        onInspectReference={setInspected}
      />
      {inspected ? (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-[10px]">
          <p className="font-medium text-foreground">
            {translate(
              'auto.components.maestro.MaestroWorkspaceHarnessOverlay.e829b7596d',
              'Exact Harness reference'
            )}
          </p>
          <p className="mt-1 break-all font-mono text-muted-foreground">
            {progress.authority.runId}{' '}
            {translate(
              'auto.components.maestro.MaestroWorkspaceHarnessOverlay.cf7d032f54',
              '· revision'
            )}{' '}
            {progress.authority.revision}
          </p>
          <p className="mt-1 break-all font-mono text-foreground">
            {[inspected.task_id, inspected.attempt_id, inspected.finding_ref, inspected.cleanup_id]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </aside>
  )
}
