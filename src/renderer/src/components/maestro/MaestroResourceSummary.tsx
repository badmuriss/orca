import {
  Activity,
  CircleAlert,
  CircleHelp,
  Globe2,
  Search,
  Server,
  TerminalSquare
} from 'lucide-react'
import type { RuntimeResourceHealth } from '../../../../shared/process-stats-types'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type Props = {
  health: RuntimeResourceHealth
  onInspect: () => void
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'Unverifiable'
  }
  if (bytes < 1024 ** 2) {
    return `${Math.round(bytes / 1024)} KB`
  }
  if (bytes < 1024 ** 3) {
    return `${Math.round(bytes / 1024 ** 2)} MB`
  }
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function statusPresentation(state: RuntimeResourceHealth['state']): {
  label: string
  Icon: typeof Activity
  className: string
} {
  if (state === 'pressure') {
    return {
      label: translate(
        'auto.components.maestro.MaestroResourceSummary.c0fef126d7',
        'Resource pressure'
      ),
      Icon: CircleAlert,
      className: 'text-destructive'
    }
  }
  if (state === 'unverifiable') {
    return {
      label: translate('auto.components.maestro.MaestroResourceSummary.27e7fddd87', 'Unverifiable'),
      Icon: CircleHelp,
      className: 'text-muted-foreground'
    }
  }
  return {
    label: translate(
      'auto.components.maestro.MaestroResourceSummary.34bb881d47',
      'Resources normal'
    ),
    Icon: Activity,
    className: 'text-foreground'
  }
}

export function MaestroResourceSummary({ health, onInspect }: Props): React.JSX.Element {
  const status = statusPresentation(health.state)
  const unavailable = health.state === 'unverifiable'
  const value = (measured: string | number): string =>
    unavailable ? 'Unverifiable' : String(measured)
  const metrics = [
    {
      label: translate('auto.components.maestro.MaestroResourceSummary.4a4811e97a', 'Memory'),
      value: value(formatBytes(health.inventory.aggregateMemory)),
      detail: unavailable
        ? 'Host unavailable'
        : `${Math.round(health.hostMemoryUsagePercent ?? 0)}% host`,
      Icon: Activity
    },
    {
      label: translate('auto.components.maestro.MaestroResourceSummary.d0721ab875', 'Daemons'),
      value: value(health.inventory.daemonGenerations.length),
      detail: unavailable ? 'Generations unknown' : 'Exact generations',
      Icon: Server
    },
    {
      label: translate('auto.components.maestro.MaestroResourceSummary.3e2cb0c38d', 'Workers'),
      value: value(health.inventory.workerIds.length),
      detail: unavailable ? 'Ownership unknown' : 'Owned resources',
      Icon: TerminalSquare
    },
    {
      label: translate('auto.components.maestro.MaestroResourceSummary.7cf52666f9', 'Browser'),
      value: value(health.inventory.browserSurfaceIds.length),
      detail: unavailable ? 'Pages unknown' : 'Managed pages',
      Icon: Globe2
    }
  ]
  return (
    <section
      className="w-full rounded-md border border-border bg-card shadow-xs"
      aria-label={translate(
        'auto.components.maestro.MaestroResourceSummary.09d91661fe',
        'Maestro resource health'
      )}
      data-maestro-resource-summary={health.state}
    >
      <header className="flex min-h-10 items-center gap-3 border-b border-border px-3 py-2">
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium ${status.className}`}
        >
          <status.Icon className="size-3.5 shrink-0" aria-hidden />
          <span>{status.label}</span>
          <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">
            {health.executionHostId}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2"
          onClick={onInspect}
        >
          <Search className="size-3.5" aria-hidden />
          {translate(
            'auto.components.maestro.MaestroResourceSummary.14df314a05',
            'Inspect resources'
          )}
        </Button>
      </header>
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        {metrics.map(({ label, value: metricValue, detail, Icon }) => (
          <div key={label} className="min-w-0 px-3 py-2">
            <span className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted-foreground">
              <Icon className="size-3 shrink-0" aria-hidden />
              {label}
            </span>
            <span
              className="mt-0.5 block truncate text-sm font-medium tabular-nums"
              title={metricValue}
            >
              {metricValue}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground" title={detail}>
              {detail}
            </span>
          </div>
        ))}
      </div>
      {health.reason ? (
        <p className="border-t border-border px-3 py-1.5 text-[10px] leading-4 text-muted-foreground">
          {health.reason}
        </p>
      ) : null}
    </section>
  )
}
