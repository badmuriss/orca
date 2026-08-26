import type { RefCallback } from 'react'
import { Gauge } from 'lucide-react'
import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import type { MaestroCanvasNode } from './MaestroCanvas'
import {
  MaestroStatusPill,
  MaestroWindowChrome,
  MaestroWindowFoot,
  maestroWindowRootProps
} from './MaestroWindowFrame'
import { maestroStateTone } from './maestro-window-model'
import {
  CountLegend,
  ProgressMeter,
  ReferenceList,
  stateIcon,
  TaskList
} from './MaestroRunProgressSections'
import { CleanupLists, CoordinationSection } from './MaestroRunProgressDetails'
import { translate } from '@/i18n/i18n'

type MaestroRunProgressCardProps = {
  node: MaestroCanvasNode
  selected: boolean
  nodeRef: RefCallback<HTMLDivElement>
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onInspectReference: (identity: MaestroRunProgressDetailIdentity) => void
}

export function MaestroRunProgressCard({
  node,
  selected,
  nodeRef,
  onClick,
  onPointerDown,
  onKeyDown,
  onInspectReference
}: MaestroRunProgressCardProps): React.JSX.Element {
  const progress = node.runProgress
  const state = progress?.available ? progress.summary.state : 'outcome_unknown'
  const rootProps = {
    ...maestroWindowRootProps({ selected, reducedMotion: false }),
    ref: nodeRef,
    tabIndex: 0,
    onClick,
    onPointerDown,
    onKeyDown
  }

  if (!progress?.available) {
    return (
      <div
        {...rootProps}
        aria-label={translate(
          'auto.components.maestro.MaestroRunProgressCard.227ced42eb',
          'Run {{value0}}: outcome_unknown',
          { value0: node.summary }
        )}
      >
        <MaestroWindowChrome
          icon={stateIcon(state)}
          title={translate(
            'auto.components.maestro.MaestroRunProgressCard.12ccc97e23',
            'Run progress'
          )}
          trailing={<MaestroStatusPill label={state} tone="unknown" />}
        />
        <div className="maestro-window-body items-center justify-center gap-2 px-6 text-center">
          <Gauge className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-balance text-[12px] leading-5 text-muted-foreground">
            {translate(
              'auto.components.maestro.MaestroRunProgressCard.9b8a4ac64d',
              'Harness run progress is unavailable for this peer revision.'
            )}
          </p>
        </div>
        <MaestroWindowFoot typeLabel="Run" detail={node.summary} />
      </div>
    )
  }

  const summary = progress.summary
  return (
    <div
      {...rootProps}
      aria-label={translate(
        'auto.components.maestro.MaestroRunProgressCard.5f0a1c73b2',
        'Run {{value0}}: {{value1}}',
        { value0: node.summary, value1: summary.state }
      )}
    >
      <MaestroWindowChrome
        icon={stateIcon(summary.state)}
        title={translate(
          'auto.components.maestro.MaestroRunProgressCard.12ccc97e23',
          'Run progress'
        )}
        trailing={
          <MaestroStatusPill label={summary.state} tone={maestroStateTone(summary.state)} />
        }
      />
      <div className="maestro-window-body">
        {/* Headline: how far along, in one glance, before any list. */}
        <div className="shrink-0 border-b border-border px-3 pb-2.5 pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground"
              data-maestro-progress-percent={summary.progress_percent}
            >
              {summary.progress_percent}%
            </span>
            {summary.last_activity ? (
              <span
                className="min-w-0 truncate text-[10px] leading-4 text-muted-foreground"
                title={`${summary.last_activity.type} · ${summary.last_activity.timestamp}`}
              >
                {summary.last_activity.type}
              </span>
            ) : null}
          </div>
          <ProgressMeter counts={summary.task_counts} percent={summary.progress_percent} />
          <CountLegend counts={summary.task_counts} />
        </div>
        {/* The fade tells the operator the list continues past the window edge. */}
        <div className="maestro-scroll-fade scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <TaskList
            label={translate('auto.components.maestro.MaestroRunProgressCard.91fed35a6b', 'Now')}
            tasks={summary.current_tasks}
            onInspectReference={(reference) =>
              onInspectReference({ authority: progress.authority, reference })
            }
          />
          <TaskList
            label={translate('auto.components.maestro.MaestroRunProgressCard.73465740fa', 'Next')}
            tasks={summary.next_tasks}
            onInspectReference={(reference) =>
              onInspectReference({ authority: progress.authority, reference })
            }
          />
          <ReferenceList
            label={translate(
              'auto.components.maestro.MaestroRunProgressCard.80618689c6',
              'Blockers'
            )}
            tone="blocked"
            references={summary.blockers}
            onInspectReference={(reference) =>
              onInspectReference({ authority: progress.authority, reference })
            }
          />
          <ReferenceList
            label={translate(
              'auto.components.maestro.MaestroRunProgressCard.009bdbeb88',
              'Material findings'
            )}
            tone="input"
            references={summary.material_findings}
            onInspectReference={(reference) =>
              onInspectReference({ authority: progress.authority, reference })
            }
          />
          <CleanupLists
            cleanup={summary.cleanup}
            onInspectReference={(reference) =>
              onInspectReference({ authority: progress.authority, reference })
            }
          />
          {summary.coordination ? (
            <CoordinationSection coordination={summary.coordination} />
          ) : null}
        </div>
      </div>
      <MaestroWindowFoot typeLabel="Run" detail={node.summary} />
    </div>
  )
}
