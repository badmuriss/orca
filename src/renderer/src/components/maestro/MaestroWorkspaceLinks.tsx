import { memo } from 'react'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurfaceSnapshot } from '../../../../shared/maestro-workspace-canvas'
import type { CanvasAgentRelation, CanvasAgentTopology } from './maestro-agent-topology'
import type { MaestroWorkspaceWindowPlacement } from './maestro-workspace-window-layout'
import { translate } from '@/i18n/i18n'

type LinkKind = CanvasAgentRelation['kind'] | 'manual' | 'automatic'
type LinkLine = {
  id: string
  source: string
  target: string
  kind: LinkKind
  provenance: 'manual' | 'automatic' | CanvasAgentRelation['provenance']
}

export type OptimisticMaestroManualLink = Pick<LinkLine, 'id' | 'source' | 'target'>
const NO_OPTIMISTIC_MANUAL_LINKS: readonly OptimisticMaestroManualLink[] = []

function relationEndpoint(
  relation: Pick<CanvasAgentRelation, 'sourceSurfaceId' | 'targetSurfaceId'>
) {
  return `${relation.sourceSurfaceId}\0${relation.targetSurfaceId}`
}

function unorderedEndpoint(source: string, target: string): string {
  return source < target ? `${source}\0${target}` : `${target}\0${source}`
}

function topologyLines(topology: CanvasAgentTopology): LinkLine[] {
  const semanticEndpoints = new Set(
    topology.relations
      .filter((relation) => relation.kind !== 'coordinates')
      .map((relation) => relationEndpoint(relation))
  )
  return topology.relations.flatMap((relation) =>
    relation.kind === 'coordinates' && semanticEndpoints.has(relationEndpoint(relation))
      ? []
      : [
          {
            id: relation.id,
            source: relation.sourceSurfaceId,
            target: relation.targetSurfaceId,
            kind: relation.kind,
            provenance: relation.provenance
          }
        ]
  )
}

function linkLines(
  snapshot: WorkspaceSurfaceSnapshot,
  document: WorkspaceCanvasDocument,
  topology: CanvasAgentTopology,
  optimisticManualLinks: readonly OptimisticMaestroManualLink[]
): LinkLine[] {
  const topologyLinks = topologyLines(topology)
  const delegatedPairs = new Set(
    topologyLinks
      .filter((link) => link.kind === 'delegates')
      .map((link) => unorderedEndpoint(link.source, link.target))
  )
  return [
    ...document.manual_links.map((link) => ({
      id: link.id,
      source: link.source_surface_key,
      target: link.target_surface_key,
      kind: 'manual' as const,
      provenance: 'manual' as const
    })),
    ...optimisticManualLinks
      .filter(
        (link) =>
          !document.manual_links.some(
            (confirmed) =>
              confirmed.source_surface_key === link.source &&
              confirmed.target_surface_key === link.target
          )
      )
      .map((link) => ({ ...link, kind: 'manual' as const, provenance: 'manual' as const })),
    ...snapshot.automatic_links
      .filter(
        (link) =>
          link.link_type !== 'parent-child' ||
          !delegatedPairs.has(unorderedEndpoint(link.source_surface_key, link.target_surface_key))
      )
      .map((link) => ({
        id: link.id,
        source: link.source_surface_key,
        target: link.target_surface_key,
        kind: 'automatic' as const,
        provenance: 'automatic' as const
      })),
    ...topologyLinks
  ]
}

function center(placement: MaestroWorkspaceWindowPlacement): { x: number; y: number } {
  return {
    x: placement.position.x + placement.size.width / 2,
    y: placement.position.y + placement.size.height / 2
  }
}

function edgeAnchor(
  placement: MaestroWorkspaceWindowPlacement,
  toward: { x: number; y: number }
): { x: number; y: number } {
  const origin = center(placement)
  const delta = { x: toward.x - origin.x, y: toward.y - origin.y }
  if (delta.x === 0 && delta.y === 0) {
    return { x: origin.x + placement.size.width / 2, y: origin.y }
  }
  const xScale =
    delta.x === 0 ? Number.POSITIVE_INFINITY : placement.size.width / 2 / Math.abs(delta.x)
  const yScale =
    delta.y === 0 ? Number.POSITIVE_INFINITY : placement.size.height / 2 / Math.abs(delta.y)
  const scale = Math.min(xScale, yScale)
  return { x: origin.x + delta.x * scale, y: origin.y + delta.y * scale }
}

