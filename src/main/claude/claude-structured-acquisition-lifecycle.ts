import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import {
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionPreSpawnError
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import {
  cancelClaudeAcquisitionAttempt,
  type ClaudeAcquisitionAttempt,
  type ClaudeAcquisitionRegistry,
  type ClaudeStructuredSessionAdapterDeps
} from './claude-structured-session-state'

export async function resolveClaudeLaunchBeforeSpawn(
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'resolveLaunch'>,
  identity: AgentSessionJournalIdentity
) {
  try {
    return await deps.resolveLaunch({ identity })
  } catch (error) {
    throw new AgentSessionPreSpawnError(error)
  }
}

export async function stopSupersededClaudeAcquisition(input: {
  sessionId: string
  registry: ClaudeAcquisitionRegistry
  replacement: ClaudeAcquisitionAttempt
  previous: ClaudeAcquisitionAttempt | undefined
}): Promise<void> {
  try {
    if (!(await cancelClaudeAcquisitionAttempt(input.previous))) {
      throw new AgentSessionAcquisitionExitUnprovenError(
        new Error(`claude acquisition for session ${input.sessionId} could not be stopped`)
      )
    }
  } catch (error) {
    if (input.previous) {
      input.registry.restoreIfCurrent(input.sessionId, input.replacement, input.previous)
    }
    throw error
  }
}

export async function closeFailedClaudeAcquisition(input: {
  sessionId: string
  registry: ClaudeAcquisitionRegistry
  attempt: ClaudeAcquisitionAttempt
  cause: unknown
  dispose: () => void
}): Promise<never> {
  input.dispose()
  try {
    if (!(await input.registry.closeFailedAttempt(input.sessionId, input.attempt))) {
      throw new AgentSessionAcquisitionExitUnprovenError(input.cause)
    }
  } catch (cleanupError) {
    if (cleanupError instanceof AgentSessionAcquisitionExitUnprovenError) {
      throw cleanupError
    }
    throw new AgentSessionAcquisitionExitUnprovenError(
      new AggregateError([input.cause, cleanupError], 'claude acquisition cleanup failed')
    )
  }
  throw input.cause
}
