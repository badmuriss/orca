// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeResourceHealth } from '../../../../shared/process-stats-types'
import { MaestroResourceSummary } from './MaestroResourceSummary'

afterEach(cleanup)

function health(state: RuntimeResourceHealth['state']): RuntimeResourceHealth {
  return {
    schemaVersion: 1,
    executionHostId: state === 'unverifiable' ? 'ssh:build-host' : 'local',
    workspaceKey: 'folder:workspace-a',
    state,
    reason: state === 'unverifiable' ? 'Remote host contact was lost.' : null,
    collectedAt: state === 'unverifiable' ? null : 1,
    hostMemoryUsagePercent: state === 'unverifiable' ? null : state === 'pressure' ? 91 : 42,
    inventory: {
      daemonGenerations: [],
      workerIds: ['worker-a', 'worker-b'],
      browserSurfaceIds: ['browser-a'],
      processRootPids: [101],
      rendererCount: state === 'unverifiable' ? null : 1,
      aggregateCpu: state === 'unverifiable' ? null : 12,
      aggregateMemory: state === 'unverifiable' ? null : 1_610_612_736
    }
  }
}

describe('MaestroResourceSummary', () => {
  it('never represents remote unverifiable data as zero usage', () => {
    render(<MaestroResourceSummary health={health('unverifiable')} onInspect={() => {}} />)

    expect(screen.getAllByText('Unverifiable')).toHaveLength(5)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('Remote host contact was lost.')).toBeInTheDocument()
  })
})
