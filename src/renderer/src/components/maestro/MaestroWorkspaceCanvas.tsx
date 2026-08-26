import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import { workspaceSurfaceKey } from '../../../../shared/maestro-workspace-canvas'
import type { RuntimeMaestroWorkspaceCanvasScope } from '../../../../shared/runtime-types'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { useMaestroWorkspaceCanvas } from '@/hooks/useMaestroWorkspaceCanvas'
import { MaestroWorkspaceLinks } from './MaestroWorkspaceLinks'
import { MaestroWorkspaceHarnessOverlay } from './MaestroWorkspaceHarnessOverlay'
import {
  createMaestroSurfaceAdditionTracker,
  workspaceWindowBounds,
  workspaceWindowPlacement,
  type MaestroWorkspaceWindowPlacement
} from './maestro-workspace-window-layout'
import { useMaestroWorkspaceViewport } from './useMaestroWorkspaceViewport'
import { translate } from '@/i18n/i18n'
import { MaestroWorkspaceToolbar } from './MaestroWorkspaceToolbar'
import { MaestroWorkspaceContextMenu } from './MaestroWorkspaceContextMenu'
import { MaestroWorkspaceWindowLayer } from './MaestroWorkspaceWindowLayer'
import { useMaestroWorkspaceRunProgress } from './useMaestroWorkspaceRunProgress'

const surfaceAdditionTracker = createMaestroSurfaceAdditionTracker()
const REVEAL_INSETS = { top: 64, right: 344, bottom: 16, left: 16 } as const

function initialPlacements(document: WorkspaceCanvasDocument, surfaceKeys: readonly string[]) {
  return Object.fromEntries(
    surfaceKeys.map((surfaceKey, index) => [
      surfaceKey,
      workspaceWindowPlacement(surfaceKey, index, document)
    ])
  )
}

function samePlacementGeometry(
  left: MaestroWorkspaceWindowPlacement,
  right: MaestroWorkspaceWindowPlacement
): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.size.width === right.size.width &&
    left.size.height === right.size.height &&
    left.collapsed === right.collapsed
  )
}

