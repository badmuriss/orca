import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserScreenshotResult } from '../../../../shared/runtime-types'
import {
  getRemoteBrowserKeyboardShortcut,
  getRemoteBrowserKeypressKey
} from '@/components/browser-pane/stream-remote/remote-browser-keyboard'
import { getRemoteBrowserMouseButton } from '@/components/browser-pane/stream-remote/remote-browser-page-input-model'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { MaestroWorkspacePreviewMode } from './maestro-workspace-visibility'

const MAX_BROWSER_PREVIEW_CACHE_ENTRIES = 24
const SELECTED_CAPTURE_INTERVAL_MS = 320
const VISIBLE_CAPTURE_INTERVAL_MS = 1_200
const IDENTITY_CAPTURE_INTERVAL_MS = 2_400
const browserPreviewCache = new Map<string, string>()
const ignoreBrowserInteraction = (): void => {}

type BrowserPoint = { x: number; y: number }

function rememberBrowserPreview(key: string, preview: string): void {
  browserPreviewCache.delete(key)
  browserPreviewCache.set(key, preview)
  while (browserPreviewCache.size > MAX_BROWSER_PREVIEW_CACHE_ENTRIES) {
    browserPreviewCache.delete(browserPreviewCache.keys().next().value!)
  }
}

function browserPoint(
  image: HTMLImageElement,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>
): BrowserPoint | null {
  const bounds = image.getBoundingClientRect()
  const width = image.naturalWidth || bounds.width
  const height = image.naturalHeight || bounds.height
  if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) {
    return null
  }
  return {
    x: Math.max(
      0,
      Math.min(width - 1, Math.round(((event.clientX - bounds.left) / bounds.width) * width))
    ),
    y: Math.max(
      0,
      Math.min(height - 1, Math.round(((event.clientY - bounds.top) / bounds.height) * height))
    )
  }
}

