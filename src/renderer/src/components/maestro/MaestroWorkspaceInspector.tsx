import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffect, useState } from 'react'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type {
  WorkspaceSurface,
  WorkspaceSurfaceSnapshot
} from '../../../../shared/maestro-workspace-canvas'
import { translate } from '@/i18n/i18n'

export function MaestroWorkspaceInspector({
  surfaceKey,
  surface,
  snapshot,
  document,
  editingTitle,
  onClose,
  onRename,
  onDeleteManualLink
}: {
  surfaceKey: string
  surface: WorkspaceSurface
  snapshot: WorkspaceSurfaceSnapshot
  document: WorkspaceCanvasDocument
  editingTitle: boolean
  onClose: () => void
  onRename: (title: string) => void
  onDeleteManualLink: (linkId: string) => void
}): React.JSX.Element {
  const [title, setTitle] = useState(surface.title)
  useEffect(() => setTitle(surface.title), [surface.id.unified_tab_id, surface.title])
  const automatic = snapshot.automatic_links.filter(
    (link) => link.source_surface_key === surfaceKey || link.target_surface_key === surfaceKey
  )
  const manual = document.manual_links.filter(
    (link) => link.source_surface_key === surfaceKey || link.target_surface_key === surfaceKey
  )
  return (
    <aside className="absolute right-3 top-14 z-30 flex max-h-[calc(100%_-_4.25rem)] w-72 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_10px_24px_rgba(0,0,0,0.18)] 2xl:w-80">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{surface.title}</span>
        <Button size="xs" variant="ghost" onClick={onClose}>
          {translate('auto.components.maestro.MaestroWorkspaceInspector.53ee8b1fd9', 'Close')}
        </Button>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        {editingTitle ? (
          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {translate(
                'auto.components.maestro.MaestroWorkspaceInspector.02c0bc322a',
                'Rename tab'
              )}
            </h2>
            <div className="flex gap-1">
              <Input
                value={title}
                maxLength={512}
                onChange={(event) => setTitle(event.target.value)}
                aria-label={translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.d719df1c6d',
                  'Tab title'
                )}
              />
              <Button size="sm" disabled={!title.trim()} onClick={() => onRename(title.trim())}>
                {translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.5e4708a68d',
                  'Rename'
                )}
              </Button>
            </div>
          </section>
        ) : null}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate(
              'auto.components.maestro.MaestroWorkspaceInspector.fbd2b43c53',
              'Exact identity'
            )}
          </h2>
          <p className="mt-1 break-all font-mono text-foreground">{surface.id.unified_tab_id}</p>
          <p className="mt-1 break-all font-mono text-muted-foreground">{surface.entity_id}</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate('auto.components.maestro.MaestroWorkspaceInspector.45b377c6c0', 'Links')}
          </h2>
          {manual.map((link) => (
            <div key={link.id} className="rounded-md border border-border p-2">
              <Badge variant="outline">
                {translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.812d58dbea',
                  'Manual'
                )}
              </Badge>
              <p className="mt-1 text-muted-foreground">{link.label ?? link.link_type}</p>
              <Button
                className="mt-2"
                size="xs"
                variant="ghost"
                onClick={() => onDeleteManualLink(link.id)}
              >
                {translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.18cd6acc47',
                  'Remove'
                )}
              </Button>
            </div>
          ))}
          {automatic.map((link) => (
            <div key={link.id} className="rounded-md border border-border p-2">
              <Badge variant="secondary">
                {translate(
                  'auto.components.maestro.MaestroWorkspaceInspector.07e9ddcb64',
                  'Automatic'
                )}
              </Badge>
              <p className="mt-1 text-foreground">{link.link_type}</p>
              <p className="mt-1 text-muted-foreground">
                {translate('auto.components.maestro.MaestroWorkspaceInspector.12d8dff31e', 'Why:')}
                {link.explanation_code} · {link.authority_kind}
              </p>
            </div>
          ))}
          {manual.length + automatic.length === 0 ? (
            <p className="text-muted-foreground">
              {translate(
                'auto.components.maestro.MaestroWorkspaceInspector.f1039bab27',
                'No links touch this surface.'
              )}
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  )
}
