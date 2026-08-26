import { closeProcessRegistry } from '../../shared/child-process/close-process-registry'
import { closeClaudePublishedSession } from './claude-structured-session-close'
import {
  cancelClaudeAcquisitionAttempt,
  type ClaudeAcquisitionRegistry,
  type ClaudeSession,
  type ClaudeStructuredSessionAdapterDeps,
  type ClaudeStructuredSessionEvent
} from './claude-structured-session-state'

export async function closeClaudeSession(
  sessionId: string,
  sessions: Map<string, ClaudeSession>,
  acquisitions: ClaudeAcquisitionRegistry,
  deps?: Pick<ClaudeStructuredSessionAdapterDeps, 'persistHandle' | 'onEvent'>
): Promise<boolean> {
  const attempt = acquisitions.get(sessionId)
  if (!(await cancelClaudeAcquisitionAttempt(attempt))) {
    return false
  }
  if (attempt) {
    acquisitions.deleteIfCurrent(sessionId, attempt)
  }
  return closeClaudePublishedSession({
    sessions,
    sessionId,
    ...(deps?.persistHandle ? { persistHandle: deps.persistHandle } : {}),
    ...(deps?.onEvent ? { onEvent: deps.onEvent } : {})
  })
}

export function releaseClaudeAcquisition(
  sessionId: string,
  sessions: Map<string, ClaudeSession>,
  acquisitions: ClaudeAcquisitionRegistry,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'onEvent'>
): Promise<boolean> {
  return closeClaudeSession(
    sessionId,
    sessions,
    acquisitions,
    deps.onEvent ? { onEvent: deps.onEvent } : undefined
  )
}

export function closePublishedClaudeSession(input: {
  sessionId: string
  sessions: Map<string, ClaudeSession>
  persistHandle?: (handle: {
    sessionId: string
    providerSessionId: string
    fence: number
  }) => Promise<string>
  onEvent?: (event: ClaudeStructuredSessionEvent) => void
}): Promise<boolean> {
  return closeClaudePublishedSession(input)
}

export async function closeAllClaudeSessions(
  sessions: Map<string, ClaudeSession>,
  acquisitions: ClaudeAcquisitionRegistry,
  close: (sessionId: string) => Promise<boolean>
): Promise<void> {
  acquisitions.close()
  await closeProcessRegistry({
    attempts: 3,
    hasEntries: () => sessions.size > 0 || acquisitions.size > 0,
    entryIds: () => new Set([...sessions.keys(), ...acquisitions.sessionIds()]),
    closeEntry: close,
    failureMessage: 'claude structured session shutdown could not prove every child stopped'
  })
}
