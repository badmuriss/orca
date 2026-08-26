import {
  FilePlus2,
  Globe2,
  Maximize2,
  RotateCcw,
  TerminalSquare,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { MaestroWorkspaceCanvasResource } from '@/hooks/useMaestroWorkspaceCanvas'
import type { useMaestroWorkspaceViewport } from './useMaestroWorkspaceViewport'
import { maestroWorkspaceMutationKey } from './maestro-workspace-mutation-key'

type ToolbarProps = {
  resource: MaestroWorkspaceCanvasResource
  workspaceKey: string
  board: ReturnType<typeof useMaestroWorkspaceViewport>
}

export function MaestroWorkspaceToolbar({ resource, workspaceKey, board }: ToolbarProps) {
  const [text, setText] = useState('')
  const [tone, setTone] = useState<'decision' | 'warning' | 'blocked' | 'observation'>(
    'observation'
  )
  return (
    <>
      <div className="absolute left-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-xs">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void resource.mutate({
              action: 'create',
              surface_type: 'terminal',
              idempotency_key: maestroWorkspaceMutationKey('create-terminal', workspaceKey)
            })
          }
        >
          <TerminalSquare />{' '}
          {translate('auto.components.maestro.MaestroWorkspaceCanvas.3fbda457b1', 'Terminal')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void resource.mutate({
              action: 'create',
              surface_type: 'browser',
              idempotency_key: maestroWorkspaceMutationKey('create-browser', workspaceKey)
            })
          }
        >
          <Globe2 />{' '}
          {translate('auto.components.maestro.MaestroWorkspaceCanvas.85e5a5ca61', 'Browser')}
        </Button>
        <Input
          className="h-7 w-40 text-xs"
          value={text}
          maxLength={4096}
          placeholder={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.f51285f4d4',
            'Semantic note'
          )}
          aria-label={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.d3ff26728c',
            'Annotation text'
          )}
          onChange={(event) => setText(event.target.value)}
        />
        <Select value={tone} onValueChange={(value) => setTone(value as typeof tone)}>
          <SelectTrigger
            size="sm"
            className="h-7 text-xs"
            aria-label={translate(
              'auto.components.maestro.MaestroWorkspaceCanvas.0629ccb9e6',
              'Annotation tone'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="observation">
              {translate(
                'auto.components.maestro.MaestroWorkspaceCanvas.3474e6c93b',
                'Observation'
              )}
            </SelectItem>
            <SelectItem value="decision">
              {translate('auto.components.maestro.MaestroWorkspaceCanvas.dea05670e3', 'Decision')}
            </SelectItem>
            <SelectItem value="warning">
              {translate('auto.components.maestro.MaestroWorkspaceCanvas.dc516693a9', 'Warning')}
            </SelectItem>
            <SelectItem value="blocked">
              {translate('auto.components.maestro.MaestroWorkspaceCanvas.c3974f3c70', 'Blocked')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="xs"
          variant="ghost"
          disabled={!text.trim()}
          onClick={() => {
            const annotation = text.trim()
            if (!annotation) {
              return
            }
            void resource.mutate({
              action: 'create',
              surface_type: 'content',
              title: annotation.slice(0, 80),
              annotation: { text: annotation, tone },
              idempotency_key: maestroWorkspaceMutationKey('create-content', workspaceKey)
            })
            setText('')
          }}
        >
          <FilePlus2 />{' '}
          {translate('auto.components.maestro.MaestroWorkspaceCanvas.5b9e1f9a97', 'Content')}
        </Button>
      </div>
      <div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-xs">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => board.zoom(0.85)}
          aria-label={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.5d7ccb0d24',
            'Zoom out'
          )}
        >
          <ZoomOut />
        </Button>
        <span className="min-w-10 text-center text-[10px] tabular-nums text-muted-foreground">
          {Math.round(board.viewport.zoom * 100)}%
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => board.zoom(1.15)}
          aria-label={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.954805c1ea',
            'Zoom in'
          )}
        >
          <ZoomIn />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={board.fit}
          aria-label={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.4a1926ece1',
            'Fit resources'
          )}
        >
          <Maximize2 />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={board.reset}
          aria-label={translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.0299b5276f',
            'Reset viewport'
          )}
        >
          <RotateCcw />
        </Button>
      </div>
    </>
  )
}
