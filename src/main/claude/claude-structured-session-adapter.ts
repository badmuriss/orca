import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import type {
  AgentSessionAcquisition,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  openClaudeStreamJsonConnection,
  type ClaudeControlRequest
} from './claude-stream-json-connection'
import { answerClaudePrompt, cancelClaudeTurn } from './claude-structured-control-actions'
import {
  closeFailedClaudeAcquisition,
  resolveClaudeLaunchBeforeSpawn,
  stopSupersededClaudeAcquisition
} from './claude-structured-acquisition-lifecycle'
import { dispatchClaudeTurn, resolveClaudeReplayWaiter } from './claude-structured-dispatch'
import { handleClaudeInboundControl } from './claude-structured-inbound-control'
import {
  claudeAuthDiagnostic,
  readClaudeInit,
  readClaudeModels
} from './claude-structured-init-proof'
import {
  createClaudeInitDeadline,
  requestClaudeInitialization
} from './claude-structured-init-deadline'
import { supportsClaudeStructuredLocation } from './claude-structured-location-support'
import { CLAUDE_SPAWN_TOKEN_ENV, claudeProcessIdentity } from './claude-structured-owner-identity'
import { setClaudeStructuredOption } from './claude-structured-options'
import { ClaudePromptRegistry } from './claude-structured-prompt-replies'
import { readClaudeStructuredSessionOptions } from './claude-structured-session-options'
import { createClaudeSessionPublication } from './claude-structured-session-publication'
import { createClaudeSessionJournalTranslator } from './claude-structured-journal-translation'
import {
  ClaudeAcquisitionRegistry,
  type ClaudeAcquisitionAttempt,
  type ClaudeSession,
  type ClaudeStructuredSessionAdapterDeps,
  type ClaudeStructuredSessionEvent
} from './claude-structured-session-state'
import { handleClaudeSessionExit } from './claude-structured-session-close'
import {
  closeAllClaudeSessions,
  closeClaudeSession,
  closePublishedClaudeSession,
  releaseClaudeAcquisition
} from './claude-structured-session-shutdown'

export type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
export type {
  ClaudeAuthDiagnostic,
  ClaudeStructuredSessionAdapterDeps,
  ClaudeStructuredSessionEvent
} from './claude-structured-session-state'

export const CLAUDE_STRUCTURED_INIT_TIMEOUT_MS = 10_000
const DISPATCH_ACK_TIMEOUT_MS = 10_000

export class ClaudeStructuredSessionAdapter implements StructuredAgentSessionAdapter {
  private readonly sessions = new Map<string, ClaudeSession>()
  private readonly acquisitions = new ClaudeAcquisitionRegistry()

  constructor(private readonly deps: ClaudeStructuredSessionAdapterDeps) {}

  supportsLocation = supportsClaudeStructuredLocation

