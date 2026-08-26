import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurfaceSnapshot } from '../../../../shared/maestro-workspace-canvas'
import type { MaestroWorkspaceWindowPlacement } from './maestro-workspace-window-layout'
import { translate } from '@/i18n/i18n'

type LinkLine = {
  id: string
  source: string
  target: string
  provenance: 'manual' | 'automatic' | 'suggested'
}

function linkLines(
  snapshot: WorkspaceSurfaceSnapshot,
  document: WorkspaceCanvasDocument
): LinkLine[] {
  return [
    ...document.manual_links.map((link) => ({
      id: link.id,
      source: link.source_surface_key,
      target: link.target_surface_key,
      provenance: 'manual' as const
    })),
    ...snapshot.automatic_links.map((link) => ({
      id: link.id,
      source: link.source_surface_key,
      target: link.target_surface_key,
      provenance: 'automatic' as const
    })),
    ...snapshot.suggested_links
      .filter((link) => !document.suggestion_decisions[link.fingerprint])
      .map((link) => ({
        id: link.fingerprint,
        source: link.source_surface_key,
        target: link.target_surface_key,
        provenance: 'suggested' as const
      }))
  ]
}

function center(placement: MaestroWorkspaceWindowPlacement): { x: number; y: number } {
  return {
    x: placement.position.x + placement.size.width / 2,
    y: placement.position.y + placement.size.height / 2
  }
}

export function MaestroWorkspaceLinks({
  snapshot,
  document,
  placements,
  style
}: {
  snapshot: WorkspaceSurfaceSnapshot
  document: WorkspaceCanvasDocument
  placements: Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <svg className="pointer-events-none absolute overflow-visible" style={style} aria-hidden>
      {linkLines(snapshot, document).map((link) => {
        const source = placements[link.source]
        const target = placements[link.target]
        if (!source || !target) {
          return null
        }
        const from = center(source)
        const to = center(target)
        const curve = Math.max(60, Math.abs(to.x - from.x) / 2)
        const label =
          link.provenance === 'manual'
            ? translate('auto.components.maestro.MaestroWorkspaceInspector.812d58dbea', 'Manual')
            : link.provenance === 'automatic'
              ? translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.07e9ddcb64',
                  'Automatic'
                )
              : translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.f7bb7c2d65',
                  'Suggestion'
                )
        const labelWidth = label.length * 7 + 16
        const labelX = (from.x + to.x) / 2
        const labelY = (from.y + to.y) / 2
        return (
          <g key={`${link.provenance}:${link.id}`} data-link-provenance={link.provenance}>
            <path
              d={`M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth={link.provenance === 'automatic' ? 2 : 1.5}
              strokeDasharray={
                link.provenance === 'manual'
                  ? undefined
                  : link.provenance === 'suggested'
                    ? '3 5'
                    : '8 4'
              }
              opacity={link.provenance === 'suggested' ? 0.45 : 0.75}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={labelX - labelWidth / 2}
              y={labelY - 10}
              width={labelWidth}
              height={20}
              rx={6}
              fill="var(--card)"
              stroke="var(--border)"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={labelX}
              y={labelY + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
