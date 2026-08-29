import type {
  AgentActorAttestation,
  AgentStatusIpcPayload,
  AgentSubagentSnapshot
} from '../../../shared/agent-status-types'
import type { OrchestrationNestedAgentActivity } from '../../../shared/orchestration-nested-agent-activity'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'

export type ExactWorkerProviderObservation = {
  actorAttestation?: AgentActorAttestation
  subagents: readonly AgentSubagentSnapshot[]
  statusObservedAt: number
}

export function selectExactWorkerProviderSession(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly AgentStatusIpcPayload[]
}): (ExactWorkerProviderSession & ExactWorkerProviderObservation) | null {
  const status = args.statuses
    .filter(
      (entry) =>
        entry.paneKey === args.paneKey &&
        (args.connectionId === undefined || entry.connectionId === args.connectionId) &&
        (!args.launchToken || entry.launchToken === args.launchToken) &&
        entry.providerSessionOnly !== true &&
        entry.providerSession !== undefined &&
        entry.agentType !== undefined &&
        entry.receivedAt >= args.observedAfter
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)[0]
  if (!status?.providerSession || !status.agentType) {
    return null
  }
  return {
    paneKey: args.paneKey,
    processIncarnation: args.processIncarnation,
    agent: status.agentType,
    providerSession: { ...status.providerSession },
    observedAt: status.receivedAt,
    ...(status.actorAttestation ? { actorAttestation: status.actorAttestation } : {}),
    subagents: status.subagents ?? [],
    statusObservedAt: status.receivedAt
  }
}

export function readExactWorkerProviderObservation(
  session: ExactWorkerProviderSession | null
): ExactWorkerProviderObservation | null {
  if (!session || !('subagents' in session) || !('statusObservedAt' in session)) {
    return null
  }
  if (!Array.isArray(session.subagents) || typeof session.statusObservedAt !== 'number') {
    return null
  }
  const actorAttestation =
    'actorAttestation' in session && isAgentActorAttestation(session.actorAttestation)
      ? session.actorAttestation
      : undefined
  return {
    ...(actorAttestation ? { actorAttestation } : {}),
    subagents: session.subagents.filter(isAgentSubagentSnapshot),
    statusObservedAt: session.statusObservedAt
  }
}

export function projectNestedAgentActivities(args: {
  dispatchId: string
  session: ExactWorkerProviderSession
}): OrchestrationNestedAgentActivity[] {
  const observation = readExactWorkerProviderObservation(args.session)
  if (!observation) {
    return []
  }
  const provider = args.session.agent
  const parentProviderSessionId = args.session.providerSession.id
  return observation.subagents.map((subagent) => {
    const startedAt = new Date(subagent.startedAt).toISOString()
    const updatedAt = new Date(observation.statusObservedAt).toISOString()
    const description = subagent.description ?? subagent.agentType ?? 'Native child'
    if (subagent.state === 'idle') {
      return {
        parent_dispatch_id: args.dispatchId,
        parent_provider_session_id: parentProviderSessionId,
        provider_child_id: subagent.id,
        provider,
        type: subagent.agentType ?? 'subagent',
        ...(subagent.model ? { model: subagent.model } : {}),
        description,
        state: 'completed',
        started_at: startedAt,
        updated_at: updatedAt,
        completed_at: updatedAt
      }
    }
    return {
      parent_dispatch_id: args.dispatchId,
      parent_provider_session_id: parentProviderSessionId,
      provider_child_id: subagent.id,
      provider,
      type: subagent.agentType ?? 'subagent',
      ...(subagent.model ? { model: subagent.model } : {}),
      description,
      state: subagent.state === 'working' ? 'running' : 'waiting',
      started_at: startedAt,
      updated_at: updatedAt
    }
  })
}

function isAgentActorAttestation(value: unknown): value is AgentActorAttestation {
  if (!value || typeof value !== 'object') {
    return false
  }
  return (
    'authorityId' in value &&
    typeof value.authorityId === 'string' &&
    'incarnation' in value &&
    typeof value.incarnation === 'number' &&
    'revision' in value &&
    typeof value.revision === 'number' &&
    'observedAt' in value &&
    typeof value.observedAt === 'number' &&
    'provider' in value &&
    (value.provider === 'claude' || value.provider === 'codex') &&
    'role' in value &&
    (value.role === 'lead' || value.role === 'child') &&
    'eventName' in value &&
    typeof value.eventName === 'string' &&
    (!('providerSessionId' in value) || typeof value.providerSessionId === 'string')
  )
}

function isAgentSubagentSnapshot(value: unknown): value is AgentSubagentSnapshot {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'state' in value &&
    (value.state === 'working' ||
      value.state === 'blocked' ||
      value.state === 'waiting' ||
      value.state === 'idle') &&
    'startedAt' in value &&
    typeof value.startedAt === 'number'
  )
}
