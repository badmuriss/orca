import { describe, expect, it } from 'vitest'
import { COMMAND_SPECS } from './specs'

describe('Maestro CLI entrypoint', () => {
  it('registers the complete bounded command family', () => {
    const paths = new Set(COMMAND_SPECS.map((spec) => spec.path.join(' ')))

    expect(paths.has('maestro watch')).toBe(true)
    expect(paths.has('maestro open')).toBe(true)
    expect(paths.has('maestro browser-surface focus')).toBe(true)
    expect(paths.has('maestro browser-surface capture')).toBe(true)
    expect(paths.has('maestro browser-surface retain')).toBe(true)
  })
})
