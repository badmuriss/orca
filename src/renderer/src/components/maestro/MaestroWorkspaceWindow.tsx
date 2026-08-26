import { FileCode2, Focus, Globe2, Link2, MonitorUp, Pencil, TerminalSquare, X } from 'lucide-react'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { MaestroWorkspaceBrowserPreview } from './MaestroWorkspaceBrowserPreview'
import { MaestroWorkspaceContentPreview } from './MaestroWorkspaceContentPreview'
import type { MaestroWorkspaceWindowPlacement } from './maestro-workspace-window-layout'
import { translate } from '@/i18n/i18n'

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
  onSelect: () => void
  onEdit: () => void
  onLinkPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onFocus: () => void
  onClose: () => void
  onMove: (delta: { x: number; y: number }) => void
  onResize: (delta: { x: number; y: number }) => void
  onMoveCommit: (delta: { x: number; y: number }) => void
  onResizeCommit: (delta: { x: number; y: number }) => void
  onUpdateAnnotationTone: (tone: 'decision' | 'warning' | 'blocked' | 'observation') => void
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

function bindingDetail(
  surface: WorkspaceSurface,
  runtimeTarget: RuntimeClientTarget,
  onUpdateAnnotationTone: MaestroWorkspaceWindowProps['onUpdateAnnotationTone']
): React.JSX.Element {
  const binding = surface.binding
  if (binding.kind === 'terminal') {
    if (binding.session_id && binding.liveness === 'live') {
      return (
        <RecoverableRenderErrorBoundary
          boundaryId={`maestro-workspace-terminal-${binding.session_id}`}
          surface="overlay"
          resetKey={`${binding.session_id}:${binding.pty_incarnation ?? 'unknown'}`}
          title={translate(
            'auto.components.maestro.MaestroWorkspaceWindow.52cce7f247',
            'Terminal output could not attach.'
          )}
          description={translate(
            'auto.components.maestro.MaestroWorkspaceWindow.c6b6befac1',
            'The exact terminal remains available in its own tab.'
          )}
        >
          <AgentTerminalPreview ptyId={binding.session_id} className="size-full" />
        </RecoverableRenderErrorBoundary>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--terminal-pane-surface-on-dark)] p-3 text-center text-xs text-[var(--terminal-pane-title-on-dark-fg)]">
        <TerminalSquare className="size-5" />
        <p className="mt-2">
          {binding.liveness === 'live'
            ? translate(
                'auto.components.maestro.MaestroWorkspaceWindow.1ac69faf69',
                'The live terminal preview is reconnecting.'
              )
            : translate(
                'auto.components.maestro.MaestroWorkspaceWindow.37f9e2104d',
                'Terminal output is {{value0}}.',
                { value0: binding.liveness }
              )}
        </p>
      </div>
    )
  }
  if (binding.kind === 'browser') {
    const receiptRevision =
      binding.live_frame?.frame_revision ??
      binding.immutable_capture?.page_revision ??
      binding.authority_revision
    return (
      <MaestroWorkspaceBrowserPreview
        target={runtimeTarget}
        pageId={binding.browser_page_id}
        receiptRevision={receiptRevision}
      />
    )
  }
  return (
    <MaestroWorkspaceContentPreview
      target={runtimeTarget}
      surface={surface}
      onUpdateAnnotationTone={onUpdateAnnotationTone}
    />
  )
}

function startPointerGesture(
  event: React.PointerEvent,
  worldZoom: number,
  onDelta: (delta: { x: number; y: number }) => void,
  onCommit: (delta: { x: number; y: number }) => void
): void {
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget
  const origin = { x: event.clientX, y: event.clientY }
  const total = { x: 0, y: 0 }
  target.setPointerCapture(event.pointerId)
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
    onDelta(delta)
    origin.x = moveEvent.clientX
    origin.y = moveEvent.clientY
  }
  const finish = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', finish)
    if (total.x !== 0 || total.y !== 0) {
      onCommit(total)
    }
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
  onSelect,
  onEdit,
  onLinkPointerDown,
  onFocus,
  onClose,
  onMove,
  onResize,
  onMoveCommit,
  onResizeCommit,
  onUpdateAnnotationTone
}: MaestroWorkspaceWindowProps): React.JSX.Element {
  const Icon = SURFACE_ICON[surface.content_type]
  return (
    <article
      className={`absolute flex overflow-visible rounded-xl border bg-card shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'ring-1 ring-ring/35' : ''}`}
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
          className="flex h-9 shrink-0 cursor-move items-center gap-2 border-b border-border/80 bg-muted/35 px-2.5"
          onPointerDown={(event) => {
            onSelect()
            startPointerGesture(event, worldZoom, onMove, onMoveCommit)
          }}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70">
            <Icon className="size-3 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{surface.title}</span>
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
                <Pencil />
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
          {bindingDetail(surface, runtimeTarget, onUpdateAnnotationTone)}
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
          startPointerGesture(event, worldZoom, onResize, onResizeCommit)
        }}
      />
    </article>
  )
}
