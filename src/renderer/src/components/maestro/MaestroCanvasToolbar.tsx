import { Link2, Maximize2, Minus, Plus, RotateCcw, Search, Undo2, Redo2 } from 'lucide-react'
import type { MaestroCanvasNode } from './MaestroCanvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaestroStatePip } from './MaestroWindowFrame'
import { maestroStateTone, maestroWindowTypeLabel } from './maestro-window-model'
import type { MaestroCanvasViewport } from './maestro-canvas-viewport'
import { translate } from '@/i18n/i18n'

type MaestroCanvasToolbarProps = {
  nodes: readonly MaestroCanvasNode[]
  search: string
  onSearchChange: (value: string) => void
  onFocusNode: (node: MaestroCanvasNode) => void
  viewport: MaestroCanvasViewport
  onZoom: (factor: number) => void
  onFit: () => void
  onReset: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onCreateLink: () => void
}

function ToolbarDivider(): React.JSX.Element {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
}

export function MaestroCanvasToolbar({
  nodes,
  search,
  onSearchChange,
  onFocusNode,
  viewport,
  onZoom,
  onFit,
  onReset,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCreateLink
}: MaestroCanvasToolbarProps): React.JSX.Element {
  const searchResults = search.trim()
    ? nodes
        .filter((node) =>
          `${node.title} ${node.summary}`.toLowerCase().includes(search.toLowerCase())
        )
        .slice(0, 6)
    : []
  return (
    <>
      <div className="absolute left-3 top-3 z-10 w-60 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className="flex items-center gap-2 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            placeholder={translate(
              'auto.components.maestro.MaestroCanvasToolbar.c693b89965',
              'Search graph'
            )}
            aria-label={translate(
              'auto.components.maestro.MaestroCanvasToolbar.c693b89965',
              'Search graph'
            )}
          />
        </div>
        {searchResults.length ? (
          <div className="border-t border-border p-1">
            {searchResults.map((node) => (
              <button
                key={node.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs text-foreground outline-none hover:bg-accent focus-visible:bg-accent"
                title={`${node.title} · ${maestroWindowTypeLabel(node)} · ${node.status}`}
                onClick={() => onFocusNode(node)}
              >
                <MaestroStatePip tone={maestroStateTone(node.status)} />
                <span className="min-w-0 flex-1 truncate">{node.title}</span>
                <span
                  className="shrink-0 text-[10px] uppercase tracking-[0.05em] text-muted-foreground"
                  aria-hidden
                >
                  {maestroWindowTypeLabel(node)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {/* Docked bottom-centre so it never collides with the inspector at the
          bottom-right or the error notice at the bottom-left. */}
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-xs">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.5a41848f1b',
            'Zoom out'
          )}
          onClick={() => onZoom(1 / 1.25)}
        >
          <Minus className="size-3" />
        </Button>
        <span className="min-w-11 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.0af1d86c6d',
            'Zoom in'
          )}
          onClick={() => onZoom(1.25)}
        >
          <Plus className="size-3" />
        </Button>
        <ToolbarDivider />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="rounded-full px-2"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.c186efc73f',
            'Fit graph to view'
          )}
          onClick={onFit}
        >
          <Maximize2 className="size-3" />
          {translate('auto.components.maestro.MaestroCanvasToolbar.4c8ba1a671', 'Fit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.5a4c153d12',
            'Reset canvas'
          )}
          onClick={onReset}
        >
          <RotateCcw className="size-3" />
        </Button>
        <ToolbarDivider />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.7aa3ad1f39',
            'Undo Canvas change'
          )}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasToolbar.da1fe029ea',
            'Redo Canvas change'
          )}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="size-3" />
        </Button>
        <ToolbarDivider />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="rounded-full px-2"
          onClick={onCreateLink}
        >
          <Link2 className="size-3" />
          {translate('auto.components.maestro.MaestroCanvasToolbar.3a69c6faea', 'Link')}
        </Button>
      </div>
    </>
  )
}
