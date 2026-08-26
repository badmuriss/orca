import { useEffect, useRef, useState } from 'react'
import { Camera, CircleHelp, ExternalLink, Eye, EyeOff, Globe, X } from 'lucide-react'
import type { MaestroBrowserSurfaceReceipt } from '../../../../shared/maestro-browser-surface'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  captureMaestroBrowserSurfacePreview,
  focusMaestroBrowserSurface
} from '@/runtime/runtime-maestro-client'
import { Button } from '@/components/ui/button'
import { maestroBrowserSurfaceViewModel } from './maestro-browser-surface-view-model'
import { translate } from '@/i18n/i18n'

type Props = {
  receipt: MaestroBrowserSurfaceReceipt
  runtimeTarget?: RuntimeClientTarget | null
  previewDataUrl?: string | null
  onClose: () => void
  onPreviewRelease?: () => void
  onFocusRequest?: () => void
}

function VisibilityIcon({ receipt }: { receipt: MaestroBrowserSurfaceReceipt }): React.JSX.Element {
  if (receipt.observed_visibility === 'visible') {
    return <Eye className="size-3.5" aria-hidden />
  }
  if (
    receipt.observed_visibility === 'unavailable' ||
    receipt.observed_visibility === 'unverifiable'
  ) {
    return <CircleHelp className="size-3.5" aria-hidden />
  }
  return <EyeOff className="size-3.5" aria-hidden />
}

function provenance(receipt: MaestroBrowserSurfaceReceipt): readonly [string, string][] {
  const evidence = receipt.evidence_receipt
  if (!evidence) {
    return [
      ['Page', receipt.browser_page_id ?? 'Unavailable'],
      ['Workspace', `${receipt.execution_host_id} / ${receipt.workspace_key}`]
    ]
  }
  return [
    ['Page', receipt.browser_page_id ?? 'Unavailable'],
    ['Workspace', `${receipt.execution_host_id} / ${receipt.workspace_key}`],
    ['Profile', receipt.profile_id ?? 'Default'],
    ['Route', evidence.route_or_component],
    ['State', evidence.state],
    ['Theme', evidence.theme],
    ['Revision', evidence.source_revision],
    ['Capture', evidence.capture_mode],
    ['Artifact', evidence.artifact_hash],
    ['Vision', evidence.vision_review.outcome]
  ]
}

