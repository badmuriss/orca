import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import {
  ChevronLeft,
  FilePlus2,
  Globe,
  Maximize2,
  RefreshCw,
  SquareTerminal
} from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { parseWorkspaceKey } from '../../../src/shared/workspace-scope'
import {
  workspaceSurfaceKey,
  type WorkspaceSurface
} from '../../../src/shared/maestro-workspace-canvas'
import { useHostClient } from '../transport/client-context'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { colors } from '../theme/mobile-theme'
import {
  fitMobileMaestroFrames,
  mobileMaestroFrame,
  mobileMaestroInspectorInsets,
  revealMobileMaestroFrame,
  type MaestroViewport
} from './mobile-maestro-geometry'
import { MobileMaestroInspector } from './MobileMaestroInspector'
import { MobileMaestroBoard } from './MobileMaestroBoard'
import {
  MobileMaestroAnnotationComposer,
  type MaestroAnnotationTone
} from './MobileMaestroAnnotationComposer'
import { MobileMaestroProgress } from './MobileMaestroProgress'
import { useMobileMaestroWorkspace } from './mobile-maestro-workspace'
import { mobileMaestroScreenStyles as styles } from './mobile-maestro-screen-styles'

export function MobileMaestroScreen() {
  const { hostId, executionHostId, workspaceKey, name } = useLocalSearchParams<{
    hostId: string
    executionHostId: string
    workspaceKey: string
    name?: string
  }>()
  const router = useRouter()
  const { client, state: connectionState } = useHostClient(hostId)
  const { isWideLayout, width, height } = useResponsiveLayout()
  const scope = useMemo(
    () => ({ execution_host_id: executionHostId, workspace_key: workspaceKey }),
    [executionHostId, workspaceKey]
  )
  const { state, refresh, mutate, readContent } = useMobileMaestroWorkspace(
    client,
    connectionState === 'connected',
    scope
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [linkSourceKey, setLinkSourceKey] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [annotationText, setAnnotationText] = useState('')
  const [annotationTone, setAnnotationTone] = useState<MaestroAnnotationTone>('observation')
  const [mutationBusy, setMutationBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [localViewport, setLocalViewport] = useState<MaestroViewport | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width, height })

  const value = state.status === 'available' ? state.value : null
  const surfaces = useMemo(() => (value ? Object.values(value.snapshot.surfaces) : []), [value])
  const frames = useMemo(
    () =>
      surfaces.map((surface, index) =>
        mobileMaestroFrame(surface, index, value!.canvas.document, isWideLayout)
      ),
    [isWideLayout, surfaces, value]
  )
  const persistedViewport = useMemo(() => {
    const inspectorInsets = mobileMaestroInspectorInsets(isWideLayout, Boolean(selectedKey))
    return (
      value?.canvas.document.viewport ??
      fitMobileMaestroFrames(frames, { ...canvasSize, ...inspectorInsets })
    )
  }, [canvasSize, frames, isWideLayout, selectedKey, value])
  const viewport = localViewport ?? persistedViewport
  const selected = selectedKey ? (value?.snapshot.surfaces[selectedKey] ?? null) : null
  const selectedSuggestion = selectedKey
    ? value?.snapshot.suggested_links.find(
        (link) =>
          (link.source_surface_key === selectedKey || link.target_surface_key === selectedKey) &&
          !value.canvas.document.suggestion_decisions[link.fingerprint]
      )
    : undefined
  const frameBySurfaceKey = useMemo(
    () =>
      new Map(surfaces.map((surface, index) => [workspaceSurfaceKey(surface.id), frames[index]!])),
    [frames, surfaces]
  )
  const links = useMemo(() => {
    if (!value) {
      return []
    }
    const manual = value.canvas.document.manual_links.map((link) => ({
      ...link,
      provenance: 'manual' as const
    }))
    const automatic = value.snapshot.automatic_links.map((link) => ({
      ...link,
      provenance: 'automatic' as const
    }))
    const suggested = value.snapshot.suggested_links
      .filter((link) => !value.canvas.document.suggestion_decisions[link.fingerprint])
      .map((link) => ({ ...link, id: link.fingerprint, provenance: 'suggested' as const }))
    const accepted = Object.entries(value.canvas.document.suggestion_decisions).flatMap(
      ([fingerprint, decision]) =>
        decision.accepted_link
          ? [{ ...decision.accepted_link, id: fingerprint, provenance: 'manual' as const }]
          : []
    )
    return [...automatic, ...manual, ...accepted, ...suggested]
  }, [value])

  const applyMutation = async (action: Parameters<typeof mutate>[0]) => {
    setMutationBusy(true)
    setMutationError(null)
    try {
      return await mutate(action)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setMutationBusy(false)
    }
  }

  const selectSurface = (key: string) => {
    if (linkSourceKey && linkSourceKey !== key) {
      void applyMutation({
        action: 'create-manual-link',
        source_surface_key: linkSourceKey,
        target_surface_key: key,
        link_type: 'context-for',
        label: null,
        expected_canvas_revision: value!.canvas.revision
      }).then((result) => result && setLinkSourceKey(null))
    }
    setSelectedKey(key)
    const frame = frameBySurfaceKey.get(key)
    if (frame) {
      const inspectorInsets = mobileMaestroInspectorInsets(isWideLayout, true)
      setLocalViewport(
        revealMobileMaestroFrame(viewport, frame, {
          ...canvasSize,
          ...inspectorInsets
        })
      )
    }
  }

  useEffect(() => {
    if (!selected || selected.binding.kind !== 'content' || previews[selectedKey!]) {
      return
    }
    let active = true
    void readContent(selected.id).then(
      (result) =>
        active && setPreviews((current) => ({ ...current, [selectedKey!]: result.content })),
      () => undefined
    )
    return () => {
      active = false
    }
  }, [previews, readContent, selected, selectedKey])

  const openExactTab = (surface: WorkspaceSurface) => {
    const parsed = parseWorkspaceKey(workspaceKey)
    const worktreeId = parsed?.type === 'folder' ? parsed.folderWorkspaceId : parsed?.worktreeId
    if (!worktreeId) {
      return
    }
    router.push({
      pathname: '/h/[hostId]/session/[worktreeId]',
      params: {
        hostId,
        executionHostId,
        worktreeId,
        tabId: surface.id.unified_tab_id,
        name: name ?? surface.title
      }
    })
  }

  if (state.status === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={styles.centerText}>Loading workspace Canvas…</Text>
        </View>
      </SafeAreaView>
    )
  }
  if (state.status !== 'available') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Maestro unavailable</Text>
          <Text style={styles.centerText}>{state.reason}</Text>
          <Pressable style={styles.retry} onPress={() => void refresh()}>
            <RefreshCw size={16} color={colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }
  const available = state.value

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen} testID="mobile-maestro-screen">
      <View style={styles.toolbar}>
        <Pressable
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <ChevronLeft size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>Maestro</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {name ?? workspaceKey}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="New terminal surface"
          disabled={mutationBusy}
          onPress={() => void applyMutation({ action: 'create', surface_type: 'terminal' })}
          style={styles.iconButton}
        >
          <SquareTerminal size={17} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel="New Browser surface"
          disabled={mutationBusy}
          onPress={() => void applyMutation({ action: 'create', surface_type: 'browser' })}
          style={styles.iconButton}
        >
          <Globe size={17} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel="New semantic note"
          onPress={() => setComposerOpen(true)}
          style={styles.iconButton}
        >
          <FilePlus2 size={17} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel="Fit Canvas"
          disabled={mutationBusy}
          onPress={() => {
            const inspectorInsets = mobileMaestroInspectorInsets(isWideLayout, Boolean(selectedKey))
            const fitted = fitMobileMaestroFrames(frames, {
              ...canvasSize,
              ...inspectorInsets
            })
            setLocalViewport(fitted)
            void applyMutation({
              action: 'set-viewport',
              viewport: fitted,
              expected_canvas_revision: available.canvas.revision
            })
          }}
          style={styles.iconButton}
        >
          <Maximize2 size={17} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel="Refresh Canvas"
          onPress={() => void refresh()}
          style={styles.iconButton}
        >
          <RefreshCw size={17} color={colors.textSecondary} />
        </Pressable>
      </View>
      {mutationError ? (
        <View accessibilityRole="alert" style={styles.mutationError}>
          <Text style={styles.mutationErrorText}>Could not apply change: {mutationError}</Text>
          <Pressable
            accessibilityLabel="Dismiss mutation error"
            onPress={() => setMutationError(null)}
          >
            <Text style={styles.mutationErrorDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
      {surfaces.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No open surfaces</Text>
          <Text style={styles.centerText}>
            Open a terminal, Browser, file, or note. It will appear here without starting Harness.
          </Text>
        </View>
      ) : (
        <MobileMaestroBoard
          surfaces={surfaces}
          frames={frames}
          viewport={viewport}
          viewportWidth={canvasSize.width}
          viewportHeight={canvasSize.height}
          links={links}
          selectedKey={selectedKey}
          previews={previews}
          onSelect={selectSurface}
          onViewportLayout={(size) =>
            setCanvasSize((current) =>
              current.width === size.width && current.height === size.height ? current : size
            )
          }
        />
      )}
      {selected ? (
        <MobileMaestroInspector
          surface={selected}
          wide={isWideLayout}
          linking={linkSourceKey === selectedKey}
          onClose={() => setSelectedKey(null)}
          onOpen={() => openExactTab(selected)}
          onLink={() => setLinkSourceKey(selectedKey)}
          suggestion={selectedSuggestion}
          onAcceptSuggestion={() =>
            selectedSuggestion &&
            void applyMutation({
              action: 'decide-suggestion',
              fingerprint: selectedSuggestion.fingerprint,
              decision: 'accepted',
              link_type: selectedSuggestion.link_type,
              label: null,
              expected_canvas_revision: available.canvas.revision
            })
          }
          onHideSuggestion={() =>
            selectedSuggestion &&
            void applyMutation({
              action: 'decide-suggestion',
              fingerprint: selectedSuggestion.fingerprint,
              decision: 'hidden',
              expected_canvas_revision: available.canvas.revision
            })
          }
        />
      ) : null}
      {available.runProgress ? <MobileMaestroProgress progress={available.runProgress} /> : null}
      <MobileMaestroAnnotationComposer
        visible={composerOpen}
        text={annotationText}
        tone={annotationTone}
        busy={mutationBusy}
        onTextChange={setAnnotationText}
        onToneChange={setAnnotationTone}
        onCancel={() => setComposerOpen(false)}
        onCreate={() =>
          void applyMutation({
            action: 'create',
            surface_type: 'content',
            title: annotationText.trim().split('\n')[0]?.slice(0, 80) || 'Workspace note',
            annotation: { text: annotationText.trim(), tone: annotationTone },
            expected_canvas_revision: available.canvas.revision
          }).then((result) => {
            if (!result) {
              return
            }
            setComposerOpen(false)
            setAnnotationText('')
          })
        }
      />
    </SafeAreaView>
  )
}
