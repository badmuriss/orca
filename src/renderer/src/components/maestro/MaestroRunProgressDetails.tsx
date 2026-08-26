import type {
  MaestroRunProgressCoordination,
  MaestroRunProgressReference,
  MaestroRunProgressSummary
} from '../../../../shared/maestro-run-progress'
import { translate } from '@/i18n/i18n'
import { IdentityRow, SectionHeading } from './MaestroRunProgressSections'

const CLEANUP_LABELS = [
  ['Pending cleanup', 'pending'],
  ['Unverifiable cleanup', 'unverifiable'],
  ['Failed cleanup', 'failed'],
  ['Retained cleanup', 'retained']
] as const

export function CleanupLists({
  cleanup,
  onInspectReference
}: {
  cleanup: MaestroRunProgressSummary['cleanup']
  onInspectReference: (reference: MaestroRunProgressReference) => void
}): React.JSX.Element | null {
  if (CLEANUP_LABELS.every(([, key]) => cleanup[key].count === 0)) {
    return null
  }
  return (
    <section
      className="mt-3"
      aria-label={translate(
        'auto.components.maestro.MaestroRunProgressSections.a8684d065b',
        'Cleanup'
      )}
    >
      <SectionHeading>
        {translate('auto.components.maestro.MaestroRunProgressSections.a8684d065b', 'Cleanup')}
      </SectionHeading>
      <div className="mt-1 space-y-1.5">
        {CLEANUP_LABELS.map(([label, key]) => {
          const group = cleanup[key]
          if (group.count === 0) {
            return null
          }
          return (
            <div key={key}>
              <p className="text-[10px] leading-4 text-muted-foreground">
                {label} {group.count}
                {group.truncated ? '+' : ''}
              </p>
              <div className="space-y-0.5">
                {group.ids.map((cleanupId) => (
                  <IdentityRow
                    key={cleanupId}
                    label={cleanupId}
                    tone={key === 'failed' ? 'blocked' : 'pending'}
                    onSelect={() =>
                      onInspectReference({
                        task_id: null,
                        attempt_id: null,
                        finding_ref: null,
                        cleanup_id: cleanupId
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function coordinationValue(value: number | 'unavailable'): string {
  return value === 'unavailable' ? value : `${value}ms`
}

export function CoordinationSection({
  coordination
}: {
  coordination: MaestroRunProgressCoordination
}): React.JSX.Element {
  const label = (key: string, fallback: string) =>
    translate(`auto.components.maestro.MaestroRunProgressSections.${key}`, fallback)
  return (
    <section
      className="mt-3 border-t border-border pt-2"
      aria-label={label('23648fe872', 'Coordination')}
    >
      <SectionHeading>{label('23648fe872', 'Coordination')}</SectionHeading>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4 text-muted-foreground">
        <span>
          {label('f62113aebd', 'Mode')}{' '}
          <b className="font-medium text-foreground">{coordination.execution_mode}</b>
        </span>
        <span>
          {label('99f4a74105', 'Dispatches')}{' '}
          <b className="font-medium text-foreground">{coordination.dispatch_count}</b>
        </span>
        <span>
          {label('4746760469', 'Implementation')}{' '}
          <b className="font-medium tabular-nums text-foreground">
            {coordinationValue(coordination.implementation_wall_time_ms)}
          </b>
        </span>
        <span>
          {label('c7814962cc', 'Check')}{' '}
          <b className="font-medium tabular-nums text-foreground">
            {coordinationValue(coordination.check_wall_time_ms)}
          </b>
        </span>
        <span>
          {label('d33a9d44cc', 'Worker wait')}{' '}
          <b className="font-medium tabular-nums text-foreground">
            {coordinationValue(coordination.coordinator_wait_for_worker_wall_time_ms)}
          </b>
        </span>
        <span>
          {label('0fea6f352a', 'Audit')}{' '}
          <b className="font-medium tabular-nums text-foreground">
            {coordinationValue(coordination.audit_wall_time_ms)}
          </b>
        </span>
        <span>
          {label('966711c7fa', 'Start failures')}{' '}
          <b className="font-medium text-foreground">{coordination.operational_start_failures}</b>
        </span>
        <span>
          {label('cc260e8bf2', 'Attempts')}{' '}
          <b className="font-medium text-foreground">{coordination.technical_attempts}</b>
        </span>
        <span>
          {label('1cc17146bb', 'Done')}{' '}
          <b className="font-medium text-foreground">{coordination.approved_tasks}</b>
        </span>
        <span>
          {label('1daad2527a', 'Blocking findings')}{' '}
          <b className="font-medium text-foreground">{coordination.blocking_findings}</b>
        </span>
        <span>
          {label('7b11de96b6', 'Carry-forward')}{' '}
          <b className="font-medium text-foreground">{coordination.carry_forward_findings}</b>
        </span>
        <span>
          {label('61a0381a43', 'Tokens/cache')}{' '}
          <b className="font-medium text-foreground">{coordination.token_input}</b>
        </span>
      </div>
      {coordination.latest_transition_reason ? (
        <p
          className="mt-1.5 truncate text-[10px] leading-4 text-muted-foreground"
          title={coordination.latest_transition_reason}
        >
          {coordination.latest_transition_reason}
        </p>
      ) : null}
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
        {label('6d3c6821de', 'Durations are diagnostic, not a score.')}
      </p>
    </section>
  )
}
