import { useEffect, useRef, useState } from 'react'
import type {
  WorkspaceSurface,
  WorkspaceSurfaceSnapshot
} from '../../../../shared/maestro-workspace-canvas'

export type MaestroWorkspacePresencePhase = 'entering' | 'present' | 'exiting'

export type MaestroWorkspacePresenceItem = {
  surfaceKey: string
  surface: WorkspaceSurface
  phase: MaestroWorkspacePresencePhase
}

const ENTER_DURATION_MS = 260
const EXIT_DURATION_MS = 210

export function reconcileMaestroWorkspacePresence(
  current: readonly MaestroWorkspacePresenceItem[],
  snapshot: WorkspaceSurfaceSnapshot,
  surfaceKeys: readonly string[]
): MaestroWorkspacePresenceItem[] {
  const currentByKey = new Map(current.map((item) => [item.surfaceKey, item]))
  const visibleKeys = new Set(surfaceKeys)
  const next: MaestroWorkspacePresenceItem[] = []

  for (const surfaceKey of surfaceKeys) {
    const surface = snapshot.surfaces[surfaceKey]
    if (!surface) {
      continue
    }
    const existing = currentByKey.get(surfaceKey)
    next.push({
      surfaceKey,
      surface,
      phase: existing ? (existing.phase === 'exiting' ? 'entering' : existing.phase) : 'entering'
    })
  }

  for (const item of current) {
    if (!visibleKeys.has(item.surfaceKey)) {
      next.push({ ...item, phase: 'exiting' })
    }
  }

  return next
}

export function settleMaestroWorkspacePresence(
  current: readonly MaestroWorkspacePresenceItem[],
  surfaceKey: string,
  phase: MaestroWorkspacePresencePhase
): MaestroWorkspacePresenceItem[] {
  if (phase === 'exiting') {
    return current.filter((item) => item.surfaceKey !== surfaceKey || item.phase !== 'exiting')
  }
  return current.map((item) =>
    item.surfaceKey === surfaceKey && item.phase === phase ? { ...item, phase: 'present' } : item
  )
}

function initialPresenceItems(
  snapshot: WorkspaceSurfaceSnapshot,
  surfaceKeys: readonly string[]
): MaestroWorkspacePresenceItem[] {
  return surfaceKeys.flatMap((surfaceKey) => {
    const surface = snapshot.surfaces[surfaceKey]
    return surface ? [{ surfaceKey, surface, phase: 'present' as const }] : []
  })
}

export function useMaestroWorkspacePresence(
  snapshot: WorkspaceSurfaceSnapshot,
  surfaceKeys: readonly string[]
): readonly MaestroWorkspacePresenceItem[] {
  const [items, setItems] = useState(() => initialPresenceItems(snapshot, surfaceKeys))
  const timers = useRef(
    new Map<
      string,
      {
        phase: Exclude<MaestroWorkspacePresencePhase, 'present'>
        timer: ReturnType<typeof setTimeout>
      }
    >()
  )

  useEffect(() => {
    setItems((current) => reconcileMaestroWorkspacePresence(current, snapshot, surfaceKeys))
  }, [snapshot, surfaceKeys])

  useEffect(() => {
    const activeTimers = timers.current
    const transientByKey = new Map(
      items.flatMap((item) =>
        item.phase === 'present' ? [] : [[item.surfaceKey, item.phase] as const]
      )
    )

    for (const [surfaceKey, entry] of activeTimers) {
      if (transientByKey.get(surfaceKey) !== entry.phase) {
        clearTimeout(entry.timer)
        activeTimers.delete(surfaceKey)
      }
    }

    for (const [surfaceKey, phase] of transientByKey) {
      if (activeTimers.has(surfaceKey)) {
        continue
      }
      const duration = phase === 'entering' ? ENTER_DURATION_MS : EXIT_DURATION_MS
      const timer = setTimeout(() => {
        activeTimers.delete(surfaceKey)
        setItems((current) => settleMaestroWorkspacePresence(current, surfaceKey, phase))
      }, duration)
      activeTimers.set(surfaceKey, { phase, timer })
    }
  }, [items])

  useEffect(
    () => () => {
      for (const entry of timers.current.values()) {
        clearTimeout(entry.timer)
      }
      timers.current.clear()
    },
    []
  )

  return items
}
