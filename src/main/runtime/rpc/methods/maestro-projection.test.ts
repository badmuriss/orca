import { describe, expect, it } from 'vitest'
import { AgentGraphProjectionInputSchema } from '../../../../shared/maestro-projection'
describe('Maestro projection RPC boundary', () => {
  it('keeps the projection input bounded by the shared schema', () => {
    expect(AgentGraphProjectionInputSchema.safeParse({}).success).toBe(false)
  })
})
