import { MousePointer2, Network } from 'lucide-react'
import { translate } from '@/i18n/i18n'

/** What an operator can do on a board that has nothing on it yet. */
export function MaestroCanvasEmptyState(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          <Network className="size-4" aria-hidden />
        </span>
        <p className="mt-3 text-[13px] font-medium text-foreground">
          {translate(
            'auto.components.maestro.MaestroCanvasEmptyState.3fd1b69d1a',
            'No graph nodes are available for this run.'
          )}
        </p>
        <p className="mt-1.5 text-balance text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.maestro.MaestroCanvasEmptyState.4b44eb07fc',
            'Right-click the board to write a note, delegate work, or link two nodes. Drag to pan, scroll to zoom.'
          )}
        </p>
        <span className="mt-3 flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">
          <MousePointer2 className="size-3" aria-hidden />
          {translate(
            'auto.components.maestro.MaestroCanvasEmptyState.f93d8dff2c',
            'Right click to create'
          )}
        </span>
      </div>
    </div>
  )
}
