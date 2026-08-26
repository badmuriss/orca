import type {
  ProcessCommitMetric,
  ProcessMemoryMetric
} from '../../../../shared/process-stats-types'
import { translate } from '@/i18n/i18n'
import { usageTextColorClass } from './usage-roster-formatting'

export type ResourceMemoryMetricCopy = {
  columnLabel: string
  summaryLabel: string
  description: string
}

export function getResourceMemoryMetricCopy(metric: ProcessMemoryMetric): ResourceMemoryMetricCopy {
  if (metric === 'working-set') {
    return {
      columnLabel: 'WS',
      summaryLabel: 'Σ WS',
      description: translate(
        'auto.components.status.bar.resource.memory.metric.workingSetDescription',
        'Summed working set (WS): pages resident in RAM right now. Shared pages can appear in more than one process, and memory Windows has paged out is not counted here.'
      )
    }
  }
  return {
    columnLabel: 'RSS',
    summaryLabel: 'Σ RSS',
    description: translate(
      'auto.components.status.bar.resource.memory.metric.rssDescription',
      'Summed resident set size (RSS). Shared or aliased pages can appear in more than one process.'
    )
  }
}

export function getResourceCommitMetricCopy(
  _metric: ProcessCommitMetric
): ResourceMemoryMetricCopy {
  return {
    columnLabel: 'Private',
    summaryLabel: 'Σ Private',
    description: translate(
      'auto.components.status.bar.resource.memory.metric.privateBytesDescription',
      'Summed private bytes: memory these processes have committed, counted whether it is resident or paged out. This is what the host charges against its commit limit, so it keeps rising while the working set above shrinks under paging.'
    )
  }
}

/**
 * Warning tint once tracked commit approaches the host's physical RAM, and null
 * while it is unremarkable — committed bytes past RAM must come from the
 * pagefile, which is the paging the working-set figure cannot foresee.
 *
 * Returns null for an unmeasured host too: silence is the honest answer when
 * the snapshot carries no commit figure.
 */
export function getCommitPressureToneClass(args: {
  privateMemory: number | undefined
  hostTotalMemory: number
}): string | null {
  const percent = getCommitPressurePercent(args)
  if (percent === null) {
    return null
  }
  const tone = usageTextColorClass(percent)
  return tone === 'text-foreground' ? null : tone
}

/** Tracked commit as a percentage of physical RAM, or null when unmeasured. */
export function getCommitPressurePercent(args: {
  privateMemory: number | undefined
  hostTotalMemory: number
}): number | null {
  const { privateMemory, hostTotalMemory } = args
  if (typeof privateMemory !== 'number' || !Number.isFinite(privateMemory)) {
    return null
  }
  if (!Number.isFinite(hostTotalMemory) || hostTotalMemory <= 0) {
    return null
  }
  return (privateMemory / hostTotalMemory) * 100
}
