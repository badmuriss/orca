import { useEffect, useRef, useState } from 'react'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import {
  readRuntimeMaestroAnnotation,
  readRuntimeMaestroContent,
  readRuntimeMaestroDiff
} from '@/runtime/runtime-maestro-workspace-client'
import { translate } from '@/i18n/i18n'
import { MaestroWorkspaceMiniMarkdownEditor } from './MaestroWorkspaceMiniMarkdownEditor'

type Preview = { content: string; revision: string; source: string }
type AnnotationTone = 'decision' | 'warning' | 'blocked' | 'observation'

const TONE_CLASS = {
  decision:
    'border-l-[var(--status-success)] bg-[color-mix(in_srgb,var(--status-success)_10%,var(--editor-surface))]',
  warning:
    'border-l-[var(--agent-question-text)] bg-[color-mix(in_srgb,var(--annotation-highlight)_14%,var(--editor-surface))]',
  blocked:
    'border-l-destructive bg-[color-mix(in_srgb,var(--destructive)_10%,var(--editor-surface))]',
  observation:
    'border-l-muted-foreground bg-[color-mix(in_srgb,var(--muted)_55%,var(--editor-surface))]'
} as const

const TONE_LABEL = {
  decision: translate('auto.components.maestro.MaestroWorkspaceCanvas.dea05670e3', 'Decision'),
  warning: translate('auto.components.maestro.MaestroWorkspaceCanvas.dc516693a9', 'Warning'),
  blocked: translate('auto.components.maestro.MaestroWorkspaceCanvas.c3974f3c70', 'Blocked'),
  observation: translate('auto.components.maestro.MaestroWorkspaceCanvas.3474e6c93b', 'Observation')
} as const

const TONE_DOT = {
  decision: 'bg-[var(--status-success)]',
  warning: 'bg-[var(--agent-question-text)]',
  blocked: 'bg-destructive',
  observation: 'bg-muted-foreground'
} as const

export function MaestroWorkspaceContentPreview({
  target,
  surface,
  onUpdateAnnotationTone,
  onUpdateAnnotationContent
}: {
  target: RuntimeClientTarget
  surface: WorkspaceSurface
  onUpdateAnnotationTone?: (tone: AnnotationTone) => void
  onUpdateAnnotationContent?: (content: string) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [optimisticTone, setOptimisticTone] = useState<AnnotationTone | null>(null)
  const workspace = parseWorkspaceKey(surface.id.workspace_key)
  const worktreeId =
    workspace?.type === 'folder' ? workspace.folderWorkspaceId : workspace?.worktreeId
  const binding = surface.binding.kind === 'content' ? surface.binding : null
  const executionHostId = surface.id.execution_host_id
  const workspaceKey = surface.id.workspace_key
  const unifiedTabId = surface.id.unified_tab_id

  useEffect(() => setOptimisticTone(null), [unifiedTabId])

  // Layout mutations rebuild equivalent objects, so primitive identity prevents reloads on Fit.
  const latestTarget = useRef(target)
  latestTarget.current = target
  const targetKey = target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
  const hasAnnotation = binding?.annotation != null
  const modelRevision = binding?.model_revision ?? ''
  const sourceMode = binding?.source?.mode ?? null
  const sourceRelativePath = binding?.source?.relative_path ?? null
  const sourceDiffSource = binding?.source?.diff_source ?? null
  const sourceIsDirty = binding?.source?.is_dirty ?? false

  useEffect(() => {
    let active = true
    setPreview(null)
    setUnavailable(false)
    if (!worktreeId || sourceRelativePath === null) {
      setUnavailable(true)
      return
    }
    const activeTarget = latestTarget.current
    const load = async (): Promise<Preview> => {
      if (hasAnnotation) {
        const result = await readRuntimeMaestroAnnotation(activeTarget, worktreeId, unifiedTabId)
        return { content: result.content, revision: result.version, source: result.source }
      }
      if (sourceMode === 'diff') {
        const result = await readRuntimeMaestroDiff(
          activeTarget,
          worktreeId,
          sourceRelativePath,
          sourceDiffSource === 'staged'
        )
        if (result.kind === 'binary') {
          throw new Error('binary_diff_unavailable')
        }
        return {
          content: `--- Original\n${result.originalContent}\n+++ Modified\n${result.modifiedContent}`,
          revision: modelRevision,
          source: sourceDiffSource ?? 'unstaged'
        }
      }
      const result = await readRuntimeMaestroContent(
        activeTarget,
        {
          execution_host_id: executionHostId,
          workspace_key: workspaceKey
        },
        {
          execution_host_id: executionHostId,
          workspace_key: workspaceKey,
          unified_tab_id: unifiedTabId
        }
      )
      return {
        content: result.content,
        revision: result.modelRevision,
        source: sourceIsDirty ? 'live draft' : 'file'
      }
    }
    void load().then(
      (result) => active && setPreview(result),
      () => active && setUnavailable(true)
    )
    return () => {
      active = false
    }
  }, [
    executionHostId,
    hasAnnotation,
    modelRevision,
    sourceDiffSource,
    sourceIsDirty,
    sourceMode,
    sourceRelativePath,
    targetKey,
    unifiedTabId,
    workspaceKey,
    worktreeId
  ])

  if (preview && binding) {
    const authoritativeTone = binding.annotation?.tone
    const tone = optimisticTone ?? authoritativeTone
    return (
      <div
        className={`flex size-full min-h-0 flex-col overflow-hidden border-l-4 ${tone ? TONE_CLASS[tone] : 'border-l-border bg-editor-surface'}`}
        data-annotation-tone={tone}
      >
        {tone ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {TONE_LABEL[tone]}
            </p>
            {onUpdateAnnotationTone ? (
              <div
                className="flex items-center gap-1 rounded-md border border-border/60 bg-background/55 p-1"
                aria-label={translate(
                  'auto.components.maestro.MaestroWorkspaceContentPreview.a83bb54e16',
                  'Annotation color'
                )}
              >
                {(Object.keys(TONE_LABEL) as AnnotationTone[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`size-3.5 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TONE_DOT[value]} ${tone === value ? 'border-foreground/75' : 'border-transparent'}`}
                    aria-label={`Set annotation color to ${TONE_LABEL[value]}`}
                    aria-pressed={tone === value}
                    onClick={() => {
                      setOptimisticTone(value)
                      onUpdateAnnotationTone(value)
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tone && onUpdateAnnotationContent ? (
          <MaestroWorkspaceMiniMarkdownEditor
            content={preview.content}
            onSave={onUpdateAnnotationContent}
          />
        ) : (
          <pre className="scrollbar-sleek min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
            {preview.content}
          </pre>
        )}
        <p className="shrink-0 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
          {preview.source}{' '}
          {translate(
            'auto.components.maestro.MaestroWorkspaceContentPreview.6ecef4bd09',
            '· revision'
          )}{' '}
          {preview.revision}
        </p>
      </div>
    )
  }
  return (
    <div className="flex size-full items-center justify-center bg-editor-surface p-3 text-center text-xs text-muted-foreground">
      {unavailable
        ? translate(
            'auto.components.maestro.MaestroWorkspaceContentPreview.803e2cdc3b',
            'Exact content preview is unavailable.'
          )
        : translate(
            'auto.components.maestro.MaestroWorkspaceContentPreview.caadff40f7',
            'Loading exact content…'
          )}
    </div>
  )
}
