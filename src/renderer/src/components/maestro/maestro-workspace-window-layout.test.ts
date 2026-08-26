import { describe, expect, it } from 'vitest'
import { createMaestroSurfaceAdditionTracker } from './maestro-workspace-window-layout'

describe('Maestro workspace window layout', () => {
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
