import { MaestroBrowserSurfaceInspector } from './MaestroBrowserSurfaceInspector'
import { MaestroInspector } from './MaestroInspector'
import { MaestroPortalInspector } from './MaestroPortalCard'
import { MaestroTerminalInspector } from './MaestroTerminalInspector'
import type { MaestroRunProgressDetailIdentity } from '../../../../shared/maestro-run-progress'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { useMaestroCanvasLayout } from './useMaestroCanvasLayout'

type InspectorSlotProps = {
  layout: ReturnType<typeof useMaestroCanvasLayout>
  runtimeTarget: RuntimeClientTarget | null
  inspectedProgressIdentity: MaestroRunProgressDetailIdentity | null
  onClose: () => void
}

/** Exactly one inspector at a time, chosen by what the selection actually is. */
export function MaestroCanvasInspectorSlot({
  layout,
  runtimeTarget,
  inspectedProgressIdentity,
  onClose: clearSelection
}: InspectorSlotProps): React.JSX.Element | null {
  return (
    <>
      {layout.selectedNode?.projectedType === 'evidence' && layout.selectedNode.browserSurface ? (
        <MaestroBrowserSurfaceInspector
          receipt={layout.selectedNode.browserSurface}
          runtimeTarget={runtimeTarget}
          previewDataUrl={layout.selectedNode.browserPreviewUrl}
          onClose={clearSelection}
        />
      ) : layout.selectedNode?.projectedType === 'portal' ? (
        <MaestroPortalInspector node={layout.selectedNode} onClose={clearSelection} />
      ) : layout.selectedNode?.terminalId ? (
        <MaestroTerminalInspector node={layout.selectedNode} onClose={clearSelection} />
      ) : layout.selectedNode ? (
        <MaestroInspector
          node={layout.selectedNode}
          onClose={clearSelection}
          progressIdentity={inspectedProgressIdentity}
        />
      ) : inspectedProgressIdentity ? (
        <MaestroInspector onClose={clearSelection} progressIdentity={inspectedProgressIdentity} />
      ) : null}
    </>
  )
}
