import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FileText, Globe, SquareTerminal } from 'lucide-react-native'
import type { WorkspaceSurface } from '../../../src/shared/maestro-workspace-canvas'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

const TONE_COLOR = {
  decision: colors.statusGreen,
  warning: colors.statusAmber,
  blocked: colors.statusRed,
  observation: colors.textMuted
} as const

const TONE_LABEL = {
  decision: 'Decision',
  warning: 'Warning',
  blocked: 'Blocked',
  observation: 'Observation'
} as const

export function MobileMaestroSurfaceCard({
  surface,
  selected,
  preview,
  onPress
}: {
  surface: WorkspaceSurface
  selected: boolean
  preview?: string
  onPress: () => void
}) {
  const tone = surface.binding.kind === 'content' ? surface.binding.annotation?.tone : undefined
  const Icon =
    surface.binding.kind === 'terminal'
      ? SquareTerminal
      : surface.binding.kind === 'browser'
        ? Globe
        : FileText
  const detail =
    surface.binding.kind === 'terminal'
      ? surface.binding.liveness === 'live'
        ? 'Live PTY'
        : surface.binding.liveness
      : surface.binding.kind === 'browser'
        ? surface.binding.live_frame
          ? 'Live Browser frame'
          : surface.binding.immutable_capture
            ? 'Captured Browser page'
            : 'Exact Browser page'
        : (surface.binding.source?.relative_path ?? surface.binding.content_type)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select ${surface.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        tone ? { borderLeftColor: TONE_COLOR[tone], borderLeftWidth: 4 } : null,
        selected && styles.selected,
        pressed && styles.pressed
      ]}
      testID={`maestro-surface-${surface.id.unified_tab_id}`}
    >
      <View style={styles.header}>
        <Icon size={15} color={tone ? TONE_COLOR[tone] : colors.textSecondary} />
        <Text style={styles.title} numberOfLines={1}>
          {surface.title}
        </Text>
        <View style={[styles.availability, surface.availability === 'available' && styles.live]} />
      </View>
      {tone ? (
        <Text style={[styles.tone, { color: TONE_COLOR[tone] }]}>{TONE_LABEL[tone]}</Text>
      ) : null}
      <Text style={styles.preview} numberOfLines={5}>
        {preview ?? detail}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {surface.content_type} · rev {surface.revision}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.row,
    backgroundColor: colors.editorSurface,
    padding: spacing.md
  },
  selected: { borderColor: colors.surfaceBright, borderWidth: 2 },
  pressed: { opacity: 0.82 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  availability: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.statusAmber },
  live: { backgroundColor: colors.statusGreen },
  tone: {
    marginTop: spacing.sm,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7
  },
  preview: {
    flex: 1,
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18,
    fontFamily: typography.monoFamily
  },
  meta: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 10 }
})
