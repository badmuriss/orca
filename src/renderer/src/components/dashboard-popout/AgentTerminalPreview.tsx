import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { subscribeToTerminalUserInput } from '@/components/terminal-pane/terminal-user-input-signal'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/terminal-appearance'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { useEffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/use-effective-mac-option-as-alt'
import {
  buildPreviewAppearanceOptions,
  buildPreviewTerminalOptions
} from './preview-terminal-options'
import { syncPreviewTerminalLigatures } from './preview-terminal-ligatures'
import { installPreviewTerminalCompatibility } from './preview-terminal-compatibility'
import { createPreviewClipboardPaster } from './preview-terminal-paste'
import { installPreviewImeBridge, type PreviewImeBridge } from './preview-terminal-ime-bridge'
import type { DashboardCardTerminalInput } from '../../../../shared/dashboard-snapshot'
import { translate } from '@/i18n/i18n'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { installPreviewTerminalKeyHandler } from './preview-terminal-key-handler'
import { createPreviewGridClaim } from './preview-grid-claim'
import { installPreviewTerminalAppMenuClipboard } from './preview-terminal-app-menu-clipboard'
import {
  createAgentTerminalPreviewFitScheduler,
  createAgentTerminalPreviewWriter,
  preparePassiveAgentTerminalOutput,
  subscribeAgentTerminalPreviewStream
} from './agent-terminal-preview-stream'

const PREVIEW_SCROLLBACK_ROWS = 24
// Why: main only ever serializes PREVIEW_SCROLLBACK_ROWS of history into this
// terminal, so the pane's user-configured scrollback would only cost memory.
const PREVIEW_SCROLLBACK_BUFFER_ROWS = 1000
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24
const RESYNC_RETRY_DELAY_MS = 150

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export type AgentTerminalPreviewMode = 'interactive' | 'passive'

