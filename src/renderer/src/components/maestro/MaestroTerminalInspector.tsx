import { Archive, CircleHelp, Pin, RefreshCw, TerminalSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import type { MaestroCanvasNode } from './MaestroCanvas'
import { maestroTerminalLifecycleViewModel } from './maestro-terminal-lifecycle-view-model'
import { translate } from '@/i18n/i18n'

type Props = {
  node: MaestroCanvasNode
  onClose: () => void
  onRetain?: () => void
  onRelease?: () => void
  onHandoffAndRelease?: () => void
}
export function hasLiveTerminal(node: MaestroCanvasNode): boolean {
  return node.live === true && Boolean(node.terminalId)
}
function LifecycleIcon({
  tone
}: {
  tone: ReturnType<typeof maestroTerminalLifecycleViewModel>['tone']
}): React.JSX.Element {
  const Icon =
    tone === 'released'
      ? Archive
      : tone === 'retained'
        ? Pin
        : tone === 'unknown'
          ? CircleHelp
          : tone === 'starting'
            ? RefreshCw
            : TerminalSquare
  return <Icon className={`size-3.5 ${tone === 'starting' ? 'animate-spin' : ''}`} aria-hidden />
}
export function MaestroTerminalInspector({
  node,
  onClose,
  onRetain,
  onRelease,
  onHandoffAndRelease
}: Props): React.JSX.Element {
  const live = hasLiveTerminal(node)
  const lifecycle = maestroTerminalLifecycleViewModel({
    status: node.status,
    role: node.role,
    live
  })
  // A row of permanently disabled buttons reads as a broken panel.
  const actions = [
    lifecycle.canRetain && onRetain
      ? {
          label: translate('auto.components.maestro.MaestroTerminalInspector.d1944a3f67', 'Retain'),
          onSelect: onRetain,
          primary: false
        }
      : null,
    lifecycle.canRelease && onRelease
      ? {
          label: translate(
            'auto.components.maestro.MaestroTerminalInspector.21bfe95a10',
            'Release terminal'
          ),
          onSelect: onRelease,
          primary: false
        }
      : null,
    lifecycle.canHandoffAndRelease && onHandoffAndRelease
      ? {
          label: translate(
            'auto.components.maestro.MaestroTerminalInspector.97c9366d3b',
            'Handoff and release'
          ),
          onSelect: onHandoffAndRelease,
          primary: true
        }
      : null
  ].filter((action): action is { label: string; onSelect: () => void; primary: boolean } =>
    Boolean(action)
  )
  return (
    <aside
      className="absolute bottom-16 right-3 z-20 flex w-[min(620px,calc(100%-24px))] max-[1500px]:w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_10px_24px_rgb(0_0_0/0.18)]"
      aria-label={translate(
        'auto.components.maestro.MaestroTerminalInspector.580c184989',
        'Selected terminal inspector'
      )}
    >
      <header className="flex items-start gap-2 border-b border-border bg-[color:var(--maestro-chrome)] px-3 py-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <LifecycleIcon tone={lifecycle.tone} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-medium leading-4">{node.title}</h2>
          <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="shrink-0 font-medium text-foreground">{lifecycle.label}</span>
            <span aria-hidden>·</span>
            <span className="truncate" title={lifecycle.description}>
              {lifecycle.description}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroTerminalInspector.3caf3aed74',
            'Close inspector'
          )}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      {/* A screen this tall is worth it only when there is output to show. */}
      {live && node.terminalId ? (
        <div className="maestro-screen h-64 min-h-0 p-2">
          {/* A preview that cannot attach must not take the board down with it. */}
          <RecoverableRenderErrorBoundary
            boundaryId="maestro-terminal-inspector-preview"
            surface="overlay"
            resetKey={node.terminalId}
            className="maestro-screen-muted"
            title={translate(
              'auto.components.maestro.MaestroTerminalInspector.20e06b842f',
              'Terminal output could not attach.'
            )}
            description={translate(
              'auto.components.maestro.MaestroTerminalInspector.5186f6dd27',
              'The terminal is still tracked here; open its own pane to read the session.'
            )}
          >
            <AgentTerminalPreview ptyId={node.terminalId} className="size-full" />
          </RecoverableRenderErrorBoundary>
        </div>
      ) : (
        <p className="maestro-screen maestro-screen-muted px-3 py-6 text-center text-xs">
          {translate(
            'auto.components.maestro.MaestroTerminalInspector.7319972f55',
            'Output is unavailable; Orca has not observed a live terminal.'
          )}
        </p>
      )}
      {actions.length ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.primary ? 'default' : 'outline'}
              size="sm"
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </aside>
  )
}
