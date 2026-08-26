import {
  Archive,
  CircleAlert,
  CircleHelp,
  Clock3,
  MessageSquareText,
  PackageCheck,
  Pin,
  Play,
  SquareTerminal
} from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import type { MaestroCanvasNode } from './MaestroCanvas'
import {
  MaestroStatusPill,
  MaestroWindowChrome,
  MaestroWindowFoot,
  maestroWindowRootProps
} from './MaestroWindowFrame'
import { maestroStateTone, maestroWindowTypeLabel } from './maestro-window-model'
import { translate } from '@/i18n/i18n'

type Props = {
  node: MaestroCanvasNode
  selected: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void
  nodeRef: (element: HTMLButtonElement | null) => void
  reducedMotion?: boolean
}
function executionProfile(node: MaestroCanvasNode): string {
  const requested = [node.requestedAgent, node.requestedModel, node.requestedEffort]
    .filter(Boolean)
    .join('/')
  const resolved = [node.resolvedAgent, node.resolvedModel, node.resolvedEffort]
    .filter(Boolean)
    .join('/')
  return requested && resolved && requested !== resolved
    ? `${requested} → ${resolved}`
    : resolved || requested || 'Profile unavailable'
}
function visibleIdentity(node: MaestroCanvasNode): string {
  const parts = node.title.split(' · ')
  const agent = parts.at(-1) ?? 'Agent'
  if (node.role === 'coordinator') {
    const generation = parts.find((part) => part.toLowerCase().includes('coordinator'))
    return `${generation ?? 'Coordinator'} · ${agent}`
  }
  return `${parts[0] ?? node.title} · ${agent}`
}
function visibleExecutionProfile(node: MaestroCanvasNode): string {
  const profile = [
    node.resolvedModel ?? node.requestedModel,
    node.resolvedEffort ?? node.requestedEffort
  ]
    .filter(Boolean)
    .join(' · ')
  return [profile, node.executionHostId].filter(Boolean).join(' · ')
}
function StateIcon({ status }: { status: string }): React.JSX.Element {
  const normalized = status.toLowerCase().replaceAll(' ', '_')
  const Icon =
    normalized === 'running'
      ? Play
      : normalized === 'input_required'
        ? MessageSquareText
        : normalized === 'ready_to_release' || normalized === 'reclaimable'
          ? PackageCheck
          : normalized === 'archived' || normalized === 'released'
            ? Archive
            : normalized === 'retained'
              ? Pin
              : normalized === 'release_pending'
                ? Clock3
                : normalized === 'failed' || normalized === 'blocked'
                  ? CircleAlert
                  : normalized === 'queued'
                    ? Clock3
                    : CircleHelp
  return <Icon className="size-3 shrink-0" aria-hidden />
}

export function MaestroAgentCard({
  node,
  selected,
  onClick,
  onPointerDown,
  onKeyDown,
  onContextMenu,
  nodeRef,
  reducedMotion = false
}: Props): React.JSX.Element {
  const resource = [node.executionHostId, node.workspaceKey].filter(Boolean).join(' / ')
  const tone = maestroStateTone(node.status)
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
      onContextMenu={onContextMenu}
    >
      <MaestroWindowChrome
        icon={
          node.agent ? (
            <AgentIcon agent={node.agent} size={13} />
          ) : (
            <SquareTerminal className="size-3.5" aria-hidden />
          )
        }
        title={visibleIdentity(node)}
        trailing={<MaestroStatusPill label={node.status} tone={tone} />}
      />
      {/* The screen is what makes a terminal read as a terminal at a glance. */}
      <span className="maestro-window-body maestro-screen gap-1.5 px-2.5 py-2">
        <span className="maestro-screen-muted flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.05em]">
          <StateIcon status={node.status} />
          <span className="truncate">
            {node.role ??
              translate('auto.components.maestro.MaestroAgentCard.507110281e', 'terminal')}{' '}
            ·{' '}
            {node.agent ??
              translate(
                'auto.components.maestro.MaestroAgentCard.b055fc74ef',
                'provider unavailable'
              )}
          </span>
        </span>
        <span
          className="line-clamp-3 min-h-0 font-mono text-[11px] leading-[1.45]"
          title={node.summary}
        >
          {node.summary}
        </span>
      </span>
      <MaestroWindowFoot
        typeLabel={maestroWindowTypeLabel(node)}
        detail={visibleExecutionProfile(node) || executionProfile(node) || resource}
      />
    </button>
  )
}