/** Renders the exact PTY through a DOM xterm, with optional interactive ownership. */
export function AgentTerminalPreview({
  ptyId,
  terminalInput = null,
  autoFocus = true,
  className,
  mode = 'interactive'
}: {
  ptyId: string
  /** Host-input facts relayed with the card; null routes bytes by client OS. */
  terminalInput?: DashboardCardTerminalInput | null
  autoFocus?: boolean
  className?: string
  mode?: AgentTerminalPreviewMode
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const scheduleFitRef = useRef<(() => void) | null>(null)
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const macOptionAsAlt = useEffectiveMacOptionAsAlt(settings?.terminalMacOptionAsAlt)
  // Why: keys and appearance must read live values without remounting the
  // terminal (a remount reconnects the pty and repaints from a new snapshot).
  const settingsRef = useRef(settings)
  const macOptionAsAltRef = useRef(macOptionAsAlt)
  const terminalInputRef = useRef(terminalInput)
  const { terminalTheme, terminalMode } = useMemo(() => {
    if (!settings) {
      return { terminalTheme: null, terminalMode: 'dark' as const }
    }
    const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    const theme = composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    )
    return { terminalTheme: theme, terminalMode: appearance.mode }
  }, [settings, systemPrefersDark])
  // A null snapshot means no serializer knows this pty (it died or was never
  // spawned this session) — say so instead of painting a silent blank terminal.
  const [ptyGone, setPtyGone] = useState(false)

  // Why: refs are seeded at first render and refreshed on commit — assigning
  // during render trips react-compiler. Layout, not passive: xterm's keydown is
  // a native listener, so React would not flush a passive effect before the
  // next keystroke and a just-relayed profile could miss it.
  useLayoutEffect(() => {
    settingsRef.current = settings
    macOptionAsAltRef.current = macOptionAsAlt
    terminalInputRef.current = terminalInput
  }, [settings, macOptionAsAlt, terminalInput])

  useEffect(() => {
    setPtyGone(false)
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let terminal: Terminal | null = null
    let offData: (() => void) | null = null
    let userInputDisposable: { dispose: () => void } | null = null
    let imeBridge: PreviewImeBridge | null = null
    let disposeKeyHandler: (() => void) | null = null
    let disposeTerminalCompatibility: (() => void) | null = null
    let disposeAppMenuClipboard: (() => void) | null = null
    let refreshInFlight = false
    let refreshAgain = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const fitScheduler = createAgentTerminalPreviewFitScheduler({
      container,
      getTerminal: () => terminal
    })
    const scheduleFit = fitScheduler.schedule
    scheduleFitRef.current = scheduleFit

    let gridClaim =
      mode === 'interactive'
        ? createPreviewGridClaim({
            ptyId,
            container,
            getTerminal: () => terminal
          })
        : null
    // Box growth/shrink (window resize) changes the reachable grid.
    const boxResizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            scheduleFit()
            gridClaim?.schedule()
          })
    if (container.parentElement) {
      boxResizeObserver?.observe(container.parentElement)
    }
    boxResizeObserver?.observe(container)
    const previewWriter = createAgentTerminalPreviewWriter({
      ptyId,
      getTerminal: () => terminal,
      isDisposed: () => disposed,
      onParsedWrite: mode === 'interactive' ? scheduleFit : () => undefined
    })

    const pasteClipboardText =
      mode === 'interactive'
        ? createPreviewClipboardPaster({
            ptyId,
            container,
            getTerminal: () => terminal,
            getTerminalInput: () => terminalInputRef.current,
            isDisposed: () => disposed
          })
        : null

    const disposeImeNativeTextBridge = (): void => {
      imeBridge?.dispose()
      imeBridge = null
    }

    const installImeNativeTextBridge = (): void => {
      if (terminal) {
        // Why a live getter: kitty state can change between keydown and commit,
        // and the tracker outlives every reconnect inside this effect.
        imeBridge = installPreviewImeBridge(terminal, {
          getKittyKeyboardFlags: () => previewWriter.kittyKeyboardModes.flags
        })
      }
    }

    const installKeyHandler = (): void => {
      if (!terminal || !pasteClipboardText) {
        return
      }
      disposeKeyHandler = installPreviewTerminalKeyHandler({
        terminal,
        claimImeKeyEvent: (event) => imeBridge?.claimKeyEvent(event) ?? false,
        pasteClipboardText: (activeElement, source) =>
          void pasteClipboardText(activeElement, source),
        // Why: route through terminal.input so the chord's bytes carry core's user-input signal, like typed keys.
        sendInput: (data) => terminal?.input(data),
        getShortcutContext: () => ({
          clientPlatform: getShortcutPlatform(),
          macOptionAsAlt: macOptionAsAltRef.current,
          keybindings: useAppStore.getState().keybindings,
          terminalInput: terminalInputRef.current,
          getKittyKeyboardFlags: () => previewWriter.kittyKeyboardModes.flags,
          terminalShortcutPolicy: settingsRef.current?.terminalShortcutPolicy
        })
      })
    }

    const installTerminalCompatibility = (): void => {
      if (!terminal) {
        return
      }
      disposeTerminalCompatibility = installPreviewTerminalCompatibility(terminal, {
        getSettings: () => settingsRef.current
      })
    }

    const installInputRouting = (): void => {
      if (!terminal) {
        return
      }
      let pendingUserInputSignals = 0
      userInputDisposable = subscribeToTerminalUserInput(terminal, () => {
        pendingUserInputSignals = Math.min(32, pendingUserInputSignals + 1)
      })
      terminal.onData((data) => {
        const signaledUserInput = pendingUserInputSignals > 0
        if (signaledUserInput) {
          pendingUserInputSignals--
        }
        // Why: core's signal distinguishes real input from parser replies, so typing survives live replay without forwarding synthetic CPR/DA bytes.
        if (userInputDisposable ? !signaledUserInput : previewWriter.isReplaying()) {
          return
        }
        void window.api.terminalPreview.input(ptyId, data)
      })
    }

    let resourcesReleased = false
    const releaseResources = (): void => {
      if (resourcesReleased) {
        return
      }
      resourcesReleased = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      fitScheduler.dispose()
      if (scheduleFitRef.current === scheduleFit) {
        scheduleFitRef.current = null
      }
      gridClaim?.dispose()
      gridClaim = null
      boxResizeObserver?.disconnect()
      disposeAppMenuClipboard?.()
      disposeAppMenuClipboard = null
      offData?.()
      offData = null
      userInputDisposable?.dispose()
      userInputDisposable = null
      disposeImeNativeTextBridge()
      disposeTerminalCompatibility?.()
      disposeTerminalCompatibility = null
      disposeKeyHandler?.()
      disposeKeyHandler = null
      void window.api.terminalPreview.unsubscribe(ptyId)
      terminal?.dispose()
      terminal = null
      terminalRef.current = null
    }

    const replayConnection = (
      connection: Awaited<ReturnType<typeof window.api.terminalPreview.connect>>,
      replaceExisting: boolean,
      requestRefresh: () => void
    ): void => {
      const snap = connection.snapshot!
      if (!terminal) {
        terminal = new Terminal({
          ...buildPreviewTerminalOptions({
            settings: settingsRef.current,
            terminalInput: terminalInputRef.current,
            macOptionIsMeta: macOptionAsAltRef.current === 'true',
            theme: terminalTheme,
            themeMode: terminalMode,
            cols: clamp(snap.cols ?? FALLBACK_COLS, 2, 500),
            rows: clamp(snap.rows ?? FALLBACK_ROWS, 2, 200),
            scrollback: PREVIEW_SCROLLBACK_BUFFER_ROWS
          }),
          ...(mode === 'passive' ? { disableStdin: true } : {})
        })
        try {
          terminal.open(container)
        } catch {
          terminal.dispose()
          terminal = null
          return
        }
        terminalRef.current = terminal
        if (mode === 'passive') {
          preparePassiveAgentTerminalOutput(terminal, settingsRef.current)
        } else {
          installTerminalCompatibility()
          installInputRouting()
          installImeNativeTextBridge()
          installKeyHandler()
        }
      } else if (replaceExisting) {
        // Why: keep the old frame visible during capture, then atomically replace it once the authoritative snapshot arrives.
        terminal.resize(
          clamp(snap.cols ?? FALLBACK_COLS, 2, 500),
          clamp(snap.rows ?? FALLBACK_ROWS, 2, 200)
        )
        terminal.reset()
      }
      previewWriter.replay(connection)
      if (connection.resyncRequired) {
        refreshAgain = false
        // Why: sustained output can overflow every capture; delay retries so recovery cannot spin two serializations per event-loop turn.
        previewWriter.writeBarrier(() => {
          if (disposed || retryTimer) {
            return
          }
          retryTimer = setTimeout(() => {
            retryTimer = null
            requestRefresh()
          }, RESYNC_RETRY_DELAY_MS)
        })
      } else if (refreshAgain) {
        refreshAgain = false
        // Queue behind every replay write so replacement never clears a half-parsed frame.
        previewWriter.writeBarrier(requestRefresh)
      }
      if (mode === 'passive') {
        previewWriter.writeBarrier(scheduleFit)
      } else {
        scheduleFit()
        gridClaim?.schedule()
      }
      if (mode === 'interactive' && autoFocus) {
        terminal.focus()
      }
    }

    const setup = async (replaceExisting = false): Promise<void> => {
      if (refreshInFlight) {
        refreshAgain = true
        return
      }
      refreshInFlight = true
      const connection = await window.api.terminalPreview.connect(ptyId, {
        scrollbackRows: PREVIEW_SCROLLBACK_ROWS
      })
      if (disposed) {
        return
      }
      const snap = connection.snapshot
      if (!snap) {
        refreshInFlight = false
        setPtyGone(true)
        disposed = true
        releaseResources()
        return
      }
      refreshInFlight = false
      if (!connection.resyncRequired && retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      replayConnection(connection, replaceExisting, () => void setup(true))
    }

    if (pasteClipboardText) {
      disposeAppMenuClipboard = installPreviewTerminalAppMenuClipboard({
        container,
        getTerminal: () => terminal,
        pasteClipboardText
      })
    }

    offData = subscribeAgentTerminalPreviewStream(ptyId, (payload) => {
      if (payload.type === 'resync') {
        void setup(true)
        return
      }
      previewWriter.writeLive(payload)
    })

    void setup()

    return () => {
      disposed = true
      releaseResources()
    }
  }, [autoFocus, mode, ptyId, terminalTheme, terminalMode])

  // Why: appearance settings must land on the open terminal, and the OS input
  // source can flip Option-as-Alt with no settings change at all. A remount
  // would reconnect the pty and repaint the agent's screen from a new snapshot.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    Object.assign(
      terminal.options,
      buildPreviewAppearanceOptions(settings, macOptionAsAlt === 'true')
    )
    syncPreviewTerminalLigatures(terminal, settings)
    scheduleFitRef.current?.()
  }, [settings, macOptionAsAlt])

  return (
    // Why: a size FIXED by the viewport (not shrink-to-fit) + overflow-hidden
    // keeps the dialog stable no matter how wide/tall the pane's serialized
    // buffer is. The terminal keeps the pane's true dimensions and is scaled/
    // clipped to fit; fitToBox anchors whichever end keeps the cursor in view.
    <div
      data-terminal-preview-mode={mode}
      className={cn(
        'relative h-[calc(100vh-140px)] w-full overflow-hidden bg-background p-1.5',
        className
      )}
      style={terminalTheme?.background ? { backgroundColor: terminalTheme.background } : undefined}
    >
      {ptyGone ? (
        <div className="absolute inset-0 flex items-center justify-center px-2.5 py-8 text-center text-[11px] text-muted-foreground">
          {translate(
            'dashboardPopout.terminal.closed',
            "No live terminal — this agent's pane has closed."
          )}
        </div>
      ) : null}
      <div
        aria-hidden={ptyGone || undefined}
        className={cn('flex h-full w-full items-end overflow-hidden', ptyGone && 'invisible')}
      >
        <div
          ref={containerRef}
          className={cn(
            'origin-bottom-left',
            mode === 'passive' && 'pointer-events-none select-none'
          )}
        />
      </div>
    </div>
  )
}
