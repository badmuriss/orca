import { TerminalSquare } from 'lucide-react'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { MaestroWorkspaceBrowserPreview } from './MaestroWorkspaceBrowserPreview'
import { MaestroWorkspaceContentPreview } from './MaestroWorkspaceContentPreview'
import type { MaestroWorkspacePreviewMode } from './maestro-workspace-visibility'

type MaestroWorkspaceSurfacePreviewProps = {
  surface: WorkspaceSurface
  runtimeTarget: RuntimeClientTarget
  previewMode: MaestroWorkspacePreviewMode
  onUpdateAnnotationTone: (tone: 'decision' | 'warning' | 'blocked' | 'observation') => void
  onUpdateAnnotationContent?: (content: string) => void
}

function LowDetailSurfacePreview({
  surface,
  previewMode
}: Pick<MaestroWorkspaceSurfacePreviewProps, 'surface' | 'previewMode'>): React.JSX.Element {
  const detail =
    previewMode === 'identity'
      ? translate(
          'auto.components.maestro.MaestroWorkspaceWindow.previewIdentity',
          'Live preview hidden at this zoom'
        )
      : translate(
          'auto.components.maestro.MaestroWorkspaceWindow.previewSuspended',
          'Preview paused outside the viewport'
        )
  return (
    <div
      className="flex size-full flex-col items-center justify-center bg-muted/20 p-4 text-center"
      data-maestro-preview-placeholder={previewMode}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {surface.content_type}
      </span>
      <p className="mt-2 max-w-[28ch] truncate text-xs font-medium text-foreground">
        {surface.title}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      {surface.binding.kind === 'terminal' ? (
        <span className="mt-2 text-[10px] text-muted-foreground">{surface.binding.liveness}</span>
      ) : null}
    </div>
  )
}

export function MaestroWorkspaceSurfacePreview({
  surface,
  runtimeTarget,
  previewMode,
  onUpdateAnnotationTone,
  onUpdateAnnotationContent
}: MaestroWorkspaceSurfacePreviewProps): React.JSX.Element {
  if (previewMode !== 'full') {
    return <LowDetailSurfacePreview surface={surface} previewMode={previewMode} />
  }
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
          <AgentTerminalPreview
            ptyId={binding.session_id}
            autoFocus={false}
            mode="passive"
            className="size-full"
          />
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
      onUpdateAnnotationContent={onUpdateAnnotationContent}
    />
  )
}
