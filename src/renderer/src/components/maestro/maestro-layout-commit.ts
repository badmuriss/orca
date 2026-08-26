import type { MaestroDocumentReadScope } from '../../../../shared/maestro-contract'
import { applyMaestroDocumentLayoutMutation } from '@/runtime/runtime-maestro-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  createMaestroMutationId,
  isMaestroMutationResult,
  type MaestroCanvasPoint
} from './maestro-canvas-view-model'
import type { MaestroCanvasViewport } from './maestro-canvas-viewport'

export type MaestroPendingCommit =
  | { kind: 'move-node'; nodeId: string; position: MaestroCanvasPoint }
  | { kind: 'set-viewport'; viewport: MaestroCanvasViewport }

export type MaestroCommitOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'applied'; revision: number }
  | { outcome: 'conflict' }

type CommitParams = {
  next: MaestroPendingCommit
  runtimeTarget: RuntimeClientTarget | null
  scope: MaestroDocumentReadScope
  expectedRevision: number | undefined
}

/** Applies one layout mutation and reports the revision it landed on. */
export async function commitMaestroLayout({
  next,
  runtimeTarget,
  scope,
  expectedRevision
}: CommitParams): Promise<MaestroCommitOutcome> {
  if (!runtimeTarget || expectedRevision === undefined) {
    return { outcome: 'skipped' }
  }
  try {
    const response = await applyMaestroDocumentLayoutMutation(runtimeTarget, {
      schema_version: 1,
      protocol: 'maestro-document-layout-mutation/v1',
      mutation_id: createMaestroMutationId(),
      scope,
      expected_revision: expectedRevision,
      operation:
        next.kind === 'move-node'
          ? { kind: 'move-node', node_id: next.nodeId, position: next.position }
          : { kind: 'set-viewport', viewport: next.viewport }
    })
    if (!isMaestroMutationResult(response) || response.outcome === 'conflict') {
      return { outcome: 'conflict' }
    }
    return { outcome: 'applied', revision: response.revision }
  } catch {
    return { outcome: 'conflict' }
  }
}
