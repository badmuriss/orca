import { Camera, CircleHelp, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BrowserScreenshotResult } from '../../../../shared/runtime-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

export function MaestroWorkspaceBrowserPreview({
  target,
  pageId,
  receiptRevision
}: {
  target: RuntimeClientTarget
  pageId: string
  receiptRevision: number
}): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let active = true
    setState('loading')
    void callRuntimeRpc<BrowserScreenshotResult>(target, 'browser.screenshot', {
      page: pageId,
      format: 'png'
    })
      .then((screenshot) => {
        if (active) {
          setPreview(`data:image/${screenshot.format};base64,${screenshot.data}`)
          setState('ready')
        }
      })
      .catch(() => {
        if (active) {
          setPreview(null)
          setState('unavailable')
        }
      })
    return () => {
      active = false
    }
  }, [pageId, receiptRevision, target])

  if (state === 'ready' && preview) {
    return (
      <img
        src={preview}
        alt={translate(
          'auto.components.maestro.MaestroWorkspaceBrowserPreview.0b65d32766',
          'Exact Browser page {{value0}}',
          { value0: pageId }
        )}
        className="size-full object-cover object-top"
        data-browser-page-id={pageId}
      />
    )
  }
  return (
    <div className="flex size-full flex-col items-center justify-center bg-editor-surface p-4 text-center text-xs text-muted-foreground">
      {state === 'loading' ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <CircleHelp className="size-5" />
      )}
      <p className="mt-2">
        {state === 'loading'
          ? translate(
              'auto.components.maestro.MaestroWorkspaceBrowserPreview.3e7cc4bc3a',
              'Capturing the exact existing page…'
            )
          : translate(
              'auto.components.maestro.MaestroWorkspaceBrowserPreview.791294b80c',
              'Exact page capture unavailable'
            )}
      </p>
      {state === 'unavailable' ? <Camera className="mt-2 size-3.5" /> : null}
    </div>
  )
}
