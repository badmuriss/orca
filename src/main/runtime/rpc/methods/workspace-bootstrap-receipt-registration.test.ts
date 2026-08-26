import { describe, expect, it } from 'vitest'
import { ALL_RPC_METHODS } from '.'

describe('workspace bootstrap receipt RPC', () => {
  it('registers the CLI-advertised orchestration method', () => {
    expect(
      ALL_RPC_METHODS.some((method) => method.name === 'orchestration.workspaceBootstrapReceipt')
    ).toBe(true)
  })
})
