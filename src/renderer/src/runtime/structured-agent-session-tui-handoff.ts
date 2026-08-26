import type {
  AgentSessionHandoffStatus,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import {
  createStructuredAgentSessionOperationId,
  structuredAgentSessionPayloadFingerprint
} from '../../../shared/structured-agent-session-mutation'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { callRuntimeRpc, type RuntimeClientTarget } from './runtime-rpc-client'
import { callStructuredAgentSession } from './structured-agent-session-client'
import {
  clearStructuredTuiHandoffBinding,
  recordStructuredTuiHandoffBinding
} from './web-structured-tui-handoff'

const HANDOFF_POLL_INTERVAL_MS = 100
const HANDOFF_TIMEOUT_MS = 30_000

function operationId(): string {
  return createStructuredAgentSessionOperationId(() => crypto.randomUUID())
}

async function readFence(target: RuntimeClientTarget, sessionId: string): Promise<number> {
  const history = await callStructuredAgentSession<
    | {
        ok: true
        page: { fence?: number }
        providerSession?: unknown
      }
    | { ok: false; fence?: number }
  >(target, 'agentSession.history', {
    sessionId,
    direction: 'tail',
    limit: 1
  })
  const fence = history.ok ? history.page.fence : history.fence
  if (typeof fence !== 'number' || !Number.isInteger(fence) || fence <= 0) {
    throw new Error('Structured chat did not publish an ownership fence.')
  }
  return fence
}

async function waitForTuiOwner(
  target: RuntimeClientTarget,
  sessionId: string,
  onTerminal: (status: AgentSessionHandoffStatus) => void
): Promise<AgentSessionHandoffStatus> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await callStructuredAgentSession<AgentSessionHandoffStatus>(
      target,
      'agentSession.handoffStatus',
      { sessionId }
    )
    if (status.phase === 'failed') {
      throw new Error(
        status.error?.details ?? status.error?.message ?? 'Agent terminal handoff failed.'
      )
    }
    // Publish the renderer binding as soon as the host gives us the exact tab
    // identity. A session-tabs snapshot may arrive before the owner reaches its
    // terminal idle state; waiting until the caller resumes drops that surface.
    if (status.terminal?.tabId) {
      onTerminal(status)
    }
    if (status.owner === 'tui' && status.phase === 'idle') {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, HANDOFF_POLL_INTERVAL_MS))
  }
  throw new Error('Agent terminal handoff did not finish in time.')
}

/**
 * Moves a directly-created structured session into the real provider TUI and
 * activates the host-created terminal surface. The runtime owns the launch;
 * this function only requests the durable handoff and focuses its published
 * terminal tab after the new owner is proven.
 */
export async function showStructuredAgentSessionTerminal(input: {
  worktreeId: string
  sessionId: string
  target: RuntimeClientTarget
}): Promise<AgentSessionHandoffStatus> {
  const fence = await readFence(input.target, input.sessionId)
  const fields = {
    direction: 'to-tui' as const,
    // The structured surface only offers this control from an idle reducer state;
    // never queue a writer transfer behind an in-flight turn.
    mode: 'now' as const,
    action: 'start' as const
  }
  const result = await callStructuredAgentSession<AgentSessionMutationResult<unknown>>(
    input.target,
    'agentSession.handoff',
    {
      envelope: {
        sessionId: input.sessionId,
        clientOperationId: operationId(),
        expectedRuntimeFence: fence,
        payloadFingerprint: structuredAgentSessionPayloadFingerprint({
          method: 'agentSession.requestHandoff',
          sessionId: input.sessionId,
          fields
        })
      },
      ...fields
    }
  )
  if (!result.ok) {
    throw new Error(result.refusal.message)
  }

  // The captured RPC target is the authoritative host identity for this
  // handoff; an active-worktree lookup can point at a different renderer host.
  const environmentId =
    input.target.kind === 'environment' ? input.target.environmentId : 'local-structured-session'
  const agent = input.sessionId.startsWith('claude_') ? ('claude' as const) : ('codex' as const)
  let boundTabId: string | null = null
  try {
    const status = await waitForTuiOwner(input.target, input.sessionId, (next) => {
      const tabId = next.terminal?.tabId
      if (!tabId || boundTabId === tabId) {
        return
      }
      if (boundTabId) {
        clearStructuredTuiHandoffBinding({
          environmentId,
          worktreeId: input.worktreeId,
          hostTabId: boundTabId
        })
      }
      boundTabId = tabId
      recordStructuredTuiHandoffBinding({
        environmentId,
        worktreeId: input.worktreeId,
        hostTabId: tabId,
        sessionId: input.sessionId,
        agent
      })
    })
    const terminal = status.terminal
    if (!terminal?.tabId) {
      throw new Error('The resumed agent terminal did not publish a tab identity.')
    }
    // The host creates the TUI surface with the user's default terminal mode. Set
    // the surface explicitly before refreshing and focusing it so the first
    // visible frame is the real TUI rather than an empty native-chat overlay.
    await callRuntimeRpc(input.target, 'session.tabs.setTabProps', {
      worktree: toRuntimeWorktreeSelector(input.worktreeId),
      tabId: terminal.tabId,
      viewMode: 'terminal'
    })
    await refreshStructuredTuiHandoffSnapshot(input.target, input.worktreeId)
    await callRuntimeRpc(input.target, 'session.tabs.activate', {
      worktree: toRuntimeWorktreeSelector(input.worktreeId),
      tabId: terminal.tabId,
      ...(terminal.paneKey.startsWith(`${terminal.tabId}:`)
        ? { leafId: terminal.paneKey.slice(terminal.tabId.length + 1) }
        : {})
    })
    return status
  } catch (error) {
    if (boundTabId) {
      clearStructuredTuiHandoffBinding({
        environmentId,
        worktreeId: input.worktreeId,
        hostTabId: boundTabId
      })
    }
    throw error
  }
}

async function refreshStructuredTuiHandoffSnapshot(
  target: RuntimeClientTarget,
  worktreeId: string
): Promise<void> {
  const result = await callRuntimeRpc<{ snapshots?: RuntimeMobileSessionTabsResult[] }>(
    target,
    'session.tabs.listAll',
    {}
  )
  const snapshot = result.snapshots?.find((candidate) => candidate.worktree === worktreeId)
  if (!snapshot) {
    return
  }
  if (target.kind === 'local') {
    const { applyStructuredSessionTabSnapshots } =
      await import('./local-structured-session-tabs-sync')
    applyStructuredSessionTabSnapshots([snapshot])
    return
  }
  const { applyWebSessionTabsSnapshot, applyWebSessionTabsStorePatch } =
    await import('./web-session-tabs-sync')
  const settle = applyWebSessionTabsStorePatch(
    (state) => {
      const patch = applyWebSessionTabsSnapshot(state, snapshot, target.environmentId)
      return patch === state ? state : patch
    },
    { frames: [] },
    snapshot
  )
  settle()
}
