import { FileCode2, Focus, Globe2, Link2, MonitorUp, TerminalSquare, X } from 'lucide-react'
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
  linkTargetMode: boolean
  runtimeTarget: RuntimeClientTarget
  onSelect: () => void
  onActivate: () => void
  onFocus: () => void
  onClose: () => void
  onMove: (delta: { x: number; y: number }) => void
  onResize: (delta: { x: number; y: number }) => void
  onMoveCommit: (delta: { x: number; y: number }) => void
  onResizeCommit: (delta: { x: number; y: number }) => void
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
  interactive: boolean
): React.JSX.Element {
  const binding = surface.binding
  if (binding.kind === 'terminal') {
    if (binding.session_id && binding.liveness === 'live' && interactive) {
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
                'Select this window to attach its single interactive preview.'
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
  return <MaestroWorkspaceContentPreview target={runtimeTarget} surface={surface} />
}

function startPointerGesture(
  event: React.PointerEvent,
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
    const delta = { x: moveEvent.clientX - origin.x, y: moveEvent.clientY - origin.y }
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
  linkTargetMode,
  runtimeTarget,
  onSelect,
  onActivate,
  onFocus,
  onClose,
  onMove,
  onResize,
  onMoveCommit,
  onResizeCommit
}: MaestroWorkspaceWindowProps): React.JSX.Element {
  const Icon = SURFACE_ICON[surface.content_type]
  return (
    <article
      className="absolute flex overflow-hidden rounded-lg border bg-card shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        left: placement.position.x,
        top: placement.position.y,
        width: placement.size.width,
        height: placement.size.height,
        zIndex: placement.z_order,
        borderColor: selected ? 'var(--ring)' : 'var(--border)'
      }}
      data-maestro-workspace-surface={surfaceKey}
      data-maestro-workspace-tab-id={surface.id.unified_tab_id}
      data-maestro-workspace-content-type={surface.content_type}
      data-maestro-browser-page-id={
        surface.binding.kind === 'browser' ? surface.binding.browser_page_id : undefined
      }
      data-availability={surface.availability}
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onSelect()
          onActivate()
        }
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onSelect()
        }
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-8 shrink-0 cursor-move items-center gap-2 border-b border-border bg-muted/40 px-2"
          onPointerDown={(event) => {
            onSelect()
            startPointerGesture(event, onMove, onMoveCommit)
          }}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{surface.title}</span>
          {surface.availability !== 'available' ? (
            <span className="text-[10px] font-medium text-muted-foreground">
              {surface.availability}
            </span>
          ) : null}
          {linkTargetMode ? (
            <Button
              size="icon-xs"
              variant="outline"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onActivate()
              }}
            >
              <Link2 />
              <span className="sr-only">
                {translate(
                  'auto.components.maestro.MaestroWorkspaceWindow.5669ee8b7f',
                  'Link to this surface'
                )}
              </span>
            </Button>
          ) : null}
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
        <div className="min-h-0 flex-1">{bindingDetail(surface, runtimeTarget, selected)}</div>
      </div>
      <button
        type="button"
        className="absolute bottom-1 right-1 size-4 cursor-se-resize rounded-sm border border-border bg-muted text-muted-foreground shadow-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring after:absolute after:bottom-[3px] after:right-[3px] after:size-1.5 after:border-b after:border-r after:border-current"
        aria-label={translate(
          'auto.components.maestro.MaestroWorkspaceWindow.14b6f795aa',
          'Resize {{value0}}',
          { value0: surface.title }
        )}
        onPointerDown={(event) => {
          onSelect()
          startPointerGesture(event, onResize, onResizeCommit)
        }}
      />
    </article>
  )
}
