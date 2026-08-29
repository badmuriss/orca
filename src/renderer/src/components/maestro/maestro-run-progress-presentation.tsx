import { ChevronDown, EyeOff, Maximize2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  MaestroRunProgress,
  MaestroRunProgressReference,
  MaestroRunProgressV2
} from '../../../../shared/maestro-run-progress'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { RunProgressSection, type MaestroRunProgressRow } from './MaestroRunProgressSections'

export type MaestroRunProgressPresentation = MaestroRunProgress | MaestroRunProgressV2

export const V2_STATE_LABELS: Record<MaestroRunProgressV2['execution']['state'], () => string> = {
  active: () =>
    translate('auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateActive', 'Running'),
  input_required: () =>
    translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateInputRequired',
      'Input required'
    ),
  blocked: () =>
    translate('auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateBlocked', 'Blocked'),
  completed: () =>
    translate('auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateCompleted', 'Completed'),
  completed_with_failures: () =>
    translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateCompletedWithFailures',
      'Completed with failures'
    ),
  cancelled: () =>
    translate('auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateCancelled', 'Cancelled'),
  outcome_unknown: () =>
    translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateOutcomeUnknown',
      'Outcome unknown'
    )
}

export function isMaestroRunProgressV2(
  progress: MaestroRunProgressPresentation
): progress is MaestroRunProgressV2 {
  return 'schema_version' in progress && progress.schema_version === 2
}

export function availableLegacyRunProgress(
  progress: MaestroRunProgressPresentation
): Extract<MaestroRunProgress, { available: true }> | null {
  return 'available' in progress && progress.available ? progress : null
}

export function legacyStateLabel(
  progress: Extract<MaestroRunProgress, { available: true }>
): string {
  const state = progress.summary.state
  const labels: Record<typeof state, string> = {
    active: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateActive',
      'Running'
    ),
    input_required: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateInputRequired',
      'Input required'
    ),
    blocked: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateBlocked',
      'Blocked'
    ),
    partial: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateInProgress',
      'In progress'
    ),
    complete: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateCompleted',
      'Completed'
    ),
    failed: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateFailed',
      'Failed'
    ),
    outcome_unknown: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.stateOutcomeUnknown',
      'Outcome unknown'
    )
  }
  return labels[state]
}

export function humanProgressRows(progress: MaestroRunProgressV2): {
  current: MaestroRunProgressRow[]
  recent: MaestroRunProgressRow[]
  blocked: MaestroRunProgressRow[]
  next: MaestroRunProgressRow[]
  nested: MaestroRunProgressRow[]
} {
  return {
    current: progress.current.map((entry) => ({
      key: `current:${entry.reference}`,
      reference: entry.reference,
      title: entry.title,
      workerLabel: entry.worker_label,
      detail: entry.activity_summary,
      state: entry.state
    })),
    recent: progress.recently_completed.map((entry) => ({
      key: `recent:${entry.reference}`,
      reference: entry.reference,
      title: entry.title,
      workerLabel: entry.worker_label,
      detail: entry.outcome_summary,
      state: 'completed'
    })),
    blocked: progress.blocked.map((entry) => ({
      key: `blocked:${entry.reference}`,
      reference: entry.reference,
      title: entry.title,
      workerLabel: entry.worker_label,
      detail: entry.blocker_summary,
      state: 'blocked'
    })),
    next: progress.next.map((entry) => ({
      key: `next:${entry.reference}`,
      reference: entry.reference,
      title: entry.title,
      workerLabel: entry.worker_label,
      detail: entry.next_step,
      state: 'pending'
    })),
    nested: progress.nested_activity.map((entry) => ({
      key: `nested:${entry.child_id}`,
      reference: entry.parent_reference,
      title: entry.label,
      detail:
        entry.activity_summary ??
        translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.nativeChildActivity',
          'Native child activity'
        ),
      state: entry.state,
      meta: entry.model
    }))
  }
}

export function RunPanelControl({
  label,
  icon,
  onClick
}: {
  label: string
  icon: ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={label} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export const RUN_PANEL_ICONS = {
  compact: <ChevronDown />,
  expand: <Maximize2 />,
  hide: <EyeOff />
}

function legacyReferenceValue(reference: MaestroRunProgressReference): string {
  return [reference.task_id, reference.attempt_id, reference.finding_ref, reference.cleanup_id]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}

export function LegacyRunProgressSections({
  progress,
  onActivate
}: {
  progress: Extract<MaestroRunProgress, { available: true }>
  onActivate: (reference: string) => void
}): React.JSX.Element {
  const taskRows = [...progress.summary.current_tasks, ...progress.summary.next_tasks].map(
    (task, index): MaestroRunProgressRow => ({
      key: `${task.task_id}:${task.attempt_id ?? ''}`,
      reference: task.task_id,
      title: translate(
        'auto.components.maestro.MaestroWorkspaceHarnessOverlay.legacyTask',
        'Task {{value0}}',
        { value0: index + 1 }
      ),
      detail: translate(
        'auto.components.maestro.MaestroWorkspaceHarnessOverlay.legacyTaskDetail',
        'Detailed activity is unavailable from this peer.'
      ),
      state: task.status
    })
  )
  const blockedRows = progress.summary.blockers.map((reference, index) => ({
    key: `blocked:${index}`,
    reference: reference.task_id ?? legacyReferenceValue(reference),
    title: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.legacyBlockedItem',
      'Blocked item {{value0}}',
      { value0: index + 1 }
    ),
    detail: translate(
      'auto.components.maestro.MaestroWorkspaceHarnessOverlay.legacyBlockedDetail',
      'The older peer did not provide a human blocker summary.'
    ),
    state: 'blocked'
  }))
  return (
    <>
      <RunProgressSection
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.legacyProgress',
          'Legacy progress'
        )}
        rows={taskRows}
        onActivate={onActivate}
      />
      <RunProgressSection
        label={translate(
          'auto.components.maestro.MaestroWorkspaceHarnessOverlay.blockers',
          'Blocked'
        )}
        rows={blockedRows}
        onActivate={onActivate}
      />
    </>
  )
}
