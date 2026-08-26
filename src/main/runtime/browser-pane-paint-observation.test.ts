import { describe, expect, it } from 'vitest'
import { observedPanePaint, UNOBSERVED_PANE_PAINT } from './browser-pane-paint-observation'

describe('browser pane paint observation', () => {
  it('times every verdict it reaches and leaves an unobserved probe timeless', () => {
    expect(observedPanePaint(true)).toEqual({
      verdict: 'painted',
      observedAt: expect.any(String)
    })
    expect(observedPanePaint(false)).toEqual({
      verdict: 'unpainted',
      observedAt: expect.any(String)
    })
    // A probe that never ran is the absence of a verdict, so it carries no time either.
    expect(UNOBSERVED_PANE_PAINT).toEqual({ verdict: 'unobserved', observedAt: null })
  })
})
