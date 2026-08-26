import { app } from 'electron'
import {
  DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD,
  GPU_FALLBACK_CRASH_REASONS,
  isGpuChildProcessType,
  type GpuCrashFallbackTracker
} from '../crash-reporting/gpu-crash-fallback-decision'
import { writeGpuFallbackMarker, type LinuxGpuFallbackEnvironment } from './gpu-fallback-marker'

export function isLinuxDevGpuFallbackSession(options: {
  platform: NodeJS.Platform
  isDev: boolean
  isServeMode: boolean
}): boolean {
  return options.platform === 'linux' && options.isDev && !options.isServeMode
}

type LinuxDevGpuWatchDependencies = {
  tracker: GpuCrashFallbackTracker
  resolveMarkerEnvironment(): LinuxGpuFallbackEnvironment | null
  resolveUserDataPath(): string
  nowMs?: () => number
  log?: (message: string) => void
  warn?: (message: string) => void
  exit?: (exitCode: number) => void
}

/**
 * Why: on Linux dev hosts the GPU child can fail every launch (error_code=1002 burst) until
 * Chromium fatal-exits with "GPU process isn't usable", taking `pnpm dev` down into a
 * resubscribe/zombie loop. The shared child-process-gone handler registers only after window
 * creation and is win32-gated, so dev needs its own pre-window listener. Engagement persists the
 * build-scoped gpu-fallback marker, so the next launch boots software-rendered automatically;
 * packaged Linux never reaches this path (isLinuxDevGpuFallbackSession).
 */
export function installLinuxDevGpuFailureWatch(dependencies: LinuxDevGpuWatchDependencies): void {
  const now = dependencies.nowMs ?? (() => performance.now())
  const log = dependencies.log ?? ((message: string) => console.error(message))
  const warn = dependencies.warn ?? ((message: string) => console.warn(message))
  const exit = dependencies.exit ?? ((code: number) => app.exit(code))

  app.on('child-process-gone', (_event, details) => {
    if (!isGpuChildProcessType(details.type) || !GPU_FALLBACK_CRASH_REASONS.has(details.reason)) {
      return
    }
    const result = dependencies.tracker.recordGpuCrash(now())
    log(
      `[gpu-fallback] GPU child ${details.reason} (${result.crashesInWindow}/${DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD} in window)`
    )
    if (!result.shouldEngageFallback) {
      return
    }
    const environment = dependencies.resolveMarkerEnvironment()
    if (!environment) {
      return
    }
    try {
      writeGpuFallbackMarker(
        dependencies.resolveUserDataPath(),
        { engagedAt: Date.now(), crashesInWindow: result.crashesInWindow },
        environment
      )
    } catch (error) {
      warn(
        `[gpu-fallback] failed to persist marker: ${error instanceof Error ? error.message : error}`
      )
      return
    }
    // Why: exiting instead of relaunching here — electron-vite owns the dev server URL, so a
    // relaunched Electron would load a dead Vite origin. The persisted marker makes the next
    // `pnpm dev` software-rendered; quitting also stops parcel-watcher resubscribe churn.
    log(
      '[gpu-fallback] GPU child launches keep failing in this Linux dev session; hardware acceleration is disabled for the next launch. Rerun `pnpm dev`.'
    )
    exit(1)
  })
}
