import type {
  ClaudeAcquisitionAttempt,
  ClaudeSession,
  ClaudeStructuredSessionEvent
} from './claude-structured-session-state'

export function settleClaudeDispatchWaiters(session: ClaudeSession): void {
  for (const waiter of session.dispatchWaiters.splice(0)) {
    clearTimeout(waiter.timer)
    waiter.resolve(null)
  }
}

export function settleClaudeExitedSession(session: ClaudeSession): void {
  settleClaudeDispatchWaiters(session)
  session.prompts.clear()
  session.translator?.dispose()
}

export function handleClaudeSessionExit(input: {
  sessions: Map<string, ClaudeSession>
  sessionId: string
  attempt: ClaudeAcquisitionAttempt
  error: Error
  onEvent?: (event: ClaudeStructuredSessionEvent) => void
}): void {
  const session = input.sessions.get(input.sessionId)
  if (!session || session.connection !== input.attempt.connection || session.ended) {
    return
  }
  session.ended = true
  const event = { type: 'ended', sessionId: input.sessionId, reason: input.error.message } as const
  session.translator?.handle(event)
  input.onEvent?.(event)
  settleClaudeExitedSession(session)
}

export async function closeClaudePublishedSession(input: {
  sessions: Map<string, ClaudeSession>
  sessionId: string
  persistHandle?: (handle: {
    sessionId: string
    providerSessionId: string
    fence: number
  }) => Promise<string>
  onEvent?: (event: ClaudeStructuredSessionEvent) => void
}): Promise<boolean> {
  const session = input.sessions.get(input.sessionId)
  if (!session) {
    return true
  }
  if (session.closePromise) {
    return session.closePromise
  }
  const attempt = (async (): Promise<boolean> => {
    // Keep the live session intact when its durable handoff handle cannot be saved.
    const persistedLeafUuid = await input.persistHandle?.({
      sessionId: input.sessionId,
      providerSessionId: session.providerSessionId,
      fence: session.fence
    })
    if (persistedLeafUuid !== undefined) {
      session.leafUuid = persistedLeafUuid
    }
    const exited = await session.connection.close()
    if (exited === false) {
      return false
    }
    input.sessions.delete(input.sessionId)
    input.onEvent?.({
      type: 'handle',
      sessionId: input.sessionId,
      providerSessionId: session.providerSessionId,
      leafUuid: session.leafUuid,
      fence: session.fence
    })
    if (!session.ended) {
      session.ended = true
      settleClaudeDispatchWaiters(session)
      session.prompts.clear()
      const ended = {
        type: 'ended',
        sessionId: input.sessionId,
        reason: 'claude session closed'
      } as const
      session.translator?.handle(ended)
      input.onEvent?.(ended)
      session.translator?.dispose()
    }
    return true
  })()
  session.closePromise = attempt
  void attempt.then(
    (stopped) => {
      if (!stopped && session.closePromise === attempt) {
        session.closePromise = null
      }
    },
    () => {
      if (session.closePromise === attempt) {
        session.closePromise = null
      }
    }
  )
  return attempt
}