export function MaestroWorkspaceBrowserPreview({
  target,
  pageId,
  receiptRevision,
  selected = false,
  previewMode = 'full',
  onInteract = ignoreBrowserInteraction
}: {
  target: RuntimeClientTarget
  pageId: string
  receiptRevision: number
  selected?: boolean
  previewMode?: MaestroWorkspacePreviewMode
  onInteract?: () => void
}): React.JSX.Element {
  const targetKey = target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
  const captureKey = `${targetKey}:${pageId}`
  const cachedPreview = browserPreviewCache.get(captureKey) ?? null
  const [preview, setPreview] = useState<string | null>(cachedPreview)
  const [state, setState] = useState<'loading' | 'ready' | 'reconnecting'>(
    cachedPreview ? 'ready' : 'loading'
  )
  const imageRef = useRef<HTMLImageElement | null>(null)
  const latestTarget = useRef(target)
  const inputQueue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingWheel = useRef<(BrowserPoint & { dx: number; dy: number }) | null>(null)
  const wheelFrame = useRef<number | null>(null)
  const resolvedCaptureKey = useRef<string | null>(null)
  latestTarget.current = target

  const captureInterval = selected
    ? SELECTED_CAPTURE_INTERVAL_MS
    : previewMode === 'identity'
      ? IDENTITY_CAPTURE_INTERVAL_MS
      : VISIBLE_CAPTURE_INTERVAL_MS

  useEffect(() => {
    let active = true
    let capturing = false
    const retained = browserPreviewCache.get(captureKey) ?? null
    if (retained) {
      setPreview(retained)
      setState('ready')
      resolvedCaptureKey.current = captureKey
    } else if (resolvedCaptureKey.current !== captureKey) {
      setPreview(null)
      setState('loading')
    }
    const capture = async (): Promise<void> => {
      if (capturing) {
        return
      }
      capturing = true
      try {
        const screenshot = await callRuntimeRpc<BrowserScreenshotResult>(
          latestTarget.current,
          'browser.screenshot',
          { page: pageId, format: 'png' },
          { suppressFeatureInteraction: true }
        )
        if (!active) {
          return
        }
        const nextPreview = `data:image/${screenshot.format};base64,${screenshot.data}`
        rememberBrowserPreview(captureKey, nextPreview)
        setPreview(nextPreview)
        setState('ready')
        resolvedCaptureKey.current = captureKey
      } catch {
        if (active) {
          setState(browserPreviewCache.has(captureKey) ? 'ready' : 'reconnecting')
        }
      } finally {
        capturing = false
      }
    }
    void capture()
    const interval = setInterval(() => void capture(), captureInterval)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [captureInterval, captureKey, pageId, receiptRevision])

  useEffect(
    () => () => {
      if (wheelFrame.current !== null) {
        window.cancelAnimationFrame(wheelFrame.current)
      }
    },
    []
  )

  const enqueueInput = (operation: () => Promise<unknown>): void => {
    const next = inputQueue.current.catch(() => {}).then(operation)
    inputQueue.current = next.catch(() => {})
  }
  const callBrowser = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    callRuntimeRpc(
      latestTarget.current,
      method,
      { page: pageId, ...params },
      { timeoutMs: 15_000, suppressFeatureInteraction: true }
    )
  const pointFor = (event: Pick<MouseEvent, 'clientX' | 'clientY'>): BrowserPoint | null => {
    const image = imageRef.current
    return image ? browserPoint(image, event) : null
  }

  const handlePointer = (
    event: React.PointerEvent<HTMLImageElement>,
    phase: 'down' | 'up'
  ): void => {
    const point = pointFor(event.nativeEvent)
    const button = getRemoteBrowserMouseButton(event.button)
    if (!point || !button || button === 'right') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onInteract()
    event.currentTarget.focus()
    enqueueInput(async () => {
      await callBrowser('browser.mouseMove', point)
      await callBrowser(phase === 'down' ? 'browser.mouseDown' : 'browser.mouseUp', { button })
    })
  }

  const handleWheel = (event: React.WheelEvent<HTMLImageElement>): void => {
    const point = pointFor(event.nativeEvent)
    if (!point) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onInteract()
    const current = pendingWheel.current
    pendingWheel.current = {
      ...point,
      dx: (current?.dx ?? 0) + Math.round(event.deltaX),
      dy: (current?.dy ?? 0) + Math.round(event.deltaY)
    }
    if (wheelFrame.current !== null) {
      return
    }
    wheelFrame.current = window.requestAnimationFrame(() => {
      wheelFrame.current = null
      const wheel = pendingWheel.current
      pendingWheel.current = null
      if (!wheel || (wheel.dx === 0 && wheel.dy === 0)) {
        return
      }
      enqueueInput(async () => {
        await callBrowser('browser.mouseMove', { x: wheel.x, y: wheel.y })
        await callBrowser('browser.mouseWheel', { dx: wheel.dx, dy: wheel.dy })
      })
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLImageElement>): void => {
    const key = getRemoteBrowserKeyboardShortcut(event) ?? getRemoteBrowserKeypressKey(event)
    if (!key) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onInteract()
    enqueueInput(() => callBrowser('browser.keypress', { key }))
  }

  if (state === 'ready' && preview) {
    return (
      <img
        ref={imageRef}
        src={preview}
        alt={translate(
          'auto.components.maestro.MaestroWorkspaceBrowserPreview.0b65d32766',
          'Interactive Browser page {{value0}}',
          { value0: pageId }
        )}
        className="size-full cursor-default bg-white object-fill outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-browser-page-id={pageId}
        data-maestro-browser-interactive=""
        draggable={false}
        tabIndex={0}
        onPointerDown={(event) => handlePointer(event, 'down')}
        onPointerUp={(event) => handlePointer(event, 'up')}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
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
              'Attaching the interactive Browser page…'
            )
          : translate(
              'auto.components.maestro.MaestroWorkspaceBrowserPreview.reconnecting',
              'Reconnecting the interactive Browser page…'
            )}
      </p>
    </div>
  )
}
