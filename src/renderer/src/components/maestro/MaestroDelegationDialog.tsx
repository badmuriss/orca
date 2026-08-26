import { Loader2, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  MaestroDelegationCatalog,
  MaestroDelegationIntent,
  MaestroDelegationPlacement,
  MaestroDelegationRequest,
  MaestroDelegationSource
} from '../../../../shared/maestro-delegation'
import type { MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import {
  DEFAULT_MAESTRO_DELEGATION_DRAFT,
  buildMaestroDelegationRequest,
  delegationIntentToDialogState,
  getAgentCatalogEntry,
  getDelegationStateCopy,
  getModelOptions,
  getPlacementLabel,
  type MaestroDelegationDialogState,
  type MaestroDelegationDraft
} from './maestro-delegation-view-model'

const NO_PARENT_TASKS: readonly { id: string; label: string }[] = []
const NO_PARENT_ATTEMPTS: readonly { id: string; taskId: string; label: string }[] = []

type MaestroDelegationDialogProps = {
  open: boolean
  workspace: MaestroWorkspaceAnchor
  catalog: MaestroDelegationCatalog
  source: MaestroDelegationSource
  paths: readonly string[]
  check: string
  onOpenChange: (open: boolean) => void
  onSubmit: (request: MaestroDelegationRequest) => Promise<MaestroDelegationIntent>
  intent?: MaestroDelegationIntent | null
  parentTaskId?: string | null
  parentAttemptId?: string | null
  parentTasks?: readonly { id: string; label: string }[]
  parentAttempts?: readonly { id: string; taskId: string; label: string }[]
  contextRefs?: readonly string[]
}

const EMPTY_MODEL_VALUE = '__none__'

function iconAgent(agentId: string) {
  return getAgentCatalog().find((entry) => entry.id === agentId)?.id
}

function draftFromCatalog(catalog: MaestroDelegationCatalog): MaestroDelegationDraft {
  const firstAgent = catalog.agents.find((agent) => agent.enabled)
  const firstPlacement = catalog.placements.find((entry) => entry.enabled)
  return {
    ...DEFAULT_MAESTRO_DELEGATION_DRAFT,
    agent: firstAgent?.id ?? null,
    placement: firstPlacement?.placement ?? DEFAULT_MAESTRO_DELEGATION_DRAFT.placement
  }
}

function placementKey(placement: MaestroDelegationPlacement): string {
  if (placement.kind === 'current-workspace') {
    return 'current-workspace'
  }
  if (placement.kind === 'existing-workspace') {
    return `existing-workspace:${placement.execution_host_id}:${placement.workspace_key}`
  }
  return `create-child-worktree:${placement.execution_host_id}:${placement.parent_workspace_key}:${placement.name_hint}`
}

function placementFromKey(
  catalog: MaestroDelegationCatalog,
  key: string
): MaestroDelegationPlacement | undefined {
  return catalog.placements.find((entry) => placementKey(entry.placement) === key)?.placement
}

function intentId(): string {
  return `intent-${crypto.randomUUID().replaceAll('-', '')}`
}

export function MaestroDelegationStatusCard({
  state,
  onRetry,
  onDismiss
}: {
  state: Exclude<MaestroDelegationDialogState, 'configured' | 'submitting'>
  onRetry?: () => void
  onDismiss?: () => void
}): React.JSX.Element {
  const copy = getDelegationStateCopy(state)
  const tone =
    copy.tone === 'destructive'
      ? 'border-destructive/40 text-destructive'
      : copy.tone === 'warning'
        ? 'border-amber-500/40 text-amber-700 dark:text-amber-300'
        : 'border-border text-foreground'
  return (
    <section
      className={`rounded-md border bg-card p-3 ${tone}`}
      data-maestro-delegation-state={state}
    >
      <p className="text-sm font-medium">{copy.label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
      <div className="mt-3 flex gap-2">
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {translate(
              'auto.components.maestro.MaestroDelegationDialog.ee7d77fcca',
              'Review and retry'
            )}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            {translate('auto.components.maestro.MaestroDelegationDialog.65c5088c96', 'Close')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

export function MaestroDelegationDialog({
  open,
  workspace,
  catalog,
  source,
  paths,
  check,
  onOpenChange,
  onSubmit,
  parentTaskId,
  parentAttemptId,
  parentTasks = NO_PARENT_TASKS,
  parentAttempts = NO_PARENT_ATTEMPTS,
  contextRefs,
  intent
}: MaestroDelegationDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<MaestroDelegationDraft>(() => draftFromCatalog(catalog))
  const [state, setState] = useState<MaestroDelegationDialogState>('configured')
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [pathsText, setPathsText] = useState(() => paths.filter((path) => path.trim()).join('\n'))
  const [checkText, setCheckText] = useState(() => check.trim())
  const [selectedParentTaskId, setSelectedParentTaskId] = useState(parentTaskId ?? '')
  const [selectedParentAttemptId, setSelectedParentAttemptId] = useState(parentAttemptId ?? '')
  const selectedAgent = getAgentCatalogEntry(catalog, draft.agent)
  const modelOptions = getModelOptions(catalog, draft.agent)
  const authoritativeState = !reviewing && intent ? delegationIntentToDialogState(intent) : state
  const currentStateCopy = getDelegationStateCopy(authoritativeState)
  const enabledPlacements = useMemo(
    () => catalog.placements.filter((entry) => entry.enabled),
    [catalog.placements]
  )
  const sourceBindsTask = source.kind === 'task' || source.kind === 'attempt'
  const availableAttempts = parentAttempts.filter(
    (attempt) => attempt.taskId === selectedParentTaskId
  )
  const hasActiveParentTask = parentTasks.some((task) => task.id === selectedParentTaskId)
  const hasActiveParentAttempt = availableAttempts.some(
    (attempt) => attempt.id === selectedParentAttemptId
  )

  const updateDraft = <K extends keyof MaestroDelegationDraft>(
    key: K,
    value: MaestroDelegationDraft[K]
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleAgentChange = (value: string): void => {
    const nextAgent = value === EMPTY_MODEL_VALUE ? null : value
    setDraft((current) => ({ ...current, agent: nextAgent, model: null, effort: null }))
  }

  const handleSubmit = async (): Promise<void> => {
    setState('submitting')
    setReviewing(false)
    setError(null)
    try {
      const intent = await onSubmit(
        buildMaestroDelegationRequest({
          workspace,
          source,
          parentTaskId: selectedParentTaskId || null,
          parentAttemptId: selectedParentAttemptId || null,
          contextRefs,
          paths: pathsText
            .split(/\r?\n/)
            .map((path) => path.trim())
            .filter(Boolean),
          check: checkText.trim(),
          intentId: intentId(),
          draft
        })
      )
      setState(delegationIntentToDialogState(intent))
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Delegation request failed.'
      )
      setState('failed')
    }
  }

  const requestPaths = pathsText
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
  const hasValidPaths =
    requestPaths.length > 0 &&
    requestPaths.length <= 256 &&
    requestPaths.every((path) => path.length <= 4096)
  const hasBoundParent =
    hasActiveParentTask &&
    (source.kind !== 'attempt' || (selectedParentAttemptId.length > 0 && hasActiveParentAttempt))
  const canSubmit =
    hasBoundParent &&
    draft.role.trim().length > 0 &&
    draft.purpose.trim().length > 0 &&
    hasValidPaths &&
    checkText.trim().length > 0 &&
    checkText.trim().length <= 8192 &&
    state !== 'submitting'
  if (authoritativeState !== 'configured' && authoritativeState !== 'submitting') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" data-maestro-delegation-dialog="status">
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.maestro.delegation.title', 'Delegate work')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.maestro.delegation.statusDescription',
                'Intent status remains visible until the coordinator reports an outcome.'
              )}
            </DialogDescription>
          </DialogHeader>
          <MaestroDelegationStatusCard
            state={authoritativeState}
            onRetry={() => {
              setReviewing(true)
              setState('configured')
            }}
            onDismiss={() => onOpenChange(false)}
          />
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!flex max-h-[min(720px,calc(100vh-32px))] flex-col overflow-hidden sm:max-w-2xl"
        data-maestro-delegation-dialog="form"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {translate('auto.components.maestro.delegation.title', 'Delegate work')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.maestro.delegation.description',
              'Create a coordinator-owned intent for this Maestro workspace.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto py-2">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="maestro-delegation-role">
                  {translate('auto.components.maestro.MaestroDelegationDialog.b8f0076fd9', 'Role')}
                </Label>
                <Input
                  id="maestro-delegation-role"
                  value={draft.role}
                  onChange={(event) => updateDraft('role', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maestro-delegation-lane">
                  {translate('auto.components.maestro.MaestroDelegationDialog.d1517e8a1f', 'Lane')}
                </Label>
                <Input
                  id="maestro-delegation-lane"
                  value={draft.lane}
                  onChange={(event) => updateDraft('lane', event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maestro-delegation-purpose">
                {translate('auto.components.maestro.MaestroDelegationDialog.206b73828c', 'Purpose')}
              </Label>
              <Input
                id="maestro-delegation-purpose"
                value={draft.purpose}
                placeholder={translate(
                  'auto.components.maestro.MaestroDelegationDialog.dff88c6b20',
                  'Describe the bounded work'
                )}
                onChange={(event) => updateDraft('purpose', event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  {translate(
                    'auto.components.maestro.MaestroDelegationDialog.02994d9cc5',
                    'Active parent task'
                  )}
                </Label>
                <Select
                  value={selectedParentTaskId || EMPTY_MODEL_VALUE}
                  disabled={sourceBindsTask}
                  onValueChange={(value) => {
                    const taskId = value === EMPTY_MODEL_VALUE ? '' : value
                    setSelectedParentTaskId(taskId)
                    setSelectedParentAttemptId('')
                  }}
                >
                  <SelectTrigger
                    aria-label={translate(
                      'auto.components.maestro.MaestroDelegationDialog.02994d9cc5',
                      'Active parent task'
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.maestro.MaestroDelegationDialog.1549a55fe2',
                        'Choose active task'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {!sourceBindsTask ? (
                      <SelectItem value={EMPTY_MODEL_VALUE}>
                        {translate(
                          'auto.components.maestro.MaestroDelegationDialog.1549a55fe2',
                          'Choose active task'
                        )}
                      </SelectItem>
                    ) : null}
                    {parentTasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {translate(
                    'auto.components.maestro.MaestroDelegationDialog.86520d2816',
                    'Active parent attempt'
                  )}
                </Label>
                <Select
                  value={selectedParentAttemptId || EMPTY_MODEL_VALUE}
                  disabled={sourceBindsTask || availableAttempts.length === 0}
                  onValueChange={(value) =>
                    setSelectedParentAttemptId(value === EMPTY_MODEL_VALUE ? '' : value)
                  }
                >
                  <SelectTrigger
                    aria-label={translate(
                      'auto.components.maestro.MaestroDelegationDialog.86520d2816',
                      'Active parent attempt'
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.maestro.MaestroDelegationDialog.973416c02d',
                        'No active attempt'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_MODEL_VALUE}>
                      {translate(
                        'auto.components.maestro.MaestroDelegationDialog.973416c02d',
                        'No active attempt'
                      )}
                    </SelectItem>
                    {availableAttempts.map((attempt) => (
                      <SelectItem key={attempt.id} value={attempt.id}>
                        {attempt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="maestro-delegation-paths">
                  {translate('auto.components.maestro.MaestroDelegationDialog.362db169f3', 'Paths')}
                </Label>
                <textarea
                  id="maestro-delegation-paths"
                  value={pathsText}
                  rows={2}
                  placeholder={translate(
                    'auto.components.maestro.MaestroDelegationDialog.a66f3758c4',
                    'One bounded path per line'
                  )}
                  onChange={(event) => setPathsText(event.target.value)}
                  className="flex w-full rounded-md border border-input bg-input px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maestro-delegation-check">
                  {translate('auto.components.maestro.MaestroDelegationDialog.46f9a0c89d', 'Check')}
                </Label>
                <Input
                  id="maestro-delegation-check"
                  value={checkText}
                  placeholder={translate(
                    'auto.components.maestro.MaestroDelegationDialog.bbfb324e1c',
                    'Exact check command'
                  )}
                  onChange={(event) => setCheckText(event.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>
                  {translate('auto.components.maestro.MaestroDelegationDialog.1e7527e118', 'Agent')}
                </Label>
                <Select value={draft.agent ?? EMPTY_MODEL_VALUE} onValueChange={handleAgentChange}>
                  <SelectTrigger
                    aria-label={translate(
                      'auto.components.maestro.MaestroDelegationDialog.1e7527e118',
                      'Agent'
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.maestro.MaestroDelegationDialog.d78ff4efd7',
                        'Choose agent'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_MODEL_VALUE}>
                      {translate(
                        'auto.components.maestro.MaestroDelegationDialog.9cef2ecee3',
                        'No agent selected'
                      )}
                    </SelectItem>
                    {catalog.agents.map((agent) => {
                      const agentIcon = iconAgent(agent.id)
                      return (
                        <SelectItem key={agent.id} value={agent.id} disabled={!agent.enabled}>
                          <span className="flex items-center gap-2">
                            {agentIcon ? <AgentIcon agent={agentIcon} size={14} /> : null}
                            <span>
                              {agent.label}
                              {!agent.enabled ? ` · ${agent.disabled_reason}` : ''}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {translate('auto.components.maestro.MaestroDelegationDialog.9d99fd1447', 'Model')}
                </Label>
                <Select
                  value={draft.model ?? EMPTY_MODEL_VALUE}
                  onValueChange={(value) =>
                    updateDraft('model', value === EMPTY_MODEL_VALUE ? null : value)
                  }
                >
                  <SelectTrigger
                    aria-label={translate(
                      'auto.components.maestro.MaestroDelegationDialog.9d99fd1447',
                      'Model'
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.maestro.MaestroDelegationDialog.253920d152',
                        'Catalog default'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_MODEL_VALUE}>
                      {translate(
                        'auto.components.maestro.MaestroDelegationDialog.253920d152',
                        'Catalog default'
                      )}
                    </SelectItem>
                    {modelOptions.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {translate(
                    'auto.components.maestro.MaestroDelegationDialog.0d738f593a',
                    'Effort'
                  )}
                </Label>
                <Select
                  value={draft.effort ?? EMPTY_MODEL_VALUE}
                  onValueChange={(value) =>
                    updateDraft(
                      'effort',
                      value === EMPTY_MODEL_VALUE
                        ? null
                        : (value as MaestroDelegationDraft['effort'])
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={translate(
                      'auto.components.maestro.MaestroDelegationDialog.0d738f593a',
                      'Effort'
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.maestro.MaestroDelegationDialog.253920d152',
                        'Catalog default'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_MODEL_VALUE}>
                      {translate(
                        'auto.components.maestro.MaestroDelegationDialog.253920d152',
                        'Catalog default'
                      )}
                    </SelectItem>
                    {(modelOptions.find((model) => model.id === draft.model)?.efforts ?? []).map(
                      (effort) => (
                        <SelectItem key={effort} value={effort}>
                          {effort}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-xs font-medium">
                    {translate(
                      'auto.components.maestro.MaestroDelegationDialog.7d6e846aeb',
                      'Permission mode:'
                    )}{' '}
                    {selectedAgent?.permission_mode ?? catalog.permission_mode.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {catalog.permission_mode.reason}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                {translate(
                  'auto.components.maestro.MaestroDelegationDialog.a92f91ea07',
                  'Placement'
                )}
              </Label>
              <Select
                value={placementKey(draft.placement)}
                onValueChange={(value) => {
                  const placement = placementFromKey(catalog, value)
                  if (placement) {
                    updateDraft('placement', placement)
                  }
                }}
              >
                <SelectTrigger
                  aria-label={translate(
                    'auto.components.maestro.MaestroDelegationDialog.a92f91ea07',
                    'Placement'
                  )}
                >
                  <SelectValue
                    placeholder={translate(
                      'auto.components.maestro.MaestroDelegationDialog.269b350c81',
                      'Choose placement'
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {enabledPlacements.map((entry) => (
                    <SelectItem
                      key={placementKey(entry.placement)}
                      value={placementKey(entry.placement)}
                    >
                      {entry.label || getPlacementLabel(entry.placement)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p>
                {translate(
                  'auto.components.maestro.MaestroDelegationDialog.1108a01d05',
                  'Context:'
                )}
                {source.kind === 'canvas-point'
                  ? translate(
                      'auto.components.maestro.MaestroDelegationDialog.f2090c17ef',
                      'empty Canvas point'
                    )
                  : translate(
                      'auto.components.maestro.MaestroDelegationDialog.b6eaaff3fd',
                      '{{value0}} context',
                      { value0: source.kind }
                    )}
              </p>
              <p className="mt-1 truncate font-mono" title={workspace.workspace_key}>
                {workspace.execution_host_id} / {workspace.workspace_key}
              </p>
            </div>
            {state === 'submitting' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />{' '}
                {translate(
                  'auto.components.maestro.MaestroDelegationDialog.ca0ee0fa44',
                  'Recording intent…'
                )}
              </p>
            ) : null}
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.maestro.MaestroDelegationDialog.f3765f5ffb', 'Cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {state === 'submitting'
              ? translate(
                  'auto.components.maestro.MaestroDelegationDialog.147af37bf7',
                  'Recording…'
                )
              : translate(
                  'auto.components.maestro.MaestroDelegationDialog.b5b77b323f',
                  'Request delegation'
                )}
          </Button>
        </DialogFooter>
        <p className="sr-only" aria-live="polite">
          {currentStateCopy.label}
        </p>
        {selectedAgent && !selectedAgent.enabled ? (
          <p className="text-xs text-destructive">{selectedAgent.disabled_reason}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
