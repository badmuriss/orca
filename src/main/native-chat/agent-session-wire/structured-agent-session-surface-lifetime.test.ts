// The lifetime of a provider child, from the surfaces that hold the session.
//
// Two leaks meet here and each has to be tested against the real host, not a double: a chat that
// closes without stopping its app-server, and a launch that starts one for every record on disk.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionHandoffRequest,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import type {
  StructuredAgentSessionHandoffTransport,
  StructuredTuiOwner
} from './structured-agent-session-handoff-types'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'

const CALLER = { callerKey: 'client-1' }
const SURFACE = 'desktop-chat:1'
/** Short enough to keep the suite fast, long enough that an eviction is a decision and not a race. */
const GRACE_MS = 5

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let closeSession: Mock<NonNullable<StructuredAgentSessionAdapter['closeSession']>>
let sink: StructuredAgentSessionEventSink | null
let hostErrors: unknown[]
let closeTuiOwner: Mock<NonNullable<StructuredAgentSessionHandoffTransport['closeTuiOwner']>>

function adapter(): StructuredAgentSessionAdapter {
  return {
    acquire,
    closeSession,
    releaseAcquisition: vi.fn(async () => true),
    dispatch: vi.fn(async () => ({ state: 'rejected' as const, reason: 'unused' })),
    cancelTurn: vi.fn(async () => ({ cancelled: false })),
    answerPrompt: vi.fn(async () => undefined),
    setOption: vi.fn(async () => undefined)
  }
}