export function MaestroBrowserSurfaceInspector({
  receipt,
  runtimeTarget = null,
  previewDataUrl = null,
  onClose,
  onPreviewRelease,
  onFocusRequest
}: Props): React.JSX.Element {
  const view = maestroBrowserSurfaceViewModel(receipt)
  const [nativePreview, setNativePreview] = useState<string | null>(previewDataUrl)
  const [previewState, setPreviewState] = useState<'ready' | 'loading' | 'unavailable'>(
    previewDataUrl ? 'ready' : runtimeTarget && view.canPreview ? 'loading' : 'unavailable'
  )

  // Callers hand this panel fresh receipt and callback identities on every Canvas render, so
  // keying the capture on them restarts it forever and re-focuses the exact page each time.
  const latest = useRef({ receipt, runtimeTarget, onFocusRequest, onPreviewRelease })
  latest.current = { receipt, runtimeTarget, onFocusRequest, onPreviewRelease }
  const pageId = receipt.browser_page_id
  const capturedAt = receipt.updated_at
  const targetKey = runtimeTarget
    ? runtimeTarget.kind === 'environment'
      ? `environment:${runtimeTarget.environmentId}`
      : 'local'
    : 'none'

  useEffect(() => {
    const {
      receipt: current,
      runtimeTarget: target,
      onFocusRequest: focus,
      onPreviewRelease: release
    } = latest.current
    if (!target) {
      if (view.canFocus) {
        focus?.()
      }
      return () => release?.()
    }
    let cancelled = false
    void (async () => {
      try {
        const screenshot =
          view.canPreview && !previewDataUrl
            ? await captureMaestroBrowserSurfacePreview(target, current)
            : null
        if (cancelled) {
          return
        }
        if (screenshot) {
          setNativePreview(`data:image/${screenshot.format};base64,${screenshot.data}`)
          setPreviewState('ready')
        }
        if (view.canFocus) {
          await focusMaestroBrowserSurface(target, current)
        }
      } catch {
        if (!cancelled) {
          setNativePreview(null)
          setPreviewState('unavailable')
        }
      }
    })()
    return () => {
      cancelled = true
      release?.()
    }
  }, [capturedAt, pageId, previewDataUrl, targetKey, view.canFocus, view.canPreview])

  const evidence = receipt.evidence_receipt
  return (
    <aside
      className="absolute bottom-16 right-3 z-20 flex max-h-[calc(100%-88px)] w-[min(620px,calc(100%-24px))] max-[1500px]:w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_10px_24px_rgb(0_0_0/0.18)]"
      aria-label={translate(
        'auto.components.maestro.MaestroBrowserSurfaceInspector.217bcb6b08',
        'Selected browser surface inspector'
      )}
    >
      <header className="flex items-start gap-2 border-b border-border bg-[color:var(--maestro-chrome)] px-3 py-2">
        <Globe className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-medium leading-4" title={view.title}>
            {view.title}
          </h2>
          <p
            className="mt-0.5 truncate font-mono text-[11px] leading-4 text-muted-foreground"
            title={view.origin}
          >
            {view.origin}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <VisibilityIcon receipt={receipt} />
            <span className="truncate">{view.visibilityLabel}</span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.maestro.MaestroBrowserSurfaceInspector.cebbb01aba',
            'Close inspector'
          )}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_210px] max-[1500px]:grid-cols-1 max-[1500px]:grid-rows-[192px_minmax(0,1fr)]">
        <div className="flex h-72 min-h-0 items-center justify-center overflow-hidden bg-editor-surface p-2 max-[1500px]:h-48">
          {nativePreview && evidence ? (
            <img
              src={nativePreview}
              alt={translate(
                'auto.components.maestro.MaestroBrowserSurfaceInspector.d9eb86791b',
                'Immutable Browser capture for {{value0}}, {{value1}}',
                { value0: evidence.route_or_component, value1: evidence.state }
              )}
              width={evidence.dimensions.width}
              height={evidence.dimensions.height}
              className="max-h-full max-w-full rounded-sm border border-border object-contain shadow-xs"
            />
          ) : (
            <div className="grid max-w-72 place-items-center gap-2 text-center text-xs text-muted-foreground">
              {previewState === 'loading' ? (
                <Camera className="size-5" aria-hidden />
              ) : (
                <CircleHelp className="size-5" aria-hidden />
              )}
              <p>
                {previewState === 'loading'
                  ? translate(
                      'auto.components.maestro.MaestroBrowserSurfaceInspector.7579e0f758',
                      'Loading the exact native page capture…'
                    )
                  : translate(
                      'auto.components.maestro.MaestroBrowserSurfaceInspector.a261236b8b',
                      'Preview unavailable. Orca has not observed a readable native capture.'
                    )}
              </p>
            </div>
          )}
        </div>
        <div className="scrollbar-sleek overflow-y-auto border-l border-border p-3 max-[1500px]:border-l-0 max-[1500px]:border-t">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate(
              'auto.components.maestro.MaestroBrowserSurfaceInspector.aef68f2fad',
              'Capture provenance'
            )}
          </p>
          <dl className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
            {provenance(receipt).map(([label, value]) => (
              <div key={label}>
                <dt className="font-medium text-foreground">{label}</dt>
                <dd className="break-all font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground" title={view.ownerLabel}>
          {view.ownerLabel}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={(!runtimeTarget && !onFocusRequest) || !view.canFocus}
          onClick={() => {
            if (runtimeTarget) {
              void focusMaestroBrowserSurface(runtimeTarget, receipt)
            } else {
              onFocusRequest?.()
            }
          }}
        >
          <ExternalLink className="size-3.5" />
          {translate(
            'auto.components.maestro.MaestroBrowserSurfaceInspector.342e3db0e5',
            'Focus Browser'
          )}
        </Button>
      </footer>
    </aside>
  )
}
