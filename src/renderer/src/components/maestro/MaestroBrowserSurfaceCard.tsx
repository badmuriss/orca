import { Camera, CircleHelp, Eye, EyeOff, Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MaestroBrowserSurfaceReceipt } from '../../../../shared/maestro-browser-surface'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { captureMaestroBrowserSurfacePreview } from '@/runtime/runtime-maestro-client'
import { maestroBrowserSurfaceViewModel } from './maestro-browser-surface-view-model'
import {
  MaestroStatusPill,
  MaestroWindowChrome,
  MaestroWindowFoot,
  maestroWindowRootProps
} from './MaestroWindowFrame'
import { maestroStateTone } from './maestro-window-model'
import { translate } from '@/i18n/i18n'

type Props = {
  nodeId: string
  receipt: MaestroBrowserSurfaceReceipt
  selected: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
  nodeRef?: (element: HTMLButtonElement | null) => void
  reducedMotion?: boolean
  runtimeTarget?: RuntimeClientTarget | null
  previewSrc?: string | null
}

/** Identity of the runtime, not of the object the Canvas rebuilt this render. */
function runtimeTargetKey(target: RuntimeClientTarget | null): string {
  if (!target) {
    return 'none'
  }
  return target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
}

function VisibilityIcon({ receipt }: { receipt: MaestroBrowserSurfaceReceipt }): React.JSX.Element {
  if (
    receipt.observed_visibility === 'unavailable' ||
    receipt.observed_visibility === 'unverifiable'
  ) {
    return <CircleHelp className="size-3 shrink-0" aria-hidden />
  }
  if (receipt.observed_visibility === 'visible') {
    return <Eye className="size-3 shrink-0" aria-hidden />
  }
  return <EyeOff className="size-3 shrink-0" aria-hidden />
}

export function MaestroBrowserSurfaceCard({
  nodeId,
  receipt,
  selected,
  onClick,
  onPointerDown,
  onKeyDown,
  onContextMenu,
  nodeRef,
  reducedMotion = false,
  runtimeTarget = null,
  previewSrc = null
}: Props): React.JSX.Element {
  const view = maestroBrowserSurfaceViewModel(receipt)
  const [preview, setPreview] = useState<string | null>(previewSrc)
  const [previewState, setPreviewState] = useState<'ready' | 'loading' | 'unavailable'>(
    previewSrc ? 'ready' : runtimeTarget && view.canPreview ? 'loading' : 'unavailable'
  )
  // "Unavailable" without a reason is unactionable, so the exact failure travels with it.
  const [previewError, setPreviewError] = useState<string | null>(null)
  // The projection hands this card a fresh receipt object on every render, so keying the
  // capture on the object itself restarts it forever and the preview never settles.
  const latest = useRef({ receipt, runtimeTarget })
  latest.current = { receipt, runtimeTarget }
  const pageId = receipt.browser_page_id
  const capturedAt = receipt.updated_at
  const targetKey = runtimeTargetKey(runtimeTarget)

  useEffect(() => {
    if (previewSrc) {
      setPreview(previewSrc)
      setPreviewState('ready')
      setPreviewError(null)
      return
    }
    const target = latest.current.runtimeTarget
    if (!target || !view.canPreview) {
      setPreview(null)
      setPreviewState('unavailable')
      setPreviewError(target ? null : 'No runtime is pinned for this workspace.')
      return
    }
    let cancelled = false
    setPreviewState('loading')
    void captureMaestroBrowserSurfacePreview(target, latest.current.receipt)
      .then((screenshot) => {
        if (cancelled) {
          return
        }
        setPreview(`data:image/${screenshot.format};base64,${screenshot.data}`)
        setPreviewState('ready')
        setPreviewError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreview(null)
          setPreviewState('unavailable')
          setPreviewError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [capturedAt, pageId, previewSrc, targetKey, view.canPreview])

  return (
    <button
      ref={nodeRef}
      type="button"
      {...maestroWindowRootProps({ selected, reducedMotion })}
      aria-pressed={selected}
      aria-label={`${view.title}, ${view.stateLabel}, ${view.visibilityLabel}`}
      data-maestro-node={nodeId}
      data-maestro-browser-surface={receipt.surface_id}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <MaestroWindowChrome
        icon={<Globe className="size-3.5" aria-hidden />}
        title={view.title}
        trailing={
          <MaestroStatusPill label={view.stateLabel} tone={maestroStateTone(receipt.state)} />
        }
      />
      <span className="maestro-window-body">
        {/* Address rail, then the real native capture filling the viewport. */}
        <span className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/60 px-2 py-1 text-[10px] leading-4 text-muted-foreground">
          <VisibilityIcon receipt={receipt} />
          <span className="min-w-0 flex-1 truncate font-mono" title={view.origin}>
            {view.origin}
          </span>
        </span>
        <span className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-editor-surface">
          {preview ? (
            <img
              src={preview}
              alt={translate(
                'auto.components.maestro.MaestroBrowserSurfaceCard.dafd169e10',
                'Exact Browser evidence for {{value0}}',
                { value0: view.title }
              )}
              className="size-full object-cover object-top"
            />
          ) : (
            <span
              className="flex max-w-40 flex-col items-center gap-1.5 px-2 text-center text-[10px] leading-4 text-muted-foreground"
              title={previewError ?? undefined}
              data-maestro-preview-error={previewError ?? undefined}
            >
              {previewState === 'loading' ? (
                <Camera className="size-4" aria-hidden />
              ) : (
                <CircleHelp className="size-4" aria-hidden />
              )}
              {previewState === 'loading'
                ? translate(
                    'auto.components.maestro.MaestroBrowserSurfaceCard.110bc89855',
                    'Loading exact capture…'
                  )
                : translate(
                    'auto.components.maestro.MaestroBrowserSurfaceCard.2ba6712735',
                    'Capture unavailable'
                  )}
            </span>
          )}
        </span>
      </span>
      <MaestroWindowFoot
        typeLabel="Browser"
        icon={<Camera className="size-3" aria-hidden />}
        detail={`${view.captureLabel} · ${view.observedVisibilityLabel}`}
      />
    </button>
  )
}
