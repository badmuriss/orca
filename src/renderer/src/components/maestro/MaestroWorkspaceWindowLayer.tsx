import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { WorkspaceCanvasDocument } from '../../../../shared/maestro-document-contract'
import type { WorkspaceSurfaceSnapshot } from '../../../../shared/maestro-workspace-canvas'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { MaestroWorkspaceCanvasResource } from '@/hooks/useMaestroWorkspaceCanvas'
import { MaestroWorkspaceInspector } from './MaestroWorkspaceInspector'
import { MaestroWorkspaceWindow } from './MaestroWorkspaceWindow'
import {
  moveWorkspaceWindow,
  resizeWorkspaceWindow,
  type MaestroWorkspaceWindowPlacement
} from './maestro-workspace-window-layout'
import { maestroWorkspaceMutationKey } from './maestro-workspace-mutation-key'

type PlacementMap = Readonly<Record<string, MaestroWorkspaceWindowPlacement>>
type WindowLayerProps = {
  target: RuntimeClientTarget
  resource: MaestroWorkspaceCanvasResource
  snapshot: WorkspaceSurfaceSnapshot
  document: WorkspaceCanvasDocument
  surfaceKeys: readonly string[]
  pendingSurfaceKey: string | null
  placements: PlacementMap
  setPlacements: Dispatch<SetStateAction<PlacementMap>>
  optimisticPlacements: MutableRefObject<Record<string, MaestroWorkspaceWindowPlacement>>
  worldStyle: React.CSSProperties
  onRevealPlacement: (placement: MaestroWorkspaceWindowPlacement) => void
}

export function MaestroWorkspaceWindowLayer(props: WindowLayerProps): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [linkSourceKey, setLinkSourceKey] = useState<string | null>(null)
  const selectedSurface = selectedKey ? props.snapshot.surfaces[selectedKey] : undefined
  const mutate = props.resource.mutate
  return (
    <>
      <div className="absolute" style={props.worldStyle}>
        {props.surfaceKeys.map((surfaceKey) => {
          const surface = props.snapshot.surfaces[surfaceKey]
          const placement = props.placements[surfaceKey]
          if (!surface || !placement) {
            return null
          }
          const updatePlacement = (
            update: (current: MaestroWorkspaceWindowPlacement) => MaestroWorkspaceWindowPlacement
          ): void =>
            props.setPlacements((current) => {
              const next = update(current[surfaceKey]!)
              props.optimisticPlacements.current[surfaceKey] = next
              return { ...current, [surfaceKey]: next }
            })
          const key = (action: string, identity = surface.id.unified_tab_id) =>
            maestroWorkspaceMutationKey(action, identity)
          return (
            <MaestroWorkspaceWindow
              key={surfaceKey}
              surfaceKey={surfaceKey}
              surface={surface}
              placement={placement}
              selected={selectedKey === surfaceKey}
              pending={props.pendingSurfaceKey === surfaceKey}
              linkTargetMode={Boolean(linkSourceKey && linkSourceKey !== surfaceKey)}
              runtimeTarget={props.target}
              onSelect={() => {
                props.onRevealPlacement(placement)
                setSelectedKey(surfaceKey)
              }}
              onActivate={() => {
                setSelectedKey(surfaceKey)
                if (linkSourceKey && linkSourceKey !== surfaceKey) {
                  void mutate({
                    action: 'create-manual-link',
                    source_surface_key: linkSourceKey,
                    target_surface_key: surfaceKey,
                    link_type: 'context-for',
                    label: null,
                    idempotency_key: key('manual-link', `${linkSourceKey}:${surfaceKey}`)
                  })
                  setLinkSourceKey(null)
                  return
                }
                void mutate({
                  action: 'focus',
                  surface_id: surface.id,
                  idempotency_key: key('select')
                })
              }}
              onFocus={() =>
                void mutate({
                  action: 'focus',
                  surface_id: surface.id,
                  idempotency_key: key('focus')
                })
              }
              onClose={() =>
                void mutate({
                  action: 'close',
                  surface_id: surface.id,
                  idempotency_key: key('close')
                })
              }
              onMove={(delta) => updatePlacement((current) => moveWorkspaceWindow(current, delta))}
              onResize={(delta) =>
                updatePlacement((current) => resizeWorkspaceWindow(current, delta))
              }
              onMoveCommit={(delta) =>
                void mutate({
                  action: 'set-placement',
                  surface_id: surface.id,
                  placement: moveWorkspaceWindow(placement, delta),
                  idempotency_key: key('move')
                })
              }
              onResizeCommit={(delta) =>
                void mutate({
                  action: 'set-placement',
                  surface_id: surface.id,
                  placement: resizeWorkspaceWindow(placement, delta),
                  idempotency_key: key('resize')
                })
              }
            />
          )
        })}
      </div>
      {selectedKey && selectedSurface ? (
        <MaestroWorkspaceInspector
          surfaceKey={selectedKey}
          surface={selectedSurface}
          snapshot={props.snapshot}
          document={props.document}
          onClose={() => setSelectedKey(null)}
          onRename={(title) =>
            void mutate({
              action: 'rename',
              surface_id: selectedSurface.id,
              title,
              idempotency_key: maestroWorkspaceMutationKey(
                'rename',
                selectedSurface.id.unified_tab_id
              )
            })
          }
          onStartLink={() => setLinkSourceKey(selectedKey)}
          onDeleteManualLink={(linkId) =>
            void mutate({
              action: 'delete-manual-link',
              link_id: linkId,
              idempotency_key: maestroWorkspaceMutationKey('delete-link', linkId)
            })
          }
          onDecideSuggestion={(fingerprint, decision) =>
            void mutate({
              action: 'decide-suggestion',
              fingerprint,
              decision,
              idempotency_key: maestroWorkspaceMutationKey(`suggestion-${decision}`, fingerprint)
            })
          }
        />
      ) : null}
    </>
  )
}
