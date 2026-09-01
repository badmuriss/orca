import { z } from 'zod'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { OrchestrationDb } from '../../orchestration/db'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'

export const OptionalWorkerLaunchPreference = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), 'Surrounding whitespace is invalid')
  .optional()

export const WorkerStartParams = z.object({
  task: requiredString('Missing --task'),
  on: OptionalString,
  run: OptionalString,
  from: requiredString('Missing --from'),
  worktree: OptionalString,
  name: OptionalString,
  repo: OptionalString,
  baseBranch: OptionalString,
  displayName: OptionalString,
  comment: OptionalString,
  setup: z.enum(['run', 'skip', 'inherit']).optional(),
  terminal: OptionalString,
  agent: OptionalString,
  model: OptionalWorkerLaunchPreference,
  effort: OptionalWorkerLaunchPreference,
  attemptId: OptionalString,
  retryOf: OptionalString,
  replacementOf: OptionalString,
  timeoutMs: OptionalFiniteNumber,
  devMode: z.boolean().optional()
})

export type WorkerStartInput = z.infer<typeof WorkerStartParams>

type PersistedWorkerStartOptions = {
  worktree?: string
  resolvedWorktreeId?: string | null
  agent?: string | null
  launch?: { requested?: { agent?: string | null; model?: string | null; effort?: string | null } }
}

export function resolveReplacementWorkerStart(
  params: WorkerStartInput,
  db: OrchestrationDb
): WorkerStartInput {
  if (!params.replacementOf) {
    return params
  }
  if (params.retryOf || params.terminal || params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      'replace-worker derives placement from its predecessor and cannot combine with retry or launch overrides.'
    )
  }
  const predecessor = db.getWorkerDispatch(params.replacementOf)
  if (!predecessor) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Replacement predecessor ${params.replacementOf} was not found.`
    )
  }
  const options = JSON.parse(predecessor.start_options) as PersistedWorkerStartOptions
  const requested = options.launch?.requested
  const agent = options.agent ?? requested?.agent
  if (!agent || !isTuiAgent(agent)) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'The replacement predecessor has no reproducible configured agent identity.'
    )
  }
  return {
    ...params,
    agent,
    model: requested?.model ?? undefined,
    effort: requested?.effort ?? undefined,
    worktree: options.resolvedWorktreeId ? `id:${options.resolvedWorktreeId}` : options.worktree,
    attemptId: `replacement-${params.replacementOf}`
  }
}
