import type { MaestroCanvasEdge, MaestroCanvasNode } from './MaestroCanvas'
import type { MaestroCanvasEdgeType, MaestroEdgeDirection } from './maestro-canvas-view-model'
import { maestroNodeBounds } from './maestro-canvas-view-model'

export type MaestroRenderedEdge = MaestroCanvasEdge & {
  type?: MaestroCanvasEdgeType
  direction?: MaestroEdgeDirection
  projected?: boolean
}

type MaestroEdgeLayerProps = {
  edges: readonly MaestroRenderedEdge[]
  nodesById: ReadonlyMap<string, MaestroCanvasNode>
}

function edgeGeometry(
  source: MaestroCanvasNode,
  target: MaestroCanvasNode
): {
  path: string
  labelX: number
  labelY: number
} {
  const sourceBounds = maestroNodeBounds(source)
  const targetBounds = maestroNodeBounds(target)
  const startX = source.position.x + sourceBounds.width
  const startY = source.position.y + sourceBounds.height / 2
  const endX = target.position.x
  const endY = target.position.y + targetBounds.height / 2
  const middleX = startX + (endX - startX) / 2
  return {
    path: `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`,
    labelX: middleX,
    labelY: (startY + endY) / 2 - 8
  }
}

function edgeLabel(type: MaestroCanvasEdgeType | undefined): string | null {
  if (!type) {
    return null
  }
  return type.replaceAll('_', ' ')
}

function markerAttributes(direction: MaestroEdgeDirection | undefined): {
  markerStart?: string
  markerEnd?: string
} {
  if (direction === 'reverse') {
    return { markerStart: 'url(#maestro-edge-arrow)' }
  }
  if (direction === 'bidirectional') {
    return {
      markerStart: 'url(#maestro-edge-arrow)',
      markerEnd: 'url(#maestro-edge-arrow)'
    }
  }
  return { markerEnd: 'url(#maestro-edge-arrow)' }
}

export function MaestroEdgeLayer({ edges, nodesById }: MaestroEdgeLayerProps): React.JSX.Element {
  return (
    <>
      <defs>
        <marker
          id="maestro-edge-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      <g data-maestro-edge-layer="">
        {edges.map((edge) => {
          const source = nodesById.get(edge.sourceId)
          const target = nodesById.get(edge.targetId)
          return source && target
            ? (() => {
                const geometry = edgeGeometry(source, target)
                const label = edgeLabel(edge.type)
                return (
                  <g
                    key={edge.id}
                    data-maestro-edge-id={edge.id}
                    data-maestro-edge-source-id={edge.sourceId}
                    data-maestro-edge-target-id={edge.targetId}
                    data-maestro-edge-type={edge.type ?? 'visual'}
                  >
                    <path
                      d={geometry.path}
                      className={
                        edge.projected
                          ? 'fill-none stroke-muted-foreground'
                          : 'fill-none stroke-foreground'
                      }
                      strokeWidth={edge.projected ? '1.5' : '2.25'}
                      strokeDasharray={edge.projected ? '4 4' : undefined}
                      vectorEffect="non-scaling-stroke"
                      {...markerAttributes(edge.direction)}
                    />
                    {label ? (
                      <text
                        x={geometry.labelX}
                        y={geometry.labelY}
                        className="fill-muted-foreground"
                        fontSize="10"
                        fontWeight="600"
                        textAnchor="middle"
                        paintOrder="stroke"
                        stroke="var(--background)"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {label}
                      </text>
                    ) : null}
                  </g>
                )
              })()
            : null
        })}
      </g>
    </>
  )
}
