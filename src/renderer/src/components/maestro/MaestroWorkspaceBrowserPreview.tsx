import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserScreenshotResult } from '../../../../shared/runtime-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

const MAX_BROWSER_PREVIEW_CACHE_ENTRIES = 24
const BROWSER_PREVIEW_RETRY_MS = 1_500
const browserPreviewCache = new Map<string, string>()

function rememberBrowserPreview(key: string, preview: string): void {
  browserPreviewCache.delete(key)
  browserPreviewCache.set(key, preview)
  while (browserPreviewCache.size > MAX_BROWSER_PREVIEW_CACHE_ENTRIES) {
    browserPreviewCache.delete(browserPreviewCache.keys().next().value!)
  }
}

export function MaestroWorkspaceBrowserPreview({
  target,
  pageId,
  receiptRevision
}: {
  target: RuntimeClientTarget
  pageId: string
  receiptRevision: number
}): React.JSX.Element {
  const targetKey = target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
  const captureKey = `${targetKey}:${pageId}`
  const cachedPreview = browserPreviewCache.get(captureKey) ?? null
  const [preview, setPreview] = useState<string | null>(cachedPreview)
  const [state, setState] = useState<'loading' | 'ready' | 'reconnecting'>(
    cachedPreview ? 'ready' : 'loading'
  )

  // Layout mutations rebuild equivalent targets, so primitive identity prevents recapture on Fit.
  const latestTarget = useRef(target)
  latestTarget.current = target

  // Revision recaptures swap in place: keep the resolved frame until the new one lands.
  const resolvedCaptureKey = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const retained = browserPreviewCache.get(captureKey) ?? null
    if (retained) {
      setPreview(retained)
      setState('ready')
      resolvedCaptureKey.current = captureKey
    } else if (resolvedCaptureKey.current !== captureKey) {
      setPreview(null)
      setState('loading')
    }
    const capture = (): void => {
      void callRuntimeRpc<BrowserScreenshotResult>(latestTarget.current, 'browser.screenshot', {
        page: pageId,
        format: 'png'
      }).then(
        (screenshot) => {
          if (!active) {
            return
          }
          const nextPreview = `data:image/${screenshot.format};base64,${screenshot.data}`
          rememberBrowserPreview(captureKey, nextPreview)
          setPreview(nextPreview)
          setState('ready')
          resolvedCaptureKey.current = captureKey
        },
        () => {
          if (!active) {
            return
          }
          setState(browserPreviewCache.has(captureKey) ? 'ready' : 'reconnecting')
          retryTimer = setTimeout(capture, BROWSER_PREVIEW_RETRY_MS)
        }
      )
    }
    capture()
    return () => {
      active = false
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [captureKey, pageId, receiptRevision])

  if (state === 'ready' && preview) {
    return (
      <img
        src={preview}
        alt={translate(
          'auto.components.maestro.MaestroWorkspaceBrowserPreview.0b65d32766',
          'Exact Browser page {{value0}}',
          { value0: pageId }
        )}
        className="size-full bg-white object-cover object-top"
        data-browser-page-id={pageId}
      />
    )
  }
  return (
    <div className="flex size-full flex-col items-center justify-center bg-editor-surface p-4 text-center text-xs text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <p className="mt-2">
        {state === 'loading'
          ? translate(
              'auto.components.maestro.MaestroWorkspaceBrowserPreview.3e7cc4bc3a',
              'Capturing the exact existing page…'
            )
          : translate(
              'auto.components.maestro.MaestroWorkspaceBrowserPreview.reconnecting',
              'Reconnecting the exact page preview…'
            )}
      </p>
    </div>
  )
}
