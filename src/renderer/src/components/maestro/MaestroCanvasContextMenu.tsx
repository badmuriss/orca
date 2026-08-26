import { Bot, FilePlus2, Link2, MousePointer2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { placeMaestroContextMenu, type MaestroCanvasPoint } from './maestro-canvas-view-model'

type MaestroCanvasContextMenuProps = {
  pointer: MaestroCanvasPoint
  canvas: { width: number; height: number }
  onCreateNote: () => void
  onCreateLink: () => void
  onDelegate?: () => void
  delegationDisabledReason?: string
  onDismiss: () => void
}

export function MaestroCanvasContextMenu({
  pointer,
  canvas,
  onCreateNote,
  onCreateLink,
  onDelegate,
  delegationDisabledReason,
  onDismiss
}: MaestroCanvasContextMenuProps): React.JSX.Element {
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const position = placeMaestroContextMenu(pointer, { width: 224, height: 190 }, canvas)
  useEffect(() => {
    firstActionRef.current?.focus()
  }, [])
  return (
    <div
      role="menu"
      aria-label={translate(
        'auto.components.maestro.MaestroCanvasContextMenu.c7031493af',
        'Canvas actions'
      )}
      className="absolute z-30 w-56 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onDismiss()
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <MousePointer2 className="size-3.5 text-muted-foreground" aria-hidden />
          {translate('auto.components.maestro.canvas.createAtPointer', 'Create at pointer')}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroCanvasContextMenu.39dbcc63a2',
            'Close Canvas actions'
          )}
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <button
        ref={firstActionRef}
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
        onClick={onCreateNote}
      >
        <FilePlus2 className="size-3.5 text-muted-foreground" aria-hidden />
        {translate('auto.components.maestro.canvas.newNote', 'New Markdown note')}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!onDelegate || Boolean(delegationDisabledReason)}
        title={delegationDisabledReason}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
        onClick={onDelegate}
      >
        <Bot className="size-3.5 text-muted-foreground" aria-hidden />
        {translate('auto.components.maestro.canvas.delegate', 'Delegate work')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
        onClick={onCreateLink}
      >
        <Link2 className="size-3.5 text-muted-foreground" aria-hidden />
        {translate('auto.components.maestro.canvas.linkSelected', 'Link selected nodes')}
      </button>
      <p className="px-2 pb-1 pt-1 text-[10px] text-muted-foreground">
        {translate('auto.components.maestro.canvas.escapeCloses', 'Escape closes this menu')}
      </p>
    </div>
  )
}