export function MaestroWorkspaceCanvas({
  target,
  scope
}: {
  target: RuntimeClientTarget
  scope: RuntimeMaestroWorkspaceCanvasScope
}): React.JSX.Element {
  const resource = useMaestroWorkspaceCanvas(target, scope)
  const result = resource.result
  const surfaceKeys = useMemo(
    () => (result ? Object.keys(result.snapshot.surfaces).sort() : []),
    [result]
  )
  const [placements, setPlacements] = useState<
    Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
  >({})
  const optimisticPlacements = useRef<Record<string, MaestroWorkspaceWindowPlacement>>({})
  const runProgress = useMaestroWorkspaceRunProgress(target, scope)

  useEffect(() => {
    if (!result) {
      return
    }
    const authoritative = initialPlacements(result.canvas.document, surfaceKeys)
    setPlacements(() =>
      Object.fromEntries(
        surfaceKeys.map((surfaceKey) => {
          const optimistic = optimisticPlacements.current[surfaceKey]
          const confirmed = authoritative[surfaceKey]
          if (!optimistic || !confirmed) {
            return [surfaceKey, confirmed]
          }
          if (samePlacementGeometry(optimistic, confirmed)) {
            delete optimisticPlacements.current[surfaceKey]
            return [surfaceKey, confirmed]
          }
          if (
            resource.mutation?.status === 'stale' ||
            resource.mutation?.status === 'cancelled' ||
            resource.mutation?.status === 'unavailable'
          ) {
            delete optimisticPlacements.current[surfaceKey]
            return [surfaceKey, confirmed]
          }
          return [surfaceKey, optimistic]
        })
      )
    )
  }, [resource.mutation?.status, result, surfaceKeys])

  const pendingSurfaceKey = useMemo(
    () =>
      resource.mutation &&
      (resource.mutation.status === 'outcome_unknown' || resource.mutation.status === 'cancelled')
        ? resource.mutation.surface_id
          ? workspaceSurfaceKey(resource.mutation.surface_id)
          : null
        : null,
    [resource.mutation]
  )
  const board = useMaestroWorkspaceViewport({
    canvasRevision: result?.canvas.revision ?? 0,
    persisted: result?.canvas.document.viewport,
    placements,
    resource,
    mutationIdentity: scope.workspace_key
  })
  const revealPlacement = board.reveal

  useEffect(() => {
    if (!result) {
      return
    }
    const additions = surfaceAdditionTracker.observe(
      `${scope.execution_host_id}:${scope.workspace_key}`,
      surfaceKeys,
      board.viewportReady
    )
    const addedSurfaceKey = additions.at(-1)
    if (!addedSurfaceKey) {
      return
    }
    const placement = workspaceWindowPlacement(
      addedSurfaceKey,
      surfaceKeys.indexOf(addedSurfaceKey),
      result.canvas.document
    )
    revealPlacement(workspaceWindowBounds(placement), REVEAL_INSETS)
  }, [
    board.viewportReady,
    result,
    revealPlacement,
    scope.execution_host_id,
    scope.workspace_key,
    surfaceKeys
  ])

  if (!result && resource.status === 'loading') {
    return (
      <main className="flex size-full items-center justify-center bg-background" aria-live="polite">
        <Loader2 className="mr-2 size-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.0e5b5d9947',
            'Loading workspace resources…'
          )}
        </p>
      </main>
    )
  }

  if (!result) {
    return (
      <main
        className="flex size-full items-center justify-center bg-background p-6"
        aria-live="polite"
      >
        <section className="max-w-md text-center">
          <h1 className="text-sm font-medium">
            {translate(
              'auto.components.maestro.MaestroWorkspaceCanvas.a45c57a610',
              'Workspace Canvas unavailable'
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resource.unavailableReason === 'update-required'
              ? translate(
                  'auto.components.maestro.MaestroWorkspaceCanvas.1dd7a6a069',
                  'Update the remote Orca host to view this workspace.'
                )
              : translate(
                  'auto.components.maestro.MaestroWorkspaceCanvas.799110bdc4',
                  'The workspace authority is unreachable. No resource was treated as exited.'
                )}
          </p>
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            onClick={() => void resource.refresh()}
          >
            <RefreshCw />{' '}
            {translate('auto.components.maestro.MaestroWorkspaceCanvas.48149211a4', 'Retry')}
          </Button>
        </section>
      </main>
    )
  }

  const snapshot = result.snapshot
  const document = result.canvas.document
  return (
    <main
      className="relative size-full overflow-hidden bg-background"
      data-maestro-workspace-canvas=""
      data-authority-state={resource.status}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--background) 96%, var(--foreground))',
              backgroundImage:
                'linear-gradient(to right, color-mix(in srgb, var(--foreground) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 8%, transparent) 1px, transparent 1px)',
              ...board.canvasStyle
            }}
            ref={board.canvasRef}
            onWheel={board.onWheel}
            onPointerDown={board.onPointerDown}
            onPointerMove={board.onPointerMove}
            onPointerUp={board.onPointerUp}
            onPointerCancel={board.onPointerUp}
          />
        </ContextMenuTrigger>
        <MaestroWorkspaceContextMenu resource={resource} workspaceKey={scope.workspace_key} />
      </ContextMenu>
      <MaestroWorkspaceToolbar board={board} />

      {resource.status === 'unavailable' ? (
        <div className="absolute left-3 right-3 top-14 z-30 flex items-center justify-center gap-2 rounded-md border border-destructive/50 bg-card px-3 py-2 text-center text-xs font-medium text-destructive shadow-xs">
          <TriangleAlert className="size-3.5 shrink-0" />
          {translate(
            'auto.components.maestro.MaestroWorkspaceCanvas.ac3e558e63',
            'Authority unavailable. Last-known resources remain unverifiable.'
          )}
        </div>
      ) : null}
      {resource.mutation?.status === 'cancelled' ||
      resource.mutation?.status === 'outcome_unknown' ? (
        <div className="absolute bottom-3 left-3 z-40 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-xs">
          {resource.mutation.status === 'cancelled'
            ? translate(
                'auto.components.maestro.MaestroWorkspaceCanvas.d4d2b3932b',
                'The action was cancelled. The window remains open.'
              )
            : translate(
                'auto.components.maestro.MaestroWorkspaceCanvas.d4bfd06870',
                'The outcome is unknown. The window remains until authority confirms it.'
              )}
        </div>
      ) : null}
      {resource.mutation?.status === 'unavailable' ? (
        <div className="absolute bottom-3 left-3 z-40 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-xs">
          {resource.mutation.reason ??
            translate(
              'auto.components.maestro.MaestroWorkspaceCanvas.5036690f36',
              'This action is unavailable from the workspace authority.'
            )}
        </div>
      ) : null}

      {!surfaceKeys.length ? (
        <section className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 pt-16 text-center">
          <div className="max-w-sm">
            <h1 className="text-sm font-medium">
              {translate(
                'auto.components.maestro.MaestroWorkspaceCanvas.402ed16622',
                'No workspace resources yet'
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {translate(
                'auto.components.maestro.MaestroWorkspaceCanvas.1605610d90',
                'Right-click the board to add a Terminal, Browser, or annotation. A Harness Run is optional.'
              )}
            </p>
          </div>
        </section>
      ) : null}

      <MaestroWorkspaceLinks
        snapshot={snapshot}
        document={document}
        placements={placements}
        style={board.worldStyle}
      />
      <MaestroWorkspaceWindowLayer
        target={target}
        resource={resource}
        snapshot={snapshot}
        document={document}
        surfaceKeys={surfaceKeys}
        pendingSurfaceKey={pendingSurfaceKey}
        placements={placements}
        setPlacements={setPlacements}
        optimisticPlacements={optimisticPlacements}
        worldStyle={board.worldStyle}
        onRevealPlacement={(placement) =>
          board.reveal(workspaceWindowBounds(placement), REVEAL_INSETS)
        }
      />
      {runProgress ? (
        <MaestroWorkspaceHarnessOverlay
          progress={runProgress}
          authorityUnavailable={resource.status === 'unavailable'}
        />
      ) : null}
    </main>
  )
}
