import { describe, expect, it } from 'vitest'
import { maestroTerminalLifecycleViewModel } from './maestro-terminal-lifecycle-view-model'

describe('Maestro terminal lifecycle view model', () => {
  it('keeps current coordinators handoff-only', () => {
    const view = maestroTerminalLifecycleViewModel({
      status: 'active',
      role: 'coordinator',
      live: true
    })
    expect(view.canRelease).toBe(false)
    expect(view.canHandoffAndRelease).toBe(true)
    expect(view.description).toContain('Closing this inspector does not stop it')
  })

  it('separates retained released and unknown ownership', () => {
    expect(
      maestroTerminalLifecycleViewModel({ status: 'retained', role: 'worker', live: true }).tone
    ).toBe('retained')
    expect(
      maestroTerminalLifecycleViewModel({ status: 'released', role: 'worker', live: false }).tone
    ).toBe('released')
    expect(
      maestroTerminalLifecycleViewModel({
        status: 'outcome_unknown',
        role: 'worker',
        live: false
      }).tone
    ).toBe('unknown')
  })

  it('retains the predecessor while a successor starts', () => {
    const view = maestroTerminalLifecycleViewModel({
      status: 'handoff starting',
      role: 'coordinator',
      live: true
    })
    expect(view.label).toBe('Successor starting')
    expect(view.description).toContain('current coordinator stays retained')
  })
})
