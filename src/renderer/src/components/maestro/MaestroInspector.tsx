import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import type { MaestroCanvasNode } from './MaestroCanvas'
import { translate } from '@/i18n/i18n'

type MaestroInspectorProps = {
  node?: MaestroCanvasNode
  onClose: () => void
  progressIdentity?: MaestroRunProgressDetailIdentity | null
}

function identityTitle(
  identity: MaestroRunProgressDetailIdentity
): 'Finding' | 'Cleanup' | 'Attempt' | 'Task' {
  const { reference } = identity
  if (reference.finding_ref !== null) {
    return 'Finding'
  }
  if (reference.cleanup_id !== null) {
    return 'Cleanup'
  }
  if (reference.attempt_id !== null) {
    return 'Attempt'
  }
  return 'Task'
}

function referenceFields(identity: MaestroRunProgressDetailIdentity): readonly [string, string][] {
  const { authority, reference } = identity
  return [
    ['Run', authority.runId],
    ['Workspace', `${authority.workspace.executionHostId} / ${authority.workspace.workspaceKey}`],
    ['Revision', String(authority.revision)],
    ['Task', reference.task_id],
    ['Attempt', reference.attempt_id],
    ['Finding', reference.finding_ref],
    ['Cleanup', reference.cleanup_id]
  ].filter((entry): entry is [string, string] => entry[1] !== null)
}

export function MaestroInspector({
  node,
  onClose,
  progressIdentity = null
}: MaestroInspectorProps): React.JSX.Element {
  const title = node ? node.title : progressIdentity ? identityTitle(progressIdentity) : 'Inspector'
  const status = node?.status ?? 'Canonical identity'
  return (
    <aside
      className="absolute right-3 top-3 z-10 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-xs"
      aria-label={translate(
        'auto.components.maestro.MaestroInspector.ce7c7a38f1',
        'Selected node details'
      )}
    >
      <div className="flex items-start gap-2 border-b border-border bg-[color:var(--maestro-chrome)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-medium leading-4 text-foreground">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{status}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroInspector.86a4c83b9e',
            'Close details'
          )}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="p-3">
        {node ? (
          <p className="text-[12px] leading-5 text-muted-foreground">{node.summary}</p>
        ) : null}
        {progressIdentity ? (
          <dl className={`space-y-1.5 text-[11px] text-muted-foreground ${node ? 'mt-3' : ''}`}>
            {referenceFields(progressIdentity).map(([label, value]) => (
              <div key={label} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2">
                <dt>{label}</dt>
                <dd className="break-all font-mono text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </aside>
  )
}
