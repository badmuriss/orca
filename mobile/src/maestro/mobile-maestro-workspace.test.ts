import { describe, expect, it } from 'vitest'
import { requireAppliedMobileMaestroMutation } from './mobile-maestro-workspace'

describe('mobile Maestro mutations', () => {
  it('rejects a non-applied authority result with its status and reason', () => {
    expect(() =>
      requireAppliedMobileMaestroMutation({
        status: 'outcome_unknown',
        authority_revision: 4,
        reason: 'created_surface_not_projected'
      })
    ).toThrow('outcome_unknown: created_surface_not_projected')
  })
})
