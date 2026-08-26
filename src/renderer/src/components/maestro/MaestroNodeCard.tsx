import { CircleCheckBig, CircleDot, OctagonX, StickyNote, TriangleAlert } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import type { MaestroCanvasNode } from './MaestroCanvas'
import {
  MaestroStatusPill,
  MaestroWindowChrome,
  MaestroWindowFoot,
  maestroWindowRootProps
} from './MaestroWindowFrame'
import {
  maestroAnnotationTones,
  readMaestroAnnotationTone,
  stripMaestroAnnotationMarker,
  type MaestroAnnotationTone
} from './maestro-annotation-tone'
import { maestroStateTone, maestroWindowTypeLabel } from './maestro-window-model'

type MaestroNodeCardProps = {
  node: MaestroCanvasNode
  selected: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void
  nodeRef: (element: HTMLButtonElement | null) => void
  reducedMotion: boolean
}

const TONE_ICON = {
  observation: StickyNote,
  highlight: StickyNote,
  decision: CircleCheckBig,
  warning: TriangleAlert,
  blocker: OctagonX
} as const satisfies Record<MaestroAnnotationTone, typeof StickyNote>

function toneLabel(tone: MaestroAnnotationTone): string {
  return maestroAnnotationTones().find((entry) => entry.tone === tone)?.label ?? 'Note'
}

function notePreview(markdown: string | undefined): string {
  const body = stripMaestroAnnotationMarker(markdown)
  if (!body.trim()) {
    return 'Write a bounded note for this workspace.'
  }
  const preview = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, ''))
    .join(' · ')
  return preview.length > 150 ? `${preview.slice(0, 147)}…` : preview
}

export function MaestroNodeCard({
  node,
  selected,
  onClick,
  onPointerDown,
  onKeyDown,
  onContextMenu,
  nodeRef,
  reducedMotion
}: MaestroNodeCardProps): React.JSX.Element {
  const isNote = node.kind === 'note'
  const tone = isNote ? readMaestroAnnotationTone(node.markdown) : 'observation'
  const ToneIcon = TONE_ICON[tone]
  return (
    <button
      ref={nodeRef}
      type="button"
      {...maestroWindowRootProps({ selected, reducedMotion, tone: isNote ? tone : undefined })}
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
          isNote ? (
            <ToneIcon className="size-3.5" aria-hidden />
          ) : node.agent ? (
            <AgentIcon agent={node.agent} size={13} />
          ) : (
            <CircleDot className="size-3.5" aria-hidden />
          )
        }
        title={node.title}
        trailing={
          isNote ? (
            // Colour states the attention level; the word names it. A plain
            // observation needs neither, so it keeps the whole chrome for its title.
            tone === 'observation' ? null : (
              <span
                className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-[0.05em]"
                style={{
                  color: 'var(--maestro-tone)',
                  background: 'color-mix(in srgb, var(--maestro-tone) 14%, transparent)'
                }}
              >
                {toneLabel(tone)}
              </span>
            )
          ) : (
            <MaestroStatusPill label={node.status} tone={maestroStateTone(node.status)} />
          )
        }
      />
      <span className="maestro-window-body px-2.5 py-2">
        {isNote ? (
          <span
            className="line-clamp-4 text-[11.5px] leading-[1.5] text-foreground"
            data-maestro-note-content
          >
            {notePreview(node.markdown)}
          </span>
        ) : (
          <span
            className="line-clamp-3 text-[11.5px] leading-[1.5] text-muted-foreground"
            title={node.summary}
          >
            {node.summary}
          </span>
        )}
      </span>
      <MaestroWindowFoot
        typeLabel={maestroWindowTypeLabel(node)}
        detail={
          isNote
            ? `rev ${node.noteRevision ?? 1}${node.contextSnapshotId ? ' · pinned context' : ''}`
            : [node.model, node.effort].filter(Boolean).join(' · ') ||
              node.role ||
              'identity linked'
        }
      />
    </button>
  )
}
