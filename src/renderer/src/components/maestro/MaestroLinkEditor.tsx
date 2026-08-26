import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MaestroEdgeDirection, MaestroEdgeType } from '../../../../shared/maestro-contract'
import type { MaestroLinkComposer } from './useMaestroAuthoring'
import type { MaestroCanvasNode } from './MaestroCanvas'
import { translate } from '@/i18n/i18n'

type MaestroLinkEditorProps = {
  composer: MaestroLinkComposer
  nodesById: ReadonlyMap<string, MaestroCanvasNode>
  linkType: MaestroEdgeType
  linkDirection: MaestroEdgeDirection
  authoringError: string | null
  onTypeChange: (value: MaestroEdgeType) => void
  onDirectionChange: (value: MaestroEdgeDirection) => void
  onCancel: () => void
  onSubmit: () => void
}

const linkTypes: readonly MaestroEdgeType[] = [
  'context_for',
  'depends_on',
  'reports_to',
  'produces'
]
const directions: readonly MaestroEdgeDirection[] = ['forward', 'reverse', 'bidirectional']

function isLinkType(value: string): value is MaestroEdgeType {
  return linkTypes.includes(value as MaestroEdgeType)
}

export function MaestroLinkEditor({
  composer,
  nodesById,
  linkType,
  linkDirection,
  authoringError,
  onTypeChange,
  onDirectionChange,
  onCancel,
  onSubmit
}: MaestroLinkEditorProps): React.JSX.Element {
  const source = nodesById.get(composer.sourceId)
  const target = nodesById.get(composer.targetId)
  return (
    <section
      className="absolute right-3 top-3 z-20 w-72 rounded-md border border-border bg-card p-3 shadow-lg"
      aria-label={translate(
        'auto.components.maestro.MaestroLinkEditor.8118170fef',
        'Typed link editor'
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="size-4 text-muted-foreground" aria-hidden />
        {translate('auto.components.maestro.MaestroLinkEditor.26809967ba', 'Create typed link')}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {target
          ? `${source?.title ?? 'Source'} → ${target.title}`
          : translate(
              'auto.components.maestro.MaestroLinkEditor.50c3db1eb8',
              'Choose a target handle on the graph.'
            )}
      </p>
      <label className="mt-3 block text-xs font-medium">
        {translate('auto.components.maestro.MaestroLinkEditor.6f54ae4959', 'Type')}
        <select
          value={linkType}
          onChange={(event) => {
            if (isLinkType(event.target.value)) {
              onTypeChange(event.target.value)
            }
          }}
          className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroLinkEditor.1fb0a10d14',
            'Link type'
          )}
        >
          {linkTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="mt-3">
        <legend className="text-xs font-medium">
          {translate('auto.components.maestro.MaestroLinkEditor.d1bc2aacb0', 'Direction')}
        </legend>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {directions.map((direction) => (
            <button
              key={direction}
              type="button"
              className={`rounded-sm border px-1 py-1 text-[10px] ${linkDirection === direction ? 'border-foreground bg-accent' : 'border-border'}`}
              aria-pressed={linkDirection === direction}
              onClick={() => onDirectionChange(direction)}
            >
              {direction}
            </button>
          ))}
        </div>
      </fieldset>
      {authoringError ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {authoringError}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          {translate('auto.components.maestro.MaestroLinkEditor.0a3b3b984f', 'Cancel')}
        </Button>
        <Button type="button" size="xs" disabled={!composer.targetId} onClick={onSubmit}>
          {translate('auto.components.maestro.MaestroLinkEditor.2f5f703049', 'Create link')}
        </Button>
      </div>
    </section>
  )
}
