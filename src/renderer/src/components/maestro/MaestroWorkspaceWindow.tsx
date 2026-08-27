import {
  FileCode2,
  Focus,
  Globe2,
  Link2,
  MonitorUp,
  TerminalSquare,
  TextCursorInput,
  Workflow,
  X
} from 'lucide-react'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { MaestroWorkspaceWindowPlacement } from './maestro-workspace-window-layout'
import { translate } from '@/i18n/i18n'
import type { MaestroWorkspacePresencePhase } from './maestro-workspace-presence'
import type { MaestroWorkspacePreviewMode } from './maestro-workspace-visibility'
import { MaestroWorkspaceSurfacePreview } from './MaestroWorkspaceSurfacePreview'
import { maestroTerminalSurfacePaneKey } from './maestro-agent-terminal-bindings'

type MaestroWorkspaceWindowProps = {
  surfaceKey: string
  surface: WorkspaceSurface
  placement: MaestroWorkspaceWindowPlacement
  selected: boolean
  pending: boolean
  linkTarget: boolean
  runtimeTarget: RuntimeClientTarget
  // Canvas zoom, so screen-px drag deltas can be converted into world placement units.
  worldZoom?: number
  presencePhase?: MaestroWorkspacePresencePhase
  previewMode?: MaestroWorkspacePreviewMode
  agentFunctionLabel?: string
  agentRole?: 'coordinator' | 'worker'
  onSelect: () => void
  onEdit: () => void
  onLinkPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onFocus: () => void
  onClose: () => void
  onMoveCommit: (delta: { x: number; y: number }) => void
  onResizeCommit: (delta: { x: number; y: number }) => void
  onUpdateAnnotationTone: (tone: 'decision' | 'warning' | 'blocked' | 'observation') => void
  onUpdateAnnotationContent?: (content: string) => void
}

const SURFACE_ICON = {
  terminal: TerminalSquare,
  browser: Globe2,
  editor: FileCode2,
  diff: FileCode2,
  'conflict-review': FileCode2,
  'check-details': FileCode2,
  simulator: MonitorUp
} as const

function startPointerGesture(
  event: React.PointerEvent,
  worldZoom: number,
  placement: MaestroWorkspaceWindowPlacement,
  kind: 'move' | 'resize',
  onCommit: (delta: { x: number; y: number }) => void
): void {
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget
  const windowElement = target.closest<HTMLElement>('[data-maestro-workspace-surface]')
  if (!windowElement) {
    return
  }
  const gesturePreview = windowElement.querySelector<HTMLElement>(
    '[data-maestro-workspace-gesture-preview]'
  )
  const origin = { x: event.clientX, y: event.clientY }
  const total = { x: 0, y: 0 }
  let moveFrame: number | null = null
  target.setPointerCapture(event.pointerId)
  const paintGesture = (): void => {
    moveFrame = null
    if (!gesturePreview) {
      return
    }
    gesturePreview.style.opacity = '1'
    if (kind === 'move') {
      gesturePreview.style.transform = `translate(${total.x}px, ${total.y}px)`
    } else {
      const width = Math.max(240, placement.size.width + total.x)
      const height = Math.max(150, placement.size.height + total.y)
      gesturePreview.style.transform = `scale(${width / placement.size.width}, ${height / placement.size.height})`
    }
  }
  const move: EventListener = (moveEvent): void => {
    if (!(moveEvent instanceof PointerEvent)) {
      return
    }
    const delta = {
      x: (moveEvent.clientX - origin.x) / worldZoom,
      y: (moveEvent.clientY - origin.y) / worldZoom
    }
    total.x += delta.x
    total.y += delta.y
    if (moveFrame === null) {
      moveFrame = requestAnimationFrame(paintGesture)
    }
    origin.x = moveEvent.clientX
    origin.y = moveEvent.clientY
  }
  const finish = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', finish)
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame)
    }
    paintGesture()
    if (total.x !== 0 || total.y !== 0) {
      onCommit(total)
    }
    requestAnimationFrame(() => {
      if (gesturePreview) {
        gesturePreview.style.opacity = ''
        gesturePreview.style.transform = ''
      }
    })
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', finish)
  target.addEventListener('pointercancel', finish)
}

