import type {
  MaestroDelegationCatalog,
  MaestroDelegationIntent,
  MaestroDelegationPlacement,
  MaestroDelegationRequest,
  MaestroDelegationSource
} from '../../../../shared/maestro-delegation'
import type { MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import { translate } from '@/i18n/i18n'

export type MaestroDelegationDialogState =
  | 'configured'
  | 'submitting'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'outcome-unknown'

export type MaestroDelegationDraft = {
  role: string
  purpose: string
  lane: string
  agent: string | null
  model: string | null
  effort: MaestroDelegationRequest['requested']['effort']
  placement: MaestroDelegationPlacement
}

export const DEFAULT_MAESTRO_DELEGATION_DRAFT: MaestroDelegationDraft = {
  role: 'implementation',
  purpose: '',
  lane: 'balanced',
  agent: null,
  model: null,
  effort: null,
  placement: { kind: 'current-workspace' }
}

export function getAgentCatalogEntry(
  catalog: MaestroDelegationCatalog,
  agentId: string | null
): MaestroDelegationCatalog['agents'][number] | undefined {
  return agentId ? catalog.agents.find((agent) => agent.id === agentId) : undefined
}

export function getModelOptions(
  catalog: MaestroDelegationCatalog,
  agentId: string | null
): MaestroDelegationCatalog['agents'][number]['models'] {
  return getAgentCatalogEntry(catalog, agentId)?.models ?? []
}

export function getPlacementLabel(placement: MaestroDelegationPlacement): string {
  if (placement.kind === 'current-workspace') {
    return 'Current workspace'
  }
  if (placement.kind === 'existing-workspace') {
    return placement.workspace_key
  }
  return `Child worktree · ${placement.parent_workspace_key}`
}

export function getDelegationStateCopy(state: MaestroDelegationDialogState): {
  label: string
  detail: string
  tone: 'neutral' | 'destructive' | 'warning'
} {
  const copy: Record<MaestroDelegationDialogState, ReturnType<typeof getDelegationStateCopy>> = {
    configured: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.1838ae6a74',
        'Ready to request'
      ),
      detail: 'The current choices will be sent to the authenticated coordinator.',
      tone: 'neutral'
    },
    submitting: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.52a26b08d4',
        'Requesting delegation'
      ),
      detail: 'The intent is being recorded. No worker is running yet.',
      tone: 'neutral'
    },
    pending: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.7306623353',
        'Pending coordinator action'
      ),
      detail: 'The intent is visible to the coordinator and is not a running worker.',
      tone: 'neutral'
    },
    succeeded: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.2e65c5fa58',
        'Worker accepted'
      ),
      detail: 'The coordinator recorded a tracked worker for this intent.',
      tone: 'neutral'
    },
    failed: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.ab396719e8',
        'Launch failed'
      ),
      detail: 'The coordinator reported a failed launch. Review the intent before retrying.',
      tone: 'destructive'
    },
    rejected: {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.2337211cb4',
        'Request rejected'
      ),
      detail: 'The coordinator rejected this intent without claiming that a worker ran.',
      tone: 'warning'
    },
    'outcome-unknown': {
      label: translate(
        'auto.components.maestro.maestro.delegation.view.model.dd468641e0',
        'Outcome unknown'
      ),
      detail: 'The coordinator could not verify the launch outcome. Do not assume a worker exists.',
      tone: 'warning'
    }
  }
  return copy[state]
}

export function buildMaestroDelegationRequest(args: {
  workspace: MaestroWorkspaceAnchor
  source: MaestroDelegationSource
  parentTaskId?: string | null
  parentAttemptId?: string | null
  contextRefs?: readonly string[]
  paths: readonly string[]
  check: string
  intentId: string
  draft: MaestroDelegationDraft
}): MaestroDelegationRequest {
  return {
    schema_version: 1,
    protocol: 'maestro-delegation/v1',
    intent_id: args.intentId,
    workspace: args.workspace,
    source: args.source,
    parent_task_id: args.parentTaskId ?? null,
    parent_attempt_id: args.parentAttemptId ?? null,
    purpose: args.draft.purpose.trim(),
    role: args.draft.role.trim(),
    requested: {
      lane: args.draft.lane,
      agent: args.draft.agent,
      model: args.draft.model,
      effort: args.draft.effort
    },
    placement_request: args.draft.placement,
    context_refs: [...(args.contextRefs ?? [])],
    paths: [...args.paths],
    check: args.check
  }
}

export function delegationIntentToDialogState(
  intent: MaestroDelegationIntent
): Exclude<MaestroDelegationDialogState, 'configured' | 'submitting'> {
  if (intent.state === 'pending' || intent.state === 'claimed') {
    return 'pending'
  }
  return intent.state
}
