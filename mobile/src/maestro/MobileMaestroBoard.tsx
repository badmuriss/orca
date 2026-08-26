import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Line } from 'react-native-svg'
import {
  workspaceSurfaceKey,
  type WorkspaceSurface
} from '../../../src/shared/maestro-workspace-canvas'
import { colors } from '../theme/mobile-theme'
import {
  projectMobileMaestroFrame,
  type MaestroCardFrame,
  type MaestroViewport
} from './mobile-maestro-geometry'
import { mobileMaestroScreenStyles as styles } from './mobile-maestro-screen-styles'
import { MobileMaestroSurfaceCard } from './MobileMaestroSurfaceCard'

type BoardLink = {
  id: string
  source_surface_key: string
  target_surface_key: string
  provenance: 'manual' | 'automatic' | 'suggested'
}

export function MobileMaestroBoard({
  surfaces,
  frames,
  viewport,
  viewportWidth,
  viewportHeight,
  links,
  selectedKey,
  previews,
  onSelect,
  onViewportLayout
}: {
  surfaces: WorkspaceSurface[]
  frames: MaestroCardFrame[]
  viewport: MaestroViewport
  viewportWidth: number
  viewportHeight: number
  links: BoardLink[]
  selectedKey: string | null
  previews: Record<string, string>
  onSelect: (key: string) => void
  onViewportLayout: (size: { width: number; height: number }) => void
}) {
  const frameByKey = new Map(
    surfaces.map((surface, index) => [workspaceSurfaceKey(surface.id), frames[index]!])
  )
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.horizontalCanvas}
      onLayout={(event: LayoutChangeEvent) => onViewportLayout(event.nativeEvent.layout)}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.verticalCanvas}
      >
        <View style={styles.board}>
          <Svg width={1800} height={1400} style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: 46 }, (_, index) => (
              <Line
                key={`grid-v-${index}`}
                x1={index * 40}
                y1={0}
                x2={index * 40}
                y2={1400}
                stroke={colors.borderSubtle}
                strokeWidth={0.5}
                opacity={0.45}
              />
            ))}
            {Array.from({ length: 36 }, (_, index) => (
              <Line
                key={`grid-h-${index}`}
                x1={0}
                y1={index * 40}
                x2={1800}
                y2={index * 40}
                stroke={colors.borderSubtle}
                strokeWidth={0.5}
                opacity={0.45}
              />
            ))}
            {links.map((link) => {
              const source = frameByKey.get(link.source_surface_key)
              const target = frameByKey.get(link.target_surface_key)
              if (!source || !target) {
                return null
              }
              const projectedSource = projectMobileMaestroFrame(viewport, source, {
                width: viewportWidth,
                height: viewportHeight
              })
              const projectedTarget = projectMobileMaestroFrame(viewport, target, {
                width: viewportWidth,
                height: viewportHeight
              })
              return (
                <Line
                  key={`${link.provenance}:${link.id}`}
                  x1={projectedSource.x + projectedSource.width / 2}
                  y1={projectedSource.y + projectedSource.height / 2}
                  x2={projectedTarget.x + projectedTarget.width / 2}
                  y2={projectedTarget.y + projectedTarget.height / 2}
                  stroke={
                    link.provenance === 'suggested'
                      ? colors.statusAmber
                      : link.provenance === 'automatic'
                        ? colors.textMuted
                        : colors.textSecondary
                  }
                  strokeWidth={link.provenance === 'manual' ? 2 : 1.5}
                  strokeDasharray={link.provenance === 'suggested' ? '6 6' : undefined}
                />
              )
            })}
          </Svg>
          {surfaces.map((surface, index) => {
            const frame = frames[index]!
            const key = workspaceSurfaceKey(surface.id)
            const projected = projectMobileMaestroFrame(viewport, frame, {
              width: viewportWidth,
              height: viewportHeight
            })
            return (
              <View
                key={key}
                style={{
                  position: 'absolute',
                  left: projected.x - (frame.width - projected.width) / 2,
                  top: projected.y - (frame.height - projected.height) / 2,
                  width: frame.width,
                  height: frame.height,
                  overflow: 'hidden',
                  transform: [{ scale: viewport.zoom }]
                }}
              >
                <MobileMaestroSurfaceCard
                  surface={surface}
                  selected={selectedKey === key}
                  preview={previews[key]}
                  onPress={() => onSelect(key)}
                />
              </View>
            )
          })}
        </View>
      </ScrollView>
    </ScrollView>
  )
}