function openHost(
  probeOwner?: (record: never) => Promise<AgentSessionOwnerProbe>,
  handoffTransport?: StructuredAgentSessionHandoffTransport
): void {
  host = new StructuredAgentSessionHost({
    store,
    adapter: adapter(),
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${acquire.mock.calls.length}`,
    releaseGraceMs: GRACE_MS,
    now: () => NOW,
    onEventSinkError: ({ error }) => hostErrors.push(error),
    ...(probeOwner ? { probeOwner: probeOwner as never } : {}),
    ...(handoffTransport ? { handoffTransport } : {})
  })
}

/** A fresh app generation over the same durable store, with its owner proven gone. */
async function reboot(): Promise<void> {
  await host.flushAllStreamedEvents()
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  openHost(async () => ({ outcome: 'pid-absent' }))
  acquire.mockClear()
  closeSession.mockClear()
}

async function attach(): Promise<void> {
  expect(await host.attach(CALLER, hostTestAttachParams(null))).toMatchObject({ ok: true })
}

function emitTurnLifecycle(state: 'running' | 'completed', ordinal: number): void {
  sink?.appendItem(
    { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal },
    { kind: 'status', text: state, turnLifecycle: { turnId: 'turn-1', state } }
  )
}

/** Eviction is a sequence, not an event: the child stops first and the session is forgotten last. */
function waitForEviction(): Promise<void> {
  return vi.waitFor(() => {
    expect(closeSession).toHaveBeenCalledWith(SESSION)
    expect(host.hasSession(SESSION)).toBe(false)
  })
}

/** Long enough for several grace windows to elapse, so "not evicted" means the clock declined. */
function waitOutSeveralGraceWindows(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, GRACE_MS * 20))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-surface-lifetime-'))
  resetHostTestOperationIds()
  sink = null
  hostErrors = []
  acquire = vi.fn(async ({ fence, spawnToken, events }) => {
    sink = events ?? null
    return {
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
      link: {
        linkId: `link-${fence}`,
        handle: { provider: 'codex' as const, threadId: THREAD },
        origin: store.getRecord(SESSION)?.providerHandleChain.length
          ? ('resumed' as const)
          : ('created' as const),
        mintedAtFence: fence,
        observedAt: NOW
      }
    }
  })
  closeSession = vi.fn(async () => true)
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  openHost()
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

describe('a chat that closes', () => {
  it('releases the provider child it was holding', async () => {
    await attach()
    await host.hold(SESSION, SURFACE)

    host.release(SESSION, SURFACE)

    await waitForEviction()
    expect(hostErrors).toEqual([])
    // The record and its journal stay; only the process and the claim on it go.
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'released',
      ownerProcess: null,
      deathEvidence: { kind: 'exit-observed' }
    })
  })

  it('keeps the child while another surface still holds the session', async () => {
    await attach()
    await host.hold(SESSION, SURFACE)
    await host.hold(SESSION, 'paired-phone:1')

    host.release(SESSION, SURFACE)
    await waitOutSeveralGraceWindows()

    expect(closeSession).not.toHaveBeenCalled()
    expect(host.hasSession(SESSION)).toBe(true)
  })

  it('does not lose the session to a release the client sent twice', async () => {
    await attach()
    await host.hold(SESSION, SURFACE)
    await host.hold(SESSION, 'paired-phone:1')

    // A retried release must retire ONE holder, which is what a set gets right and a count does not.
    host.release(SESSION, SURFACE)
    host.release(SESSION, SURFACE)
    await waitOutSeveralGraceWindows()

    expect(closeSession).not.toHaveBeenCalled()
    expect(host.hasSession(SESSION)).toBe(true)
  })
})

describe('a session with a turn in flight', () => {
  it('is not evicted while the turn runs, and is once it ends', async () => {
    await attach()
    await host.hold(SESSION, SURFACE)
    emitTurnLifecycle('running', 1)
    await host.flushStreamedEvents(SESSION)

    host.release(SESSION, SURFACE)
    await waitOutSeveralGraceWindows()

    expect(closeSession).not.toHaveBeenCalled()
    expect(host.hasSession(SESSION)).toBe(true)

    emitTurnLifecycle('completed', 2)
    await host.flushStreamedEvents(SESSION)

    await waitForEviction()
  })
})

describe('a structured session whose TUI surface is not published', () => {
  function handoffRequest(): AgentSessionHandoffRequest {
    const fields = { direction: 'to-tui' as const, mode: 'now' as const, action: 'start' as const }
    return {
      envelope: {
        sessionId: SESSION,
        clientOperationId: `${NOW}-${'a'.repeat(32)}`,
        expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
        payloadFingerprint: computeAgentSessionPayloadFingerprint({
          method: 'agentSession.requestHandoff',
          sessionId: SESSION,
          fields
        })
      },
      ...fields
    }
  }

  function tuiOwner(spawnToken: string): StructuredTuiOwner {
    return {
      terminal: {
        handle: 'tui-handle-1',
        tabId: 'tui-tab-1',
        paneKey: 'tui-tab-1:tui-pane-1',
        ptyId: 'tui-pty-1'
      },
      process: {
        hostId: 'local',
        pid: 4343,
        processStartTimeMs: NOW,
        spawnToken
      },
      link: {
        linkId: 'tui-link-1',
        handle: { provider: 'codex', threadId: THREAD },
        origin: 'resumed',
        mintedAtFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
        observedAt: NOW
      }
    }
  }

  async function openTuiOwnedHost(): Promise<void> {
    closeTuiOwner = vi.fn(async () => ({}))
    const transport: StructuredAgentSessionHandoffTransport = {
      hostLabel: 'test',
      launchTui: async ({ spawnToken }) => tuiOwner(spawnToken),
      reproveTuiOwner: async ({ owner }) => owner,
      recoverTuiOwner: async () => tuiOwner('recovered'),
      stopRecoveredOwner: async () => undefined,
      closeTuiOwner,
      waitForTuiExit: async () => ({}),
      waitForTuiIdleOrExit: async () => 'idle',
      tuiStatus: () => 'idle'
    }
    await host.flushAllStreamedEvents()
    openHost(undefined, transport)
    await attach()
    expect(await host.requestHandoff(CALLER, handoffRequest())).toMatchObject({ ok: true })
    await vi.waitFor(async () => expect((await host.handoffStatus(SESSION)).owner).toBe('tui'))
  }

  it('stops the retained TUI owner before forgetting the closed session', async () => {
    await openTuiOwnedHost()

    await host.close(SESSION)

    expect(closeTuiOwner).toHaveBeenCalledOnce()
    expect(host.hasSession(SESSION)).toBe(false)
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'released',
      ownerProcess: null
    })
  })

  it('retains the owner and session when TUI exit proof fails', async () => {
    await openTuiOwnedHost()
    closeTuiOwner.mockRejectedValueOnce(new Error('terminal_exit_unproven'))

    await expect(host.close(SESSION)).rejects.toThrow('terminal_exit_unproven')

    expect(host.hasSession(SESSION)).toBe(true)
    expect((await host.handoffStatus(SESSION)).owner).toBe('tui')
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('live')

    closeTuiOwner.mockResolvedValueOnce({})
    await host.close(SESSION)
  })
})

describe('startup', () => {
  it('restores a session for reading without spawning a provider child', async () => {
    await attach()
    await reboot()

    await host.restoreReadableSessions()

    // The record is readable — the tab comes back, history answers — and nothing is running.
    expect(acquire).not.toHaveBeenCalled()
    expect(host.listSessionTabs()).toEqual([
      { sessionId: SESSION, workspaceId: 'workspace-1', agent: 'codex' }
    ])
    expect(host.history({ sessionId: SESSION, direction: 'tail' }).ok).toBe(true)
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
  })

  it('gives the child back to a chat a surface actually opens', async () => {
    await attach()
    await reboot()
    await host.restoreReadableSessions()

    await host.hold(SESSION, SURFACE)

    expect(acquire).toHaveBeenCalledOnce()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'live',
      runtimeKind: 'native',
      ownerProcess: { pid: 4242 }
    })
  })
})

describe('a session evicted and opened again', () => {
  it('publishes provider events to the reattached chat', async () => {
    await attach()
    await host.hold(SESSION, SURFACE)
    host.release(SESSION, SURFACE)
    await waitForEviction()

    await host.hold(SESSION, 'desktop-chat:2')
    const events: AgentSessionSubscribeEvent[] = []
    const unsubscribe = host.subscribe({
      id: 'subscriber-1',
      sessionId: SESSION,
      emit: (event) => events.push(event)
    })
    sink?.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'turn-2', ordinal: 1 },
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'back again' }] }
    )
    sink?.publish()
    await host.flushStreamedEvents(SESSION)
    unsubscribe()

    expect(JSON.stringify(events)).toContain('back again')
  })
})
