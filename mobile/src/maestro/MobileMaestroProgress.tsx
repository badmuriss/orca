import { StyleSheet, Text, View } from 'react-native'
import type { MaestroRunProgress } from '../../../src/shared/maestro-run-progress'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

export function MobileMaestroProgress({ progress }: { progress: MaestroRunProgress }) {
  if (!progress.available) {
    return (
      <View style={styles.overlay}>
        <Text style={styles.label}>Harness outcome unknown</Text>
      </View>
    )
  }
  const summary = progress.summary
  return (
    <View style={styles.overlay} testID="mobile-maestro-progress">
      <View style={styles.row}>
        <Text style={styles.label}>Harness · {summary.state.replace('_', ' ')}</Text>
        <Text style={styles.percent}>{summary.progress_percent}%</Text>
      </View>
      <Text style={styles.counts}>
        active {summary.task_counts.running} · done {summary.task_counts.approved} · pending{' '}
        {summary.task_counts.pending} · blocked {summary.task_counts.blocked}
      </Text>
      {summary.next_tasks[0] ? (
        <Text style={styles.next} numberOfLines={1}>
          Next · {summary.next_tasks[0].task_id}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 66,
    left: spacing.md,
    maxWidth: 360,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel,
    zIndex: 35,
    elevation: 8
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  label: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '700',
    textTransform: 'capitalize'
  },
  percent: { color: colors.statusGreen, fontSize: typography.metaSize, fontWeight: '700' },
  counts: { marginTop: spacing.xs, color: colors.textSecondary, fontSize: 10 },
  next: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: typography.monoFamily
  }
})