export function MaestroWorkspaceWindow({
  surfaceKey,
  surface,
  placement,
  selected,
  pending,
  linkTarget,
  runtimeTarget,
  worldZoom = 1,
  presencePhase = 'present',
  previewMode = 'full',
  agentFunctionLabel,
  agentRole,
  onSelect,
  onEdit,
  onLinkPointerDown,
  onFocus,
  onClose,
  onMoveCommit,
  onResizeCommit,
  onUpdateAnnotationTone,
  onUpdateAnnotationContent
}: MaestroWorkspaceWindowProps): React.JSX.Element {
  const Icon = SURFACE_ICON[surface.content_type]
  const normalizedFunction = agentFunctionLabel?.trim()
  const roleLabel =
    agentRole === 'coordinator'
      ? translate('auto.components.maestro.MaestroWorkspaceWindow.coordinator', 'Orchestrator')
      : agentRole === 'worker'
        ? translate('auto.components.maestro.MaestroWorkspaceWindow.worker', 'Worker')
        : null
  const functionLabel =
    roleLabel && normalizedFunction && normalizedFunction !== surface.title
      ? `${roleLabel} · ${normalizedFunction}`
      : roleLabel
  return (
    <article
      className={`maestro-workspace-window absolute flex overflow-visible rounded-xl border bg-card shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'ring-1 ring-ring/35' : ''}`}
      style={{
        left: placement.position.x,
        top: placement.position.y,
        width: placement.size.width,
        height: placement.size.height,
        zIndex: placement.z_order,
        borderColor: linkTarget
          ? 'var(--status-success)'
          : selected
            ? 'var(--ring)'
            : 'var(--border)'
      }}
      data-maestro-workspace-surface={surfaceKey}
      data-maestro-workspace-tab-id={surface.id.unified_tab_id}
      data-maestro-workspace-content-type={surface.content_type}
      data-maestro-browser-page-id={
        surface.binding.kind === 'browser' ? surface.binding.browser_page_id : undefined
      }
      data-maestro-link-target={linkTarget ? 'true' : undefined}
      data-availability={surface.availability}
      data-maestro-presence={presencePhase}
      data-maestro-preview-mode={previewMode}
      data-maestro-agent-role={agentRole}
      data-maestro-agent-function={normalizedFunction}
      data-maestro-terminal-pane-key={
        surface.binding.kind === 'terminal' ? maestroTerminalSurfacePaneKey(surface) : undefined
      }
      aria-busy={presencePhase === 'entering'}
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onSelect()
        }
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onSelect()
        }
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
        <header
          className="flex h-10 shrink-0 cursor-move items-center gap-2 border-b border-border/80 bg-muted/35 px-2.5"
          onPointerDown={(event) => {
            onSelect()
            startPointerGesture(event, worldZoom, placement, 'move', onMoveCommit)
          }}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70">
            <Icon className="size-3 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-xs font-semibold leading-4">{surface.title}</span>
            {functionLabel ? (
              <span className="flex min-w-0 items-center gap-1 truncate text-[9px] font-semibold uppercase leading-3 tracking-[0.08em] text-muted-foreground">
                <Workflow className="size-2.5 shrink-0" />
                <span className="truncate">{functionLabel}</span>
              </span>
            ) : null}
          </span>
          {surface.availability !== 'available' ? (
            <span className="text-[10px] font-medium text-muted-foreground">
              {surface.availability}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onEdit()
                }}
              >
                <TextCursorInput />
                <span className="sr-only">
                  {translate(
                    'auto.components.maestro.MaestroWorkspaceWindow.97d6f5fe39',
                    'Rename tab'
                  )}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.maestro.MaestroWorkspaceWindow.97d6f5fe39', 'Rename tab')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onFocus()
                }}
                disabled={pending}
              >
                <Focus />
                <span className="sr-only">
                  {translate(
                    'auto.components.maestro.MaestroWorkspaceWindow.e825702fbf',
                    'Focus exact tab'
                  )}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate(
                'auto.components.maestro.MaestroWorkspaceWindow.e825702fbf',
                'Focus exact tab'
              )}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose()
                }}
                disabled={pending}
              >
                <X />
                <span className="sr-only">
                  {translate(
                    'auto.components.maestro.MaestroWorkspaceWindow.7f9b469dba',
                    'Close exact tab'
                  )}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate(
                'auto.components.maestro.MaestroWorkspaceWindow.7f9b469dba',
                'Close exact tab'
              )}
            </TooltipContent>
          </Tooltip>
        </header>
        <div className="min-h-0 flex-1">
          <MaestroWorkspaceSurfacePreview
            surface={surface}
            runtimeTarget={runtimeTarget}
            previewMode={previewMode}
            agentFunctionLabel={normalizedFunction}
            agentRole={agentRole}
            onUpdateAnnotationTone={onUpdateAnnotationTone}
            onUpdateAnnotationContent={onUpdateAnnotationContent}
          />
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="group absolute -right-2 top-1/2 z-10 flex size-5 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs outline-none transition hover:scale-110 hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={translate(
              'auto.components.maestro.MaestroWorkspaceWindow.39b239dd72',
              'Drag a link from {{value0}}',
              { value0: surface.title }
            )}
            onPointerDown={onLinkPointerDown}
            onClick={(event) => event.preventDefault()}
          >
            <Link2 className="size-2.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {translate(
            'auto.components.maestro.MaestroWorkspaceWindow.c8d0b36e56',
            'Drag to another window to link'
          )}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        className="absolute bottom-1 right-1 z-10 size-5 cursor-se-resize rounded-md border border-border/80 bg-card/90 text-muted-foreground shadow-xs outline-none transition hover:border-ring hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring after:absolute after:bottom-[4px] after:right-[4px] after:size-2 after:border-b-2 after:border-r-2 after:border-current"
        aria-label={translate(
          'auto.components.maestro.MaestroWorkspaceWindow.14b6f795aa',
          'Resize {{value0}}',
          { value0: surface.title }
        )}
        onPointerDown={(event) => {
          onSelect()
          startPointerGesture(event, worldZoom, placement, 'resize', onResizeCommit)
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-20 origin-top-left rounded-xl border border-ring/70 bg-ring/[0.03] opacity-0 shadow-sm will-change-transform"
        data-maestro-workspace-gesture-preview
        aria-hidden
      />
      {presencePhase !== 'present' ? (
        <div className="maestro-workspace-smoke" aria-hidden>
          <span />
        </div>
      ) : null}
    </article>
  )
}
