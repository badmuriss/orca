import type { MutableRefObject } from 'react'
import { MaestroEdgeLayer } from './MaestroEdgeLayer'
import { MaestroNodeCard } from './MaestroNodeCard'
import { MaestroAgentCard } from './MaestroAgentCard'
import { MaestroPortalCard } from './MaestroPortalCard'
import { MaestroBrowserSurfaceCard } from './MaestroBrowserSurfaceCard'
import { MaestroRunProgressCard } from './MaestroRunProgressCard'
import { maestroNodeBounds } from './maestro-canvas-view-model'
import { MAESTRO_RESIZE_HANDLES, type MaestroResizeHandle } from './maestro-resize-handle'
import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import type { MaestroCanvasEdge, MaestroCanvasNode } from './MaestroCanvas'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

type MaestroCanvasSceneProps = {
  nodes: readonly MaestroCanvasNode[]
  nodesById: ReadonlyMap<string, MaestroCanvasNode>
  edges: readonly MaestroCanvasEdge[]
  selectedIds: ReadonlySet<string>
  nodeRefs: MutableRefObject<Map<string, HTMLElement>>
  zoom: number
  onNodeClick: (nodeId: string, event: React.MouseEvent<HTMLElement>) => void
  onNodePointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void
  onNodeKeyDown: (nodeId: string, event: React.KeyboardEvent<HTMLElement>) => void
  onNodeContextMenu: (nodeId: string, event: React.MouseEvent<HTMLElement>) => void
  onNodeResizePointerDown: (
    nodeId: string,
    handle: MaestroResizeHandle,
    event: React.PointerEvent<Element>
  ) => void
  onLinkHandleClick: (nodeId: string, role: 'source' | 'target') => void
  reducedMotion: boolean
  runtimeTarget: RuntimeClientTarget | null
  onInspectReference: (identity: MaestroRunProgressDetailIdentity) => void
}

const SELECTION_INSET_PX = 3
const HANDLE_PX = 7
const PORT_PX = 8

type Bounds = { x: number; y: number; width: number; height: number }

/** Every dimension is divided by zoom so handles keep a constant on-screen size. */
function MaestroSelectionChrome({
  node,
  bounds,
  screenPx,
  onResizePointerDown
}: {
  node: MaestroCanvasNode
  bounds: Bounds
  screenPx: number
  onResizePointerDown: (
    nodeId: string,
    handle: MaestroResizeHandle,
    event: React.PointerEvent<Element>
  ) => void
}): React.JSX.Element {
  const inset = SELECTION_INSET_PX * screenPx
  const handle = HANDLE_PX * screenPx
  const frame = {
    x: bounds.x - inset,
    y: bounds.y - inset,
    width: bounds.width + inset * 2,
    height: bounds.height + inset * 2
  }
  return (
    <g data-maestro-selection={node.id}>
      <rect
        className="maestro-selection-frame"
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        rx={13 * screenPx}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {MAESTRO_RESIZE_HANDLES.map((entry) => (
        <rect
          key={entry.handle}
          className="maestro-handle"
          data-maestro-resize-handle={entry.handle}
          aria-hidden
          style={{ ['--maestro-handle-cursor' as string]: entry.cursor }}
          x={frame.x + frame.width * entry.fx - handle / 2}
          y={frame.y + frame.height * entry.fy - handle / 2}
          width={handle}
          height={handle}
          rx={1.5 * screenPx}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => onResizePointerDown(node.id, entry.handle, event)}
        />
      ))}
    </g>
  )
}

