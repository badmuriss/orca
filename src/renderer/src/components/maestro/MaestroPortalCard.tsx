import { ArrowUpRight, CornerUpLeft, Globe2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MaestroCanvasNode } from './MaestroCanvas'
import {
  MaestroStatusPill,
  MaestroWindowChrome,
  MaestroWindowFoot,
  maestroWindowRootProps
} from './MaestroWindowFrame'
import { maestroStateTone } from './maestro-window-model'
import { translate } from '@/i18n/i18n'

type CardProps = {
  node: MaestroCanvasNode
  selected: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  nodeRef: (element: HTMLButtonElement | null) => void
  reducedMotion?: boolean
}
function portalDestination(node: MaestroCanvasNode): { host: string; workspace: string } {
  return {
    host: node.destinationExecutionHostId ?? 'Unknown host',
    workspace: node.destinationWorkspaceKey ?? 'Unknown workspace'
  }
}

export function MaestroPortalCard({
  node,
  selected,
  onClick,
  onPointerDown,
  onKeyDown,
  nodeRef,
  reducedMotion = false
}: CardProps): React.JSX.Element {
  const destination = portalDestination(node)
  const DirectionIcon = node.portalDirection === 'back-to-home' ? CornerUpLeft : ArrowUpRight
  return (
    <button
      ref={nodeRef}
      type="button"
      {...maestroWindowRootProps({ selected, reducedMotion })}
      aria-pressed={selected}
      aria-label={`${node.title}, ${node.status}`}
      data-maestro-node={node.id}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <MaestroWindowChrome
        icon={<Globe2 className="size-3.5" aria-hidden />}
        title={node.title}
        trailing={<MaestroStatusPill label={node.status} tone={maestroStateTone(node.status)} />}
      />
      <span className="maestro-window-body gap-1.5 px-2.5 py-2">
        <span className="line-clamp-2 text-[11.5px] leading-[1.5] text-muted-foreground">
          {node.summary}
        </span>
        {/* Where the portal lands is the whole point, so it gets its own row. */}
        <span
          className="mt-auto flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-1.5 py-1 font-mono text-[10px] leading-4 text-foreground"
          title={`${destination.host} / ${destination.workspace}`}
        >
          <DirectionIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {destination.host} / {destination.workspace}
          </span>
        </span>
      </span>
      <MaestroWindowFoot
        typeLabel="Portal"
        detail={`from ${node.executionHostId ?? 'unknown'} / ${node.workspaceKey ?? 'unknown'}`}
      />
    </button>
  )
}
export function MaestroPortalInspector({
  node,
  onClose
}: {
  node: MaestroCanvasNode
  onClose: () => void
}): React.JSX.Element {
  const destination = portalDestination(node)
  return (
    <aside
      className="absolute bottom-3 right-3 z-20 w-[min(420px,calc(100%-24px))] overflow-hidden rounded-lg border border-border bg-card shadow-[0_10px_24px_rgb(0_0_0/0.18)]"
      aria-label={translate(
        'auto.components.maestro.MaestroPortalCard.75f8033b6e',
        'Workspace portal details'
      )}
    >
      <header className="flex items-center gap-2 border-b border-border bg-[color:var(--maestro-chrome)] px-3 py-2">
        <Globe2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroPortalCard.f670154dd7',
            'Close portal details'
          )}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="p-3">
        <p className="text-xs text-muted-foreground">
          {node.status} · {node.summary}
        </p>
        <dl className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">
            {translate('auto.components.maestro.MaestroPortalCard.3cab640f4c', 'From')}
          </dt>
          <dd
            className="truncate font-mono"
            title={`${node.executionHostId} / ${node.workspaceKey}`}
          >
            {node.executionHostId} / {node.workspaceKey}
          </dd>
          <dt className="text-muted-foreground">
            {translate('auto.components.maestro.MaestroPortalCard.8e22ddb454', 'To')}
          </dt>
          <dd
            className="truncate font-mono"
            title={`${destination.host} / ${destination.workspace}`}
          >
            {destination.host} / {destination.workspace}
          </dd>
        </dl>
      </div>
    </aside>
  )
}
