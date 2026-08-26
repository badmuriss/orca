import { vi } from 'vitest'
import type { StructuredAgentSessionHandoffTransport } from '../native-chat/agent-session-wire/structured-agent-session-handoff-types'
import { OrcaRuntimeService } from './orca-runtime'

export const WORKTREE_ID = 'repo-1::/tmp/structured-handoff'
type TestNotifier = Record<string, (...args: never[]) => unknown>

export function terminalAdoptionHarness() {
  const runtime = new OrcaRuntimeService({ getSettings: () => ({ agentDefaultEnv: {} }) } as never)
  runtime.setPtyController({
    listProcesses: async () => [
      { id: 'pty-adopt', incarnationId: 'inc-adopt', rootProcessId: 31337 }
    ]
  } as never)
  const internal = runtime as unknown as {
    ptysById: Map<string, unknown>
    resolveRuntimeFileTarget(): Promise<unknown>
    resolveStructuredAgentSessionAdoptionIntent(input: { envelope: unknown }): Promise<unknown>
    issueStructuredTuiPtyHandle(): string
  }
  internal.ptysById.set('pty-adopt', {
    ptyId: 'pty-adopt',
    connected: true,
    connectionId: null,
    wslDistro: null,
    tabId: 'tab-adopt',
    paneKey: 'tab-adopt:leaf-adopt',
    worktreeId: WORKTREE_ID,
    incarnationId: 'inc-adopt'
  })
  internal.resolveRuntimeFileTarget = vi.fn(async () => ({
    connectionId: null,
    worktree: { id: WORKTREE_ID }
  }))
  internal.resolveStructuredAgentSessionAdoptionIntent = vi.fn(async ({ envelope }) => ({
    envelope,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: WORKTREE_ID,
      workspaceKind: 'git-worktree'
    },
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex-home' },
    runtimeKind: 'native'
  }))
  internal.issueStructuredTuiPtyHandle = vi.fn(() => 'term-adopt')
  return runtime
}

export function structuredHostDouble(overrides: Record<string, unknown> = {}) {
  return {
    supportsCreate: vi.fn(() => true),
    reserveAdoptedTuiOwner: vi.fn(async (input: { spawnToken: string }) => ({
      ok: true,
      fence: 1,
      spawnToken: input.spawnToken
    })),
    releaseAdoptedTuiReservation: vi.fn(async () => undefined),
    adoptTuiOwner: vi.fn(async () => ({ ok: true, replayed: false, fence: 1 })),
    ...overrides
  }
}

export function notifier(revealTerminalSession: (...args: never[]) => unknown): TestNotifier {
  return {
    worktreesChanged: vi.fn(),
    reposChanged: vi.fn(),
    activateWorktree: vi.fn(),
    createTerminal: vi.fn(),
    revealTerminalSession,
    splitTerminal: vi.fn(),
    renameTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    sleepWorktree: vi.fn(),
    terminalFitOverrideChanged: vi.fn(),
    terminalDriverChanged: vi.fn()
  }
}

export function structuredTabNotifier(): TestNotifier {
  return {
    ...notifier(vi.fn()),
    focusEditorTab: vi.fn()
  }
}

export function handoffTransport(
  runtime: OrcaRuntimeService
): StructuredAgentSessionHandoffTransport {
  return (
    runtime as unknown as {
      createStructuredAgentSessionHandoffTransport(): StructuredAgentSessionHandoffTransport
    }
  ).createStructuredAgentSessionHandoffTransport()
}
