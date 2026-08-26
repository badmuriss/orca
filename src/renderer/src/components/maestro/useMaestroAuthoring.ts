import { useCallback, useRef, useState } from 'react'
import type {
  MaestroDocument,
  MaestroDocumentAuthoringMutation,
  MaestroEdgeDirection,
  MaestroEdgeType,
  MaestroWorkspaceAnchor
} from '../../../../shared/maestro-contract'
import { applyMaestroDocumentAuthoringMutation } from '@/runtime/runtime-maestro-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { createMaestroUserEdge } from './maestro-canvas-view-model'

export type MaestroAuthoringNode = Pick<
  MaestroCanvasAuthoringNode,
  'id' | 'title' | 'kind' | 'noteRevision'
>
type MaestroCanvasAuthoringNode = {
  id: string
  title: string
  kind?: 'note' | 'projected'
  noteRevision?: number
}
export type MaestroNoteDraft = {
  nodeId: string
  title: string
  markdown: string
  position: { x: number; y: number }
  noteRevision: number | null
  contextSnapshotRevision?: string
}
export type MaestroLinkComposer = { sourceId: string; targetId: string }

type UseMaestroAuthoringParams = {
  document: MaestroDocument
  workspace: MaestroWorkspaceAnchor | null
  revisionRef: { current: number | undefined }
  runtimeTarget: RuntimeClientTarget | null
  nodesById: ReadonlyMap<string, MaestroAuthoringNode>
  selectedIds: ReadonlySet<string>
  onConflict?: () => void
  onDocumentChanged?: () => void
}

type AuthoringResult = {
  outcome: 'applied' | 'conflict'
  revision: number
}

function makeMutationId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

function isAuthoringResult(value: unknown): value is AuthoringResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    'revision' in value &&
    (value.outcome === 'applied' || value.outcome === 'conflict')
  )
}

export function useMaestroAuthoring({
  document,
  workspace,
  revisionRef,
  runtimeTarget,
  nodesById,
  selectedIds,
  onConflict,
  onDocumentChanged
}: UseMaestroAuthoringParams) {
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const [noteDraft, setNoteDraft] = useState<MaestroNoteDraft | null>(null)
  const [linkComposer, setLinkComposer] = useState<MaestroLinkComposer | null>(null)
  const [linkType, setLinkType] = useState<MaestroEdgeType>('context_for')
  const [linkDirection, setLinkDirection] = useState<MaestroEdgeDirection>('forward')
  const [authoringError, setAuthoringError] = useState<string | null>(null)

  const commitAuthoring = useCallback(
    (operation: MaestroDocumentAuthoringMutation['operation']): Promise<boolean> => {
      const queued = queueRef.current.then(async () => {
        if (!runtimeTarget || revisionRef.current === undefined || !workspace) {
          return false
        }
        try {
          const response = await applyMaestroDocumentAuthoringMutation(runtimeTarget, {
            schema_version: 1,
            protocol: 'maestro-document-authoring-mutation/v1',
            mutation_id: makeMutationId(),
            scope: workspace,
            expected_revision: revisionRef.current,
            operation
          })
          if (!isAuthoringResult(response) || response.outcome === 'conflict') {
            setAuthoringError('The Canvas changed elsewhere. Reloading the latest document.')
            onConflict?.()
            return false
          }
          revisionRef.current = response.revision
          setAuthoringError(null)
          onDocumentChanged?.()
          return true
        } catch {
          setAuthoringError('This authoring change was not saved.')
          return false
        }
      })
      queueRef.current = queued.then(
        () => undefined,
        () => undefined
      )
      return queued
    },
    [onConflict, onDocumentChanged, revisionRef, runtimeTarget, workspace]
  )

  const openNoteEditor = useCallback((node: MaestroNoteDraft): void => {
    setNoteDraft(node)
    setLinkComposer(null)
    setAuthoringError(null)
  }, [])

  const saveNote = useCallback(
    async (value: { title: string; markdown: string }): Promise<boolean> => {
      if (!noteDraft) {
        return false
      }
      const operation: MaestroDocumentAuthoringMutation['operation'] =
        noteDraft.noteRevision === null
          ? {
              kind: 'create-note',
              node_id: noteDraft.nodeId,
              position: noteDraft.position,
              title: value.title,
              markdown: value.markdown
            }
          : {
              kind: 'update-note',
              node_id: noteDraft.nodeId,
              expected_note_revision: noteDraft.noteRevision,
              title: value.title,
              markdown: value.markdown
            }
      const saved = await commitAuthoring(operation)
      if (saved) {
        setNoteDraft(null)
      }
      return saved
    },
    [commitAuthoring, noteDraft]
  )

  const startLinkFromSelection = useCallback((): void => {
    const ids = [...selectedIds]
    if (ids.length !== 2) {
      setAuthoringError('Select two nodes to create a typed link.')
      return
    }
    setLinkComposer({ sourceId: ids[0], targetId: ids[1] })
    setAuthoringError(null)
  }, [selectedIds])

  const submitLink = useCallback(async (): Promise<boolean> => {
    if (!linkComposer) {
      return false
    }
    const source = nodesById.get(linkComposer.sourceId)
    const target = nodesById.get(linkComposer.targetId)
    const contextNote =
      source?.kind === 'note' ? source : target?.kind === 'note' ? target : undefined
    if (linkType === 'context_for' && (!contextNote || contextNote.noteRevision === undefined)) {
      setAuthoringError('A context link needs a note endpoint with a current revision.')
      return false
    }
    const operation = createMaestroUserEdge({
      id: makeMutationId(),
      sourceId: linkComposer.sourceId,
      targetId: linkComposer.targetId,
      type: linkType,
      direction: linkDirection,
      contextNoteId: contextNote?.id,
      expectedNoteRevision: contextNote?.noteRevision
    })
    const saved = await commitAuthoring(operation)
    if (saved) {
      setLinkComposer(null)
    }
    return saved
  }, [commitAuthoring, linkComposer, linkDirection, linkType, nodesById])

  const handleLinkHandle = useCallback((nodeId: string, role: 'source' | 'target'): void => {
    if (role === 'source') {
      setLinkComposer({ sourceId: nodeId, targetId: '' })
      setAuthoringError(null)
      return
    }
    setLinkComposer((current) =>
      current && current.sourceId !== nodeId ? { ...current, targetId: nodeId } : current
    )
  }, [])

  const history = document.authoring_history ?? { undo_stack: [], redo_stack: [] }
  const undoMutation = history.undo_stack.at(-1)
  const redoMutation = history.redo_stack.at(-1)
  return {
    authoringError,
    commitAuthoring,
    handleLinkHandle,
    linkComposer,
    linkDirection,
    linkType,
    noteDraft,
    openNoteEditor,
    redoMutation,
    saveNote,
    setLinkComposer,
    setLinkDirection,
    setLinkType,
    setNoteDraft,
    startLinkFromSelection,
    submitLink,
    undoMutation
  }
}
