import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import type {
  MaestroRunProgressReference,
  MaestroRunProgressState,
  MaestroRunProgressSummary,
  MaestroRunProgressTaskReference
} from '../../../../shared/maestro-run-progress'
import { MaestroStatePip } from './MaestroWindowFrame'
import {
  MAESTRO_STATE_COLOR,
  maestroStateTone,
  type MaestroStateTone
} from './maestro-window-model'
import { translate } from '@/i18n/i18n'

type TaskCountKey = keyof MaestroRunProgressSummary['task_counts']

/** Meter order reads as a pipeline: settled work first, unstarted work last. */
const TASK_COUNT_ORDER: readonly {
  key: TaskCountKey
  label: () => string
  tone: MaestroStateTone
}[] = [
  {
    key: 'approved',
    label: () => translate('auto.components.maestro.MaestroRunProgressSections.1cc17146bb', 'Done'),
    tone: 'settled'
  },
  {
    key: 'running',
    label: () =>
      translate('auto.components.maestro.MaestroRunProgressSections.23dda8f5bd', 'Running'),
    tone: 'running'
  },
  {
    key: 'input_required',
    label: () =>
      translate('auto.components.maestro.MaestroRunProgressSections.48c2389c39', 'Input'),
    tone: 'input'
  },
  {
    key: 'blocked',
    label: () =>
      translate('auto.components.maestro.MaestroRunProgressSections.ad65ccc061', 'Blocked'),
    tone: 'blocked'
  },
  {
    key: 'failed',
    label: () =>
      translate('auto.components.maestro.MaestroRunProgressSections.c9930a1fc2', 'Failed'),
    tone: 'blocked'
  },
  {
    key: 'pending',
    label: () =>
      translate('auto.components.maestro.MaestroRunProgressSections.866b7f329f', 'Pending'),
    tone: 'pending'
  }
]

/** Translated at call time: a module-level translate() would resolve before i18n loads. */
function taskCounts(): { key: TaskCountKey; label: string; tone: MaestroStateTone }[] {
  return TASK_COUNT_ORDER.map((entry) => ({
    key: entry.key,
    label: entry.label(),
    tone: entry.tone
  }))
}

export function stateIcon(state: MaestroRunProgressState): React.JSX.Element {
  if (state === 'complete') {
    return <CircleCheck className="size-3.5" aria-hidden />
  }
  if (state === 'failed' || state === 'blocked') {
    return <CircleX className="size-3.5 text-destructive" aria-hidden />
  }
  if (state === 'input_required' || state === 'partial' || state === 'outcome_unknown') {
    return <CircleAlert className="size-3.5 text-muted-foreground" aria-hidden />
  }
  return <LoaderCircle className="size-3.5" aria-hidden />
}

function taskReference(task: MaestroRunProgressTaskReference): MaestroRunProgressReference {
  return {
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    finding_ref: null,
    cleanup_id: null
  }
}

function taskLabel(task: MaestroRunProgressTaskReference): string {
  return task.attempt_id ? `${task.task_id} · ${task.attempt_id}` : task.task_id
}

function referenceLabel(reference: MaestroRunProgressReference): string {
  const values = [
    reference.task_id,
    reference.attempt_id,
    reference.finding_ref,
    reference.cleanup_id
  ].filter((value): value is string => value !== null)
  return values.join(' · ') || 'Unknown reference'
}

export function SectionHeading({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] text-muted-foreground">
      {children}
    </p>
  )
}

/** One row grammar for every identity list, so the eye learns it once. */
export function IdentityRow({
  label,
  tone,
  trailing,
  onSelect
}: {
  label: string
  tone: MaestroStateTone
  trailing?: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[11px] leading-4 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MaestroStatePip tone={tone} />
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">{trailing}</span>
      ) : null}
    </button>
  )
}

export function ProgressMeter({
  counts,
  percent
}: {
  counts: MaestroRunProgressSummary['task_counts']
  percent: number
}): React.JSX.Element {
  const rows = taskCounts()
  const total = rows.reduce((sum, entry) => sum + counts[entry.key], 0)
  // role="img" replaces the children for a screen reader, so the counts live in the label.
  const spoken = rows
    .filter((entry) => counts[entry.key] > 0)
    .map((entry) => `${counts[entry.key]} ${entry.label.toLowerCase()}`)
    .join(', ')
  return (
    <div
      className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={translate(
        'auto.components.maestro.MaestroRunProgressSections.4e2a49a36b',
        'Run progress {{value0}}%{{value1}}',
        { value0: percent, value1: spoken ? `: ${spoken}` : '' }
      )}
    >
      {total === 0
        ? null
        : rows
            .filter((entry) => counts[entry.key] > 0)
            .map((entry) => (
              <span
                key={entry.key}
                className="h-full"
                style={{
                  width: `${(counts[entry.key] / total) * 100}%`,
                  background: MAESTRO_STATE_COLOR[entry.tone]
                }}
              />
            ))}
    </div>
  )
}

export function CountLegend({
  counts
}: {
  counts: MaestroRunProgressSummary['task_counts']
}): React.JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {taskCounts().map((entry) => {
        const value = counts[entry.key]
        return (
          <span
            key={entry.key}
            className={`flex items-center gap-1 text-[10px] leading-4 ${value > 0 ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: value > 0 ? MAESTRO_STATE_COLOR[entry.tone] : 'var(--border)'
              }}
              aria-hidden
            />
            <b className="font-semibold tabular-nums">{value}</b>
            {entry.label}
          </span>
        )
      })}
    </div>
  )
}

export function ReferenceList({
  label,
  tone,
  references,
  onInspectReference
}: {
  label: string
  tone: MaestroStateTone
  references: readonly MaestroRunProgressReference[]
  onInspectReference: (reference: MaestroRunProgressReference) => void
}): React.JSX.Element | null {
  if (!references.length) {
    return null
  }
  return (
    <section className="mt-3" aria-label={label}>
      <SectionHeading>{label}</SectionHeading>
      <div className="mt-1 space-y-0.5">
        {references.map((reference, index) => (
          <IdentityRow
            key={`${referenceLabel(reference)}-${index}`}
            label={referenceLabel(reference)}
            tone={tone}
            onSelect={() => onInspectReference(reference)}
          />
        ))}
      </div>
    </section>
  )
}

export function TaskList({
  label,
  tasks,
  onInspectReference
}: {
  label: string
  tasks: readonly MaestroRunProgressTaskReference[]
  onInspectReference: (reference: MaestroRunProgressReference) => void
}): React.JSX.Element | null {
  if (!tasks.length) {
    return null
  }
  return (
    <section className="mt-3" aria-label={label}>
      <SectionHeading>{label}</SectionHeading>
      <div className="mt-1 space-y-0.5">
        {tasks.map((task) => (
          <IdentityRow
            key={`${task.task_id}-${task.attempt_id ?? 'task'}`}
            label={taskLabel(task)}
            tone={maestroStateTone(task.status)}
            trailing={task.status}
            onSelect={() => onInspectReference(taskReference(task))}
          />
        ))}
      </div>
    </section>
  )
}
