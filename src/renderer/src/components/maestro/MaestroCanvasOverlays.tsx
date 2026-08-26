import { MaestroCanvasContextMenu } from './MaestroCanvasContextMenu'
import { delegationParentOptions } from './maestro-delegation-context'
import { MaestroDelegationDialog } from './MaestroDelegationDialog'
import { MaestroLinkEditor } from './MaestroLinkEditor'
import { MaestroNoteEditor } from './MaestroNoteEditor'
import type { MaestroCanvasPoint } from './maestro-canvas-view-model'
import type { MaestroWorkspaceAnchor } from '../../../../shared/maestro-contract'
import type { useMaestroAuthoring } from './useMaestroAuthoring'
import type { useMaestroCanvasLayout } from './useMaestroCanvasLayout'
import type { useMaestroDelegation } from './useMaestroDelegation'

type OverlayProps = {
  contextMenu: {
    pointer: MaestroCanvasPoint
    world: MaestroCanvasPoint
    node?: unknown
  } | null
  layout: ReturnType<typeof useMaestroCanvasLayout>
  authoring: ReturnType<typeof useMaestroAuthoring>
  delegation: ReturnType<typeof useMaestroDelegation>
  delegationWorkspace: MaestroWorkspaceAnchor | null
  onDismissContextMenu: () => void
  onOpenDelegation: () => void
  onCreateNote: () => void
}

/** Context menu, delegation dialog, note and link editors that float above the board. */
export function MaestroCanvasOverlays({
  contextMenu,
  layout,
  authoring,
  delegation,
  delegationWorkspace,
  onDismissContextMenu,
  onOpenDelegation,
  onCreateNote
}: OverlayProps): React.JSX.Element {
  const parentOptions = delegationWorkspace
    ? delegationParentOptions(layout.nodes, delegationWorkspace)
    : { tasks: [], attempts: [] }
  const dismissContextMenu = onDismissContextMenu
  const openDelegation = onOpenDelegation
  const createNote = onCreateNote
  return (
    <>
      {contextMenu ? (
        <MaestroCanvasContextMenu
          pointer={contextMenu.pointer}
          canvas={layout.size}
          onDismiss={dismissContextMenu}
          onCreateNote={createNote}
          onCreateLink={() => {
            dismissContextMenu()
            authoring.startLinkFromSelection()
          }}
          onDelegate={openDelegation}
          delegationDisabledReason={
            delegationWorkspace
              ? undefined
              : 'The active Canvas projection has no authenticated run identity.'
          }
        />
      ) : null}
      {delegation.dialogOpen && delegation.catalog && delegation.context && delegationWorkspace ? (
        <MaestroDelegationDialog
          open
          workspace={delegationWorkspace}
          catalog={delegation.catalog}
          source={delegation.context.source}
          paths={[]}
          check=""
          parentTaskId={delegation.context.parentTaskId}
          parentAttemptId={delegation.context.parentAttemptId}
          parentTasks={parentOptions.tasks}
          parentAttempts={parentOptions.attempts}
          contextRefs={delegation.context.contextRefs}
          intent={delegation.intent}
          onOpenChange={delegation.onDialogOpenChange}
          onSubmit={delegation.submitDelegation}
        />
      ) : null}
      {authoring.noteDraft ? (
        <div className="absolute right-3 top-3 z-20">
          <MaestroNoteEditor
            key={authoring.noteDraft.nodeId}
            title={authoring.noteDraft.title}
            markdown={authoring.noteDraft.markdown}
            revision={authoring.noteDraft.noteRevision}
            contextSnapshotRevision={authoring.noteDraft.contextSnapshotRevision}
            onSave={(value) => void authoring.saveNote(value)}
            onDismiss={() => authoring.setNoteDraft(null)}
            onPinContext={
              authoring.noteDraft.noteRevision === null
                ? undefined
                : () => {
                    authoring.setLinkComposer({
                      sourceId: authoring.noteDraft?.nodeId ?? '',
                      targetId: ''
                    })
                    authoring.setNoteDraft(null)
                  }
            }
          />
        </div>
      ) : null}
      {authoring.linkComposer ? (
        <MaestroLinkEditor
          composer={authoring.linkComposer}
          nodesById={layout.nodesById}
          linkType={authoring.linkType}
          linkDirection={authoring.linkDirection}
          authoringError={authoring.authoringError}
          onTypeChange={authoring.setLinkType}
          onDirectionChange={authoring.setLinkDirection}
          onCancel={() => authoring.setLinkComposer(null)}
          onSubmit={() => void authoring.submitLink()}
        />
      ) : null}
    </>
  )
}