  async acquire(input: {
    identity: AgentSessionJournalIdentity
    fence: number
    spawnToken: string
    events?: StructuredAgentSessionEventSink
  }): Promise<AgentSessionAcquisition> {
    const sessionId = input.identity.sessionId
    const prompts = new ClaudePromptRegistry()
    const translator = createClaudeSessionJournalTranslator(input.events, prompts)
    const { previous, attempt } = this.acquisitions.start(sessionId, prompts)
    let liveSession: ClaudeSession | null = null
    const initTimeoutMs = this.deps.initTimeoutMs ?? CLAUDE_STRUCTURED_INIT_TIMEOUT_MS
    const initDeadline = createClaudeInitDeadline(sessionId, initTimeoutMs)

    const onMessage = (message: Record<string, unknown>): void => {
      const init = readClaudeInit(message)
      if (init) {
        initDeadline.resolve(init)
      }
      if (liveSession) {
        resolveClaudeReplayWaiter(liveSession, message)
      }
      this.deliver(attempt, sessionId, () =>
        this.emit(liveSession, { type: 'message', sessionId, message })
      )
    }
    const onControlRequest = (request: ClaudeControlRequest): void => {
      handleClaudeInboundControl({
        sessionId,
        attempt,
        request,
        emit: (event) => this.deliver(attempt, sessionId, () => this.emit(liveSession, event))
      })
    }

    try {
      await stopSupersededClaudeAcquisition({
        sessionId,
        registry: this.acquisitions,
        replacement: attempt,
        previous
      })
      this.acquisitions.assertCurrent(sessionId, attempt)
      if (
        (await closePublishedClaudeSession({
          sessions: this.sessions,
          sessionId,
          ...(this.deps.persistHandle ? { persistHandle: this.deps.persistHandle } : {}),
          ...(this.deps.onEvent ? { onEvent: this.deps.onEvent } : {})
        })) === false
      ) {
        throw new Error(`claude stream-json for session ${sessionId} could not be stopped`)
      }
      this.acquisitions.assertCurrent(sessionId, attempt)
      const launch = await resolveClaudeLaunchBeforeSpawn(this.deps, input.identity)
      this.acquisitions.assertCurrent(sessionId, attempt)
      const open = this.deps.openConnection ?? openClaudeStreamJsonConnection
      const connection = await open(
        {
          command: launch.command,
          args: launch.args,
          cwd: launch.cwd,
          env: {
            ...launch.env,
            [CLAUDE_SPAWN_TOKEN_ENV]: input.spawnToken,
            CLAUDE_CONFIG_DIR: launch.claudeConfigDir
          }
        },
        {
          onMessage,
          onControlRequest,
          onControlCancelRequest: ({ request_id: requestId }) => {
            const prompt = prompts.cancel(requestId)
            if (prompt) {
              this.deliver(attempt, sessionId, () =>
                this.emit(liveSession, {
                  type: 'prompt-cancelled',
                  sessionId,
                  promptKey: prompt.promptKey
                })
              )
            }
          },
          onExit: (error) => {
            if (!attempt.published) {
              initDeadline.reject(error)
            }
            this.handleExit(sessionId, attempt, error)
          }
        }
      )
      attempt.connection = connection
      this.acquisitions.assertCurrent(sessionId, attempt)
      initDeadline.start()
      const [initialization, init] = await Promise.all([
        requestClaudeInitialization(connection, sessionId, initTimeoutMs),
        initDeadline.promise
      ])
      const models = readClaudeModels(initialization)
      this.deliver(attempt, sessionId, () =>
        this.emit(liveSession, { type: 'options', sessionId, models })
      )
      initDeadline.clear()
      this.acquisitions.assertCurrent(sessionId, attempt)
      if (init.providerSessionId !== launch.providerSessionId) {
        throw new Error(
          `claude proved session ${init.providerSessionId}, expected ${launch.providerSessionId}`
        )
      }
      const settings = await connection
        .request('get_settings', {}, { timeoutMs: this.deps.requestTimeoutMs })
        .catch(() => null)
      this.deliver(attempt, sessionId, () =>
        this.emit(liveSession, {
          type: 'auth-diagnostic',
          sessionId,
          diagnostic: claudeAuthDiagnostic(init, settings)
        })
      )
      const process = await claudeProcessIdentity(
        { ...input, pid: connection.pid },
        this.deps.readProcessStartTime
      )
      this.acquisitions.assertCurrent(sessionId, attempt)
      if (connection.closed) {
        throw new Error(`claude stream-json for session ${sessionId} exited while being acquired`)
      }
      const leafUuid = launch.resumed
        ? await this.deps.proveTranscriptCursor({
            sessionId,
            providerSessionId: launch.providerSessionId,
            previousLeafUuid: launch.resumeLeafUuid
          })
        : launch.resumeLeafUuid
      this.acquisitions.assertCurrent(sessionId, attempt)
      const publication = createClaudeSessionPublication({
        connection,
        init,
        leafUuid: leafUuid ?? null,
        fence: input.fence,
        resumed: launch.resumed,
        prompts,
        translator,
        events: input.events,
        process,
        ...(this.deps.mintLinkId ? { linkId: this.deps.mintLinkId() } : {}),
        observedAt: this.deps.now?.() ?? Date.now()
      })
      const acquired: AgentSessionAcquisition = publication.acquisition
      liveSession = publication.session
      this.acquisitions.assertCurrent(sessionId, attempt)
      this.acquisitions.deleteIfCurrent(sessionId, attempt)
      this.sessions.set(sessionId, liveSession)
      attempt.published = true
      for (const event of attempt.buffered.splice(0)) {
        event()
      }
      return acquired
    } catch (error) {
      initDeadline.clear()
      if (this.sessions.get(sessionId)?.connection !== attempt.connection) {
        return closeFailedClaudeAcquisition({
          sessionId,
          registry: this.acquisitions,
          attempt,
          cause: error,
          dispose: () => {
            translator?.dispose()
            prompts.clear()
          }
        })
      }
      this.acquisitions.deleteIfCurrent(sessionId, attempt)
      throw error
    } finally {
      attempt.finish()
    }
  }

