import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionHandoffRequest } from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionHandoffOperationGuard } from './structured-agent-session-handoff-operation-guard'

export function settleQueuedHandoffRefusal(input: {
  operationGuard: StructuredAgentSessionHandoffOperationGuard
  track: (task: Promise<void>) => void
  setIdle: (record: AgentSessionRecord) => void
  fail: (params: AgentSessionHandoffRequest, error: unknown) => void
  params: AgentSessionHandoffRequest
  record: AgentSessionRecord
}): void {
  const { operationGuard, params, record } = input
  const settlement = operationGuard
    .settle(record.sessionId, params.envelope.clientOperationId, {
      status: 'failed',
      code: 'agent_session_checkpoint_stale'
    })
    .then(() => input.setIdle(record))
    .catch((error) => input.fail(params, error))
  input.track(settlement)
}
