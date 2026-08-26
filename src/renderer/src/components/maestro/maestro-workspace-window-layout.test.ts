import { describe, expect, it } from 'vitest'
import {
  addedMaestroSurfaceKeys,
  createMaestroSurfaceAdditionTracker
} from './maestro-workspace-window-layout'

describe('Maestro workspace window layout', () => {
  it('returns only newly materialized surfaces after the initial snapshot', () => {
    expect(addedMaestroSurfaceKeys(['terminal'], ['browser', 'terminal'])).toEqual(['browser'])
    expect(addedMaestroSurfaceKeys(['browser', 'terminal'], ['browser', 'terminal'])).toEqual([])
  })

  it('tracks additions across Canvas remounts without treating the first snapshot as new', () => {
    const tracker = createMaestroSurfaceAdditionTracker()

    expect(tracker.observe('local:workspace', ['terminal'])).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'])).toEqual(['browser'])
    expect(tracker.observe('remote:workspace', ['content'])).toEqual([])
  })

  it('defers consuming additions until the Canvas viewport is measurable', () => {
    const tracker = createMaestroSurfaceAdditionTracker()

    expect(tracker.observe('local:workspace', ['terminal'])).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], false)).toEqual([])
    expect(tracker.observe('local:workspace', ['browser', 'terminal'], true)).toEqual(['browser'])
  })
})