  private deliver(attempt: ClaudeAcquisitionAttempt, sessionId: string, event: () => void): void {
    if (!attempt.published) {
      attempt.buffered.push(event)
      return
    }
    if (this.sessions.get(sessionId)?.connection === attempt.connection) {
      event()
    }
  }

  private handleExit(sessionId: string, attempt: ClaudeAcquisitionAttempt, error: Error): void {
    handleClaudeSessionExit({
      sessions: this.sessions,
      sessionId,
      attempt,
      error,
      ...(this.deps.onEvent ? { onEvent: this.deps.onEvent } : {})
    })
  }

  private emit(_session: ClaudeSession | null, event: ClaudeStructuredSessionEvent): void {
    _session?.translator?.handle(event)
    this.deps.onEvent?.(event)
  }

  bindPromptItemId(
    sessionId: string,
    journalItemId: string,
    promptKey: string,
    questionId?: string
  ): void {
    this.sessions.get(sessionId)?.prompts.bindJournalItemId(journalItemId, promptKey, questionId)
  }

  dispatch: StructuredAgentSessionAdapter['dispatch'] = (input) =>
    dispatchClaudeTurn(
      this.session(input.sessionId),
      input,
      this.deps.dispatchAckTimeoutMs ?? DISPATCH_ACK_TIMEOUT_MS
    )

  cancelTurn: StructuredAgentSessionAdapter['cancelTurn'] = (input) =>
    cancelClaudeTurn(this.session(input.sessionId), this.deps.requestTimeoutMs)
  answerPrompt: StructuredAgentSessionAdapter['answerPrompt'] = (input) =>
    answerClaudePrompt(this.session(input.sessionId), input)
  setOption: StructuredAgentSessionAdapter['setOption'] = (input) =>
    setClaudeStructuredOption(this.session(input.sessionId), input, this.deps.requestTimeoutMs)
  readOptions = (input: { sessionId: string; fence: number }) =>
    readClaudeStructuredSessionOptions(this.session(input.sessionId), this.deps.requestTimeoutMs)
  releaseAcquisition = ({ sessionId }: { sessionId: string }): Promise<boolean> =>
    this.disposeSession(sessionId)

  closeSession = (sessionId: string): Promise<boolean> =>
    closeClaudeSession(sessionId, this.sessions, this.acquisitions, this.deps)
  disposeSession = (sessionId: string): Promise<boolean> =>
    releaseClaudeAcquisition(sessionId, this.sessions, this.acquisitions, this.deps)
  closeAll = (): Promise<void> =>
    closeAllClaudeSessions(this.sessions, this.acquisitions, (sessionId) =>
      this.disposeSession(sessionId)
    )
  private session(sessionId: string): ClaudeSession {
    const session = this.sessions.get(sessionId)
    if (!session || session.ended) {
      throw new Error(`no live claude stream-json session for ${sessionId}`)
    }
    return session
  }
}