function MaestroLinkPort({
  node,
  cx,
  cy,
  screenPx,
  role,
  onClick
}: {
  node: MaestroCanvasNode
  cx: number
  cy: number
  screenPx: number
  role: 'source' | 'target'
  onClick: (nodeId: string, role: 'source' | 'target') => void
}): React.JSX.Element {
  const radius = PORT_PX * screenPx
  const arm = 2.4 * screenPx
  const tip = role === 'source' ? arm * 0.9 : -arm * 0.9
  return (
    <g
      className="maestro-port"
      role="button"
      tabIndex={0}
      aria-label={
        role === 'source'
          ? translate(
              'auto.components.maestro.MaestroCanvasScene.1bc8e47d6d',
              'Link source {{value0}}',
              { value0: node.title }
            )
          : translate(
              'auto.components.maestro.MaestroCanvasScene.8d2e9babc2',
              'Link target {{value0}}',
              { value0: node.title }
            )
      }
      onClick={() => onClick(node.id, role)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(node.id, role)
        }
      }}
    >
      <circle cx={cx} cy={cy} r={radius} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path
        d={`M ${cx - tip} ${cy - arm} L ${cx + tip} ${cy} L ${cx - tip} ${cy + arm}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

export function MaestroCanvasScene({
  nodes,
  nodesById,
  edges,
  selectedIds,
  nodeRefs,
  zoom,
  onNodeClick,
  onNodePointerDown,
  onNodeKeyDown,
  onNodeContextMenu,
  onNodeResizePointerDown,
  onLinkHandleClick,
  reducedMotion,
  runtimeTarget,
  onInspectReference
}: MaestroCanvasSceneProps): React.JSX.Element {
  const screenPx = 1 / Math.max(zoom, 0.05)
  return (
    <>
      <MaestroEdgeLayer edges={edges} nodesById={nodesById} />
      {nodes.map((node) => {
        const bounds = maestroNodeBounds(node)
        const selected = selectedIds.has(node.id)
        const captureRef = (element: HTMLElement | null) => {
          if (element) {
            nodeRefs.current.set(node.id, element)
          } else {
            nodeRefs.current.delete(node.id)
          }
        }
        return (
          <g key={node.id}>
            <foreignObject x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}>
              {node.projectedType === 'run-progress' ? (
                <MaestroRunProgressCard
                  node={node}
                  selected={selected}
                  nodeRef={captureRef}
                  onClick={(event) => onNodeClick(node.id, event)}
                  onPointerDown={(event) => onNodePointerDown(node.id, event)}
                  onKeyDown={(event) => onNodeKeyDown(node.id, event)}
                  onInspectReference={onInspectReference}
                />
              ) : node.projectedType === 'evidence' && node.browserSurface ? (
                <MaestroBrowserSurfaceCard
                  nodeId={node.id}
                  receipt={node.browserSurface}
                  selected={selected}
                  previewSrc={node.browserPreviewUrl}
                  runtimeTarget={runtimeTarget}
                  nodeRef={captureRef}
                  onClick={(event) => onNodeClick(node.id, event)}
                  onPointerDown={(event) => onNodePointerDown(node.id, event)}
                  onKeyDown={(event) => onNodeKeyDown(node.id, event)}
                  onContextMenu={(event) => onNodeContextMenu(node.id, event)}
                  reducedMotion={reducedMotion}
                />
              ) : node.projectedType === 'portal' ? (
                <MaestroPortalCard
                  node={node}
                  selected={selected}
                  nodeRef={captureRef}
                  onClick={(event) => onNodeClick(node.id, event)}
                  onPointerDown={(event) => onNodePointerDown(node.id, event)}
                  onKeyDown={(event) => onNodeKeyDown(node.id, event)}
                  reducedMotion={reducedMotion}
                />
              ) : node.projectedType === 'attempt' || node.projectedType === 'task' ? (
                <MaestroAgentCard
                  node={node}
                  selected={selected}
                  nodeRef={captureRef}
                  onClick={(event) => onNodeClick(node.id, event)}
                  onPointerDown={(event) => onNodePointerDown(node.id, event)}
                  onKeyDown={(event) => onNodeKeyDown(node.id, event)}
                  onContextMenu={(event) => onNodeContextMenu(node.id, event)}
                  reducedMotion={reducedMotion}
                />
              ) : (
                <MaestroNodeCard
                  node={node}
                  selected={selected}
                  nodeRef={captureRef}
                  onClick={(event) => onNodeClick(node.id, event)}
                  onPointerDown={(event) => onNodePointerDown(node.id, event)}
                  onKeyDown={(event) => onNodeKeyDown(node.id, event)}
                  onContextMenu={(event) => onNodeContextMenu(node.id, event)}
                  reducedMotion={reducedMotion}
                />
              )}
            </foreignObject>
            {node.projectedType === 'run-progress' ? null : (
              <>
                <MaestroLinkPort
                  node={node}
                  cx={bounds.x}
                  cy={bounds.y + bounds.height / 2}
                  screenPx={screenPx}
                  role="target"
                  onClick={onLinkHandleClick}
                />
                <MaestroLinkPort
                  node={node}
                  cx={bounds.x + bounds.width}
                  cy={bounds.y + bounds.height / 2}
                  screenPx={screenPx}
                  role="source"
                  onClick={onLinkHandleClick}
                />
              </>
            )}
            {selected ? (
              <MaestroSelectionChrome
                node={node}
                bounds={bounds}
                screenPx={screenPx}
                onResizePointerDown={onNodeResizePointerDown}
              />
            ) : null}
          </g>
        )
      })}
    </>
  )
}
