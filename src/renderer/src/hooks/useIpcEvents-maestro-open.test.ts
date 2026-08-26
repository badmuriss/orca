import { describe, expect, it, vi } from 'vitest'

const openExactMaestroWorkspace = vi.fn(() => true)

vi.mock('@/lib/maestro-workspace-navigation', () => ({ openExactMaestroWorkspace }))

describe('Maestro Canvas IPC', () => {
  it('routes the exact host and workspace through the canonical Canvas navigation', async () => {
    const { openMaestroCanvasFromIpc } = await import('./useIpcEvents')
    const state = {} as Parameters<typeof openMaestroCanvasFromIpc>[0]
    const target = { executionHostId: 'ssh:build', workspaceKey: 'folder:workspace-1' }

    expect(openMaestroCanvasFromIpc(state, target)).toBe(true)
    expect(openExactMaestroWorkspace).toHaveBeenCalledWith(state, target)
  })
})
