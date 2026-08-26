import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { MaestroDocument, MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { MaestroCanvasEmptyState } from './MaestroCanvasEmptyState'
import { MaestroCanvasInspectorSlot } from './MaestroCanvasInspectorSlot'
import { MaestroCanvasOverlays } from './MaestroCanvasOverlays'
import { MaestroCanvasScene } from './MaestroCanvasScene'
import { MaestroCanvasToolbar } from './MaestroCanvasToolbar'
import {
  canvasPointerToWorld,
  INITIAL_MAESTRO_VIEWPORT,
  type MaestroCanvasPoint,
  type MaestroCanvasNode,
  type MaestroSpatialGraph
} from './maestro-canvas-view-model'
import { clampMaestroZoom, maestroBoardGridStep } from './maestro-canvas-viewport'
import { resolveProgressInspection } from './maestro-progress-inspection'
import './maestro-canvas.css'
import { useMaestroAuthoring } from './useMaestroAuthoring'
import { useMaestroCanvasLayout } from './useMaestroCanvasLayout'
import { useMaestroDelegation, type DelegationContext } from './useMaestroDelegation'
import {
  getMaestroCanvasPointDelegationContext,
  getMaestroNodeDelegationContext
} from './maestro-delegation-context'
import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import { translate } from '@/i18n/i18n'

export type {
  MaestroCanvasEdge,
  MaestroCanvasNode,
  MaestroSpatialGraph
} from './maestro-canvas-view-model'
export {
  delegationParentOptions,
  getMaestroCanvasPointDelegationContext,
  getMaestroNodeDelegationContext
} from './maestro-delegation-context'

type MaestroCanvasProps = {
  document: MaestroDocument
  documentKey: { executionHostId: string; workspaceKey: string }
  revision?: number
  runtimeTarget?: RuntimeClientTarget | null
  graph?: MaestroSpatialGraph
  onPositionChange?: (nodeId: string, position: MaestroCanvasPoint) => void
  onConflict?: () => void
  onDocumentChanged?: () => void
}

function mutationId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

export function MaestroCanvas({
  document,
  documentKey,
  revision,
  runtimeTarget = null,
  graph,
  onPositionChange,
  onConflict,
  onDocumentChanged
}: MaestroCanvasProps): React.JSX.Element {
  const layout = useMaestroCanvasLayout({
    document,
    documentKey,
    revision,
    runtimeTarget,
    graph,
    onPositionChange,
    onConflict
  })
  const [contextMenu, setContextMenu] = useState<{
    pointer: MaestroCanvasPoint
    world: MaestroCanvasPoint
    node?: MaestroCanvasNode
  } | null>(null)
  const [inspectedProgressIdentity, setInspectedProgressIdentity] =
    useState<MaestroRunProgressDetailIdentity | null>(null)
  const delegationWorkspace: MaestroWorkspaceAnchor | null = layout.projection
    ? {
        repository_id: layout.projection.repositoryId,
        execution_host_id: layout.projection.workspace.executionHostId,
        workspace_key: layout.projection.workspace.workspaceKey,
        run_id: layout.projection.runId
      }
    : null
  const authoring = useMaestroAuthoring({
    document,
    workspace: delegationWorkspace,
    revisionRef: layout.revisionRef,
    runtimeTarget,
    nodesById: layout.nodesById,
    selectedIds: layout.selectedIds,
    onConflict,
    onDocumentChanged
  })
  const delegation = useMaestroDelegation({ target: runtimeTarget, workspace: delegationWorkspace })
  const clearSelection = useCallback(() => {
    setInspectedProgressIdentity(null)
    layout.setSelectedIds(new Set())
  }, [layout])
  const inspectProgressReference = useCallback(
    (identity: MaestroRunProgressDetailIdentity): void => {
      const resolved = resolveProgressInspection({
        identity,
        nodes: layout.nodes,
        projection: layout.projection,
        documentKey
      })
      if (!resolved.open) {
        return
      }
      setInspectedProgressIdentity(identity)
      if (resolved.nodeId) {
        layout.selectNode(resolved.nodeId, false)
      } else {
        layout.setSelectedIds(new Set())
      }
    },
    [documentKey, layout]
  )
  const dismissContextMenu = useCallback((): void => {
    setContextMenu(null)
    layout.canvasRef.current?.focus()
  }, [layout])
  const openContextMenu = useCallback(
    (
      worldPointer: MaestroCanvasPoint,
      menuPointer: MaestroCanvasPoint = { x: layout.size.width / 2, y: layout.size.height / 2 }
    ): void => {
      setContextMenu({
        pointer: menuPointer,
        world: canvasPointerToWorld(layout.viewportRef.current, layout.size, worldPointer),
        node: undefined
      })
    },
    [layout]
  )
  const openNodeContextMenu = useCallback(
    (nodeId: string, event: MouseEvent<HTMLElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      const bounds = layout.canvasRef.current?.getBoundingClientRect()
      const pointer = bounds
        ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        : { x: layout.size.width / 2, y: layout.size.height / 2 }
      setContextMenu({
        pointer,
        world: canvasPointerToWorld(layout.viewportRef.current, layout.size, pointer),
        node: layout.nodesById.get(nodeId)
      })
    },
    [layout]
  )
  const delegationContext: DelegationContext | null = contextMenu?.node
    ? getMaestroNodeDelegationContext(contextMenu.node, layout.nodes, delegationWorkspace)
    : contextMenu
      ? getMaestroCanvasPointDelegationContext(contextMenu.world)
      : null
  const openDelegation = useCallback((): void => {
    if (delegationContext) {
      dismissContextMenu()
      delegation.openDelegation(delegationContext)
    }
  }, [delegation, delegationContext, dismissContextMenu])
  const createNote = useCallback((): void => {
    if (!contextMenu) {
      return
    }
    authoring.openNoteEditor({
      nodeId: `note-${mutationId()}`,
      title: translate('auto.components.maestro.MaestroCanvas.dfb4b73506', 'New context note'),
      markdown: '# New context\n\nWrite a bounded note for this workspace.',
      position: contextMenu.world,
      noteRevision: null
    })
    setContextMenu(null)
  }, [authoring, contextMenu])
  const gridStep = maestroBoardGridStep(layout.viewport.zoom)
  const activateNode = useCallback(
    (nodeId: string, extend: boolean, openNote: boolean): void => {
      setInspectedProgressIdentity(null)
      layout.selectNode(nodeId, extend)
      const node = layout.nodesById.get(nodeId)
      if (openNote && node?.kind === 'note') {
        authoring.openNoteEditor({
          nodeId: node.id,
          title: node.title,
          markdown: node.markdown ?? '',
          position: node.position,
          noteRevision: node.noteRevision ?? 1,
          contextSnapshotRevision: node.contextSnapshotId
        })
      }
    },
    [authoring, layout]
  )
  // A captured pointer retargets the following click to the board, so selecting on
  // click alone means a real mouse never selects a window.
  const pointerSelectedRef = useRef<string | null>(null)
  const handleNodePointerDown = useCallback(
    (nodeId: string, event: PointerEvent<HTMLElement>): void => {
      if (event.button === 0) {
        pointerSelectedRef.current = nodeId
        activateNode(nodeId, event.shiftKey, event.detail === 2)
      }
      layout.handleNodePointerDown(nodeId, event)
    },
    [activateNode, layout]
  )
  const handleNodeClick = useCallback(
    (nodeId: string, event: MouseEvent<HTMLElement>): void => {
      const alreadyHandled = pointerSelectedRef.current === nodeId
      pointerSelectedRef.current = null
      if (alreadyHandled) {
        return
      }
      activateNode(nodeId, event.shiftKey, event.detail === 2)
    },
    [activateNode]
  )
  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent<SVGSVGElement>): void => {
      if (event.key !== 'ContextMenu' && (event.key !== 'F10' || !event.shiftKey)) {
        return
      }
      event.preventDefault()
      const center = { x: layout.size.width / 2, y: layout.size.height / 2 }
      openContextMenu(center, center)
    },
    [layout.size, openContextMenu]
  )

  return (
    <main
      className="relative size-full min-h-0 overflow-hidden bg-background"
      aria-label={translate('auto.components.maestro.MaestroCanvas.db4f814789', 'Maestro Canvas')}
      data-maestro-canvas=""
    >
      <MaestroCanvasToolbar
        nodes={layout.nodes}
        search={layout.search}
        onSearchChange={layout.setSearch}
        onFocusNode={layout.focusNode}
        viewport={layout.viewport}
        onZoom={(factor) =>
          layout.scheduleViewportCommit({
            ...layout.viewportRef.current,
            zoom: clampMaestroZoom(layout.viewportRef.current.zoom * factor)
          })
        }
        onFit={layout.fit}
        onReset={() => layout.scheduleViewportCommit(INITIAL_MAESTRO_VIEWPORT)}
        canUndo={Boolean(authoring.undoMutation)}
        canRedo={Boolean(authoring.redoMutation)}
        onUndo={() => {
          if (authoring.undoMutation) {
            void authoring.commitAuthoring({
              kind: 'undo',
              target_mutation_id: authoring.undoMutation
            })
          }
        }}
        onRedo={() => {
          if (authoring.redoMutation) {
            void authoring.commitAuthoring({
              kind: 'redo',
              target_mutation_id: authoring.redoMutation
            })
          }
        }}
        onCreateLink={authoring.startLinkFromSelection}
      />
      <svg
        ref={layout.canvasRef}
        className="absolute inset-0 size-full touch-none select-none cursor-grab active:cursor-grabbing"
        viewBox={layout.viewBox}
        aria-label={translate('auto.components.maestro.MaestroCanvas.0b14203c57', 'Maestro graph')}
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
        onContextMenu={(event) => {
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
          openContextMenu(pointer, pointer)
        }}
        onWheel={layout.handleWheel}
        onPointerDown={layout.handleCanvasPointerDown}
        onPointerMove={layout.handlePointerMove}
        onPointerUp={layout.endPointerDrag}
        onPointerCancel={layout.endPointerDrag}
      >
        <defs>
          {/* Dots and rules are sized in world units but drawn at a constant
              on-screen weight, so the board stays faint at any zoom. */}
          <pattern
            id="maestro-grid-minor"
            width={gridStep}
            height={gridStep}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={gridStep / 2}
              cy={gridStep / 2}
              r={1.05 / layout.viewport.zoom}
              fill="var(--maestro-dot)"
            />
          </pattern>
          <pattern
            id="maestro-grid-major"
            width={gridStep * 5}
            height={gridStep * 5}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridStep * 5} 0 L 0 0 0 ${gridStep * 5}`}
              fill="none"
              stroke="var(--maestro-rule)"
              strokeWidth={1 / layout.viewport.zoom}
            />
          </pattern>
        </defs>
        <rect
          x={layout.worldRect.x}
          y={layout.worldRect.y}
          width={layout.worldRect.width}
          height={layout.worldRect.height}
          fill="var(--background)"
          data-maestro-board-grid="base"
        />
        <rect
          x={layout.worldRect.x}
          y={layout.worldRect.y}
          width={layout.worldRect.width}
          height={layout.worldRect.height}
          fill="url(#maestro-grid-minor)"
          pointerEvents="none"
          data-maestro-board-grid="minor"
        />
        <rect
          x={layout.worldRect.x}
          y={layout.worldRect.y}
          width={layout.worldRect.width}
          height={layout.worldRect.height}
          fill="url(#maestro-grid-major)"
          pointerEvents="none"
          data-maestro-board-grid="major"
        />
        <MaestroCanvasScene
          nodes={layout.visibleNodes}
          nodesById={layout.nodesById}
          edges={layout.visibleEdges}
          selectedIds={layout.selectedIds}
          nodeRefs={layout.nodeRefs}
          zoom={layout.viewport.zoom}
          reducedMotion={layout.reducedMotion}
          onLinkHandleClick={authoring.handleLinkHandle}
          onNodeResizePointerDown={layout.handleNodeResizePointerDown}
          runtimeTarget={runtimeTarget}
          onNodeClick={handleNodeClick}
          onNodePointerDown={handleNodePointerDown}
          onNodeKeyDown={layout.handleNodeKeyDown}
          onNodeContextMenu={openNodeContextMenu}
          onInspectReference={inspectProgressReference}
        />
      </svg>
      <MaestroCanvasOverlays
        contextMenu={contextMenu}
        layout={layout}
        authoring={authoring}
        delegation={delegation}
        delegationWorkspace={delegationWorkspace}
        onDismissContextMenu={dismissContextMenu}
        onOpenDelegation={openDelegation}
        onCreateNote={createNote}
      />
      {authoring.authoringError && !authoring.linkComposer ? (
        <p
          className="absolute bottom-3 left-3 z-20 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive shadow-xs"
          role="alert"
        >
          {authoring.authoringError}
        </p>
      ) : null}
      <MaestroCanvasInspectorSlot
        layout={layout}
        runtimeTarget={runtimeTarget}
        inspectedProgressIdentity={inspectedProgressIdentity}
        onClose={clearSelection}
      />
      {!layout.nodes.length ? <MaestroCanvasEmptyState /> : null}
      {layout.forcedNodeId ? (
        <span className="sr-only" data-maestro-focused-node={layout.forcedNodeId} />
      ) : null}
    </main>
  )
}
