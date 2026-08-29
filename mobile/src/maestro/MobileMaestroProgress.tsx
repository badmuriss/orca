import { useMemo, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { ChevronRight, Copy, X } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { colors } from '../theme/mobile-theme'
import {
  buildMobileMaestroProgressModel,
  type MobileMaestroProgressEntry,
  type MobileMaestroProgressModel,
  type MobileMaestroProgressTone
} from './mobile-maestro-progress-model'
import { mobileMaestroProgressStyles as styles } from './mobile-maestro-progress-styles'
import type { MobileMaestroRunProgress } from './mobile-maestro-run-progress'

type MobileMaestroProgressProps = {
  progress: MobileMaestroRunProgress
  wide: boolean
}

export function MobileMaestroProgress({ progress, wide }: MobileMaestroProgressProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const model = useMemo(() => buildMobileMaestroProgressModel(progress), [progress])
  const warningLabel = model.warnings.length ? ' Health warning.' : ''

  if (wide) {
    return (
      <View style={styles.tabletPane} testID="mobile-maestro-progress-tablet">
        <ScrollView
          contentContainerStyle={styles.tabletContent}
          showsVerticalScrollIndicator={false}
        >
          <MobileMaestroProgressDetails model={model} />
        </ScrollView>
      </View>
    )
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open Run details. ${model.title}. ${model.outcome}. ${model.progressLabel}.${warningLabel}`}
        onPress={() => setDetailsOpen(true)}
        style={styles.phoneSummary}
        testID="mobile-maestro-progress"
      >
        <View style={styles.summaryTop}>
          <StatusDot tone={model.tone} />
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {model.title}
          </Text>
          <ChevronRight size={17} color={colors.textSecondary} />
        </View>
        <Text style={styles.summaryMeta} numberOfLines={1}>
          {model.outcome} · {model.progressLabel}
          {model.warnings.length ? ' · Health warning' : ''}
        </Text>
      </Pressable>
      <BottomDrawer visible={detailsOpen} onClose={() => setDetailsOpen(false)} fillAvailable>
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Run details</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Run details"
            onPress={() => setDetailsOpen(false)}
            style={styles.iconButton}
          >
            <X size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
        <MobileMaestroProgressDetails model={model} />
      </BottomDrawer>
    </>
  )
}

export function MobileMaestroProgressDetails({ model }: { model: MobileMaestroProgressModel }) {
  return (
    <View style={styles.detailContent} testID="mobile-maestro-progress-details">
      <View style={styles.runHeader}>
        <Text style={styles.runTitle}>{model.title}</Text>
        <View style={styles.runMetaRow}>
          <View style={styles.statusRow}>
            <StatusDot tone={model.tone} />
            <Text style={styles.statusText}>{model.outcome}</Text>
          </View>
          <Text style={styles.progressLabel}>{model.progressLabel}</Text>
        </View>
        {model.progressPercent === undefined ? null : (
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: model.progressPercent }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { flex: model.progressPercent }]} />
            <View style={{ flex: 100 - model.progressPercent }} />
          </View>
        )}
        <Text style={styles.countsLabel}>{model.countsLabel}</Text>
      </View>
      <ProgressSection title="Current work" entries={model.current} />
      <ProgressSection title="Recently completed" entries={model.completed} />
      <ProgressSection title="Blocked" entries={model.blocked} />
      <ProgressSection title="Next steps" entries={model.next} />
      <ProgressSection title="Native child activity" entries={model.nested} />
      {model.warnings.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Health</Text>
          {model.warnings.map((warning) => (
            <View key={warning.key} accessibilityRole="alert" style={styles.warning}>
              <Text style={styles.warningTitle}>{warning.title}</Text>
              <Text style={styles.warningDetail}>{warning.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {model.technical.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Technical details</Text>
          {model.technical.map((entry) => (
            <Pressable
              key={entry.label}
              accessibilityRole="button"
              accessibilityLabel={`Copy ${entry.label}`}
              onPress={() => void Clipboard.setStringAsync(entry.value)}
              style={styles.technicalRow}
            >
              <View style={styles.technicalText}>
                <Text style={styles.technicalLabel}>{entry.label}</Text>
                <Text style={styles.technicalValue} numberOfLines={2}>
                  {entry.value}
                </Text>
              </View>
              <Copy size={15} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function ProgressSection({
  title,
  entries
}: {
  title: string
  entries: MobileMaestroProgressEntry[]
}) {
  if (!entries.length) {
    return null
  }
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {entries.map((entry) => (
        <View key={entry.key} style={styles.entry}>
          <View style={styles.entryTop}>
            <Text style={styles.entryTitle}>{entry.title}</Text>
            {entry.state ? <Text style={styles.entryState}>{entry.state}</Text> : null}
          </View>
          {entry.label ? <Text style={styles.entryLabel}>{entry.label}</Text> : null}
          <Text style={styles.entryDetail}>{entry.detail}</Text>
        </View>
      ))}
    </View>
  )
}

function StatusDot({ tone }: { tone: MobileMaestroProgressTone }) {
  const toneStyle = {
    neutral: styles.statusNeutral,
    success: styles.statusSuccess,
    warning: styles.statusWarning,
    danger: styles.statusDanger
  }[tone]
  return <View accessibilityElementsHidden style={[styles.statusDot, toneStyle]} />
}