function linkGeometry(
  source: MaestroWorkspaceWindowPlacement,
  target: MaestroWorkspaceWindowPlacement
): { path: string; label: { x: number; y: number } } {
  const sourceCenter = center(source)
  const targetCenter = center(target)
  const from = edgeAnchor(source, targetCenter)
  const to = edgeAnchor(target, sourceCenter)
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  const path = horizontal
    ? `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`
  return { path, label: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } }
}

function linkPresentation(kind: LinkKind): {
  label: string | null
  width: number
  dash?: string
  opacity: number
} {
  if (kind === 'coordinates') {
    return { label: null, width: 1, dash: '3 6', opacity: 0.38 }
  }
  const labels: Record<Exclude<LinkKind, 'coordinates'>, string> = {
    delegates: translate('auto.components.maestro.links.delegates', 'Delegates'),
    'depends-on': translate('auto.components.maestro.links.dependsOn', 'Depends on'),
    'reports-to': translate('auto.components.maestro.links.reportsTo', 'Reports to'),
    'context-for': translate('auto.components.maestro.links.contextFor', 'Context'),
    manual: translate('auto.components.maestro.MaestroWorkspaceInspector.812d58dbea', 'Manual'),
    automatic: translate(
      'auto.components.maestro.MaestroWorkspaceInspector.07e9ddcb64',
      'Automatic'
    )
  }
  const patterns: Partial<Record<LinkKind, string>> = {
    'depends-on': '7 4',
    'reports-to': '2 4',
    'context-for': '5 5',
    automatic: '8 4'
  }
  return {
    label: labels[kind],
    width: kind === 'delegates' || kind === 'manual' ? 1.75 : 1.4,
    dash: patterns[kind],
    opacity: kind === 'delegates' ? 0.76 : 0.68
  }
}

export const MaestroWorkspaceLinks = memo(function MaestroWorkspaceLinks({
  snapshot,
  document,
  placements,
  topology,
  optimisticManualLinks = NO_OPTIMISTIC_MANUAL_LINKS,
  selectedSurfaceKey,
  style
}: {
  snapshot: WorkspaceSurfaceSnapshot
  document: WorkspaceCanvasDocument
  placements: Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
  topology: CanvasAgentTopology
  optimisticManualLinks?: readonly OptimisticMaestroManualLink[]
  selectedSurfaceKey?: string | null
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <svg className="pointer-events-none absolute overflow-visible" style={style} aria-hidden>
      {linkLines(snapshot, document, topology, optimisticManualLinks).map((link) => {
        const source = placements[link.source]
        const target = placements[link.target]
        if (!source || !target) {
          return null
        }
        const incident = selectedSurfaceKey === link.source || selectedSurfaceKey === link.target
        const presentation = linkPresentation(link.kind)
        const geometry = linkGeometry(source, target)
        const labelWidth = presentation.label ? presentation.label.length * 6.5 + 16 : 0
        const opacity = selectedSurfaceKey
          ? incident
            ? Math.min(1, presentation.opacity + 0.2)
            : presentation.opacity * 0.34
          : presentation.opacity
        return (
          <g
            key={`${link.provenance}:${link.id}`}
            data-link-provenance={link.provenance}
            data-link-kind={link.kind}
            data-link-source={link.source}
            data-link-target={link.target}
            data-link-selected={incident ? 'true' : undefined}
          >
            <title>{presentation.label ?? 'Coordinates'}</title>
            <path
              d={geometry.path}
              fill="none"
              stroke={
                incident
                  ? 'var(--ring)'
                  : link.kind === 'delegates'
                    ? 'color-mix(in srgb, var(--ring) 48%, var(--muted-foreground))'
                    : 'var(--muted-foreground)'
              }
              strokeWidth={presentation.width}
              strokeDasharray={presentation.dash}
              opacity={opacity}
              vectorEffect="non-scaling-stroke"
            />
            {presentation.label ? (
              <>
                <rect
                  x={geometry.label.x - labelWidth / 2}
                  y={geometry.label.y - 9}
                  width={labelWidth}
                  height={18}
                  rx={6}
                  fill="var(--card)"
                  stroke="var(--border)"
                  opacity={selectedSurfaceKey && !incident ? 0.38 : 0.92}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={geometry.label.x}
                  y={geometry.label.y + 3.5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--foreground)"
                  opacity={selectedSurfaceKey && !incident ? 0.42 : 0.88}
                >
                  {presentation.label}
                </text>
              </>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
})
