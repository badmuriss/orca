import {
  buildMaestroCanvasIndex,
  type MaestroCanvasIndexEntry
} from '../../../../shared/maestro-canvas-index'
import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'
import {
  listMaestroProjectionIndex,
  listMaestroRunProgress
} from '../../orchestration/db/maestro/maestro-projection-store'
import { defineMethod, type RpcMethod } from '../core'

type MaestroProjectionIndexEntry = ReturnType<typeof listMaestroProjectionIndex>[number]
export type LabeledMaestroCanvasIndexEntry = MaestroCanvasIndexEntry & {
  documentState: 'ready' | 'empty'
  documentRevision: number | null
  projectionState: 'ready' | 'empty'
  projectionRevision: number | null
  recoveryHint: string | null
}

export function joinMaestroCanvasProgress(
  entries: readonly MaestroCanvasIndexEntry[],
  progressEntries: readonly {
    executionHostId: string
    workspaceKey: string
    runProgress: MaestroRunProgress
  }[]
): MaestroCanvasIndexEntry[] {
  const progressByWorkspace = new Map(
    progressEntries.map((entry) => [
      `${entry.executionHostId}\0${entry.workspaceKey}`,
      entry.runProgress
    ])
  )
  return buildMaestroCanvasIndex(
    entries.map((entry) => ({
      ...entry,
      runProgress: progressByWorkspace.get(`${entry.executionHostId}\0${entry.workspaceKey}`)
    }))
  )
}

export function buildLabeledMaestroCanvasIndex(
  documentEntries: readonly MaestroCanvasIndexEntry[],
  projectionEntries: readonly MaestroProjectionIndexEntry[],
  progressEntries: Parameters<typeof joinMaestroCanvasProgress>[1]
): LabeledMaestroCanvasIndexEntry[] {
  const documents = new Map(
    documentEntries.map((entry) => [`${entry.executionHostId}\0${entry.workspaceKey}`, entry])
  )
  const projections = new Map(
    projectionEntries.map((entry) => [`${entry.executionHostId}\0${entry.workspaceKey}`, entry])
  )
  const keys = new Set([...documents.keys(), ...projections.keys()])
  const entries = [...keys].map((key) => {
    const document = documents.get(key)
    const projection = projections.get(key)
    const executionHostId = document?.executionHostId ?? projection?.executionHostId
    const workspaceKey = document?.workspaceKey ?? projection?.workspaceKey
    if (!executionHostId || !workspaceKey) {
      throw new Error('Maestro index entry lost its workspace identity.')
    }
    return {
      executionHostId,
      workspaceKey,
      revision: document?.revision ?? projection?.revision ?? 0,
      updatedAt: document?.updatedAt ?? projection?.updatedAt ?? new Date(0).toISOString(),
      intentCounts: document?.intentCounts ?? { pending: 0, claimed: 0, settled: 0 },
      documentState: document ? ('ready' as const) : ('empty' as const),
      documentRevision: document?.revision ?? null,
      projectionState: projection ? ('ready' as const) : ('empty' as const),
      projectionRevision: projection?.revision ?? null,
      recoveryHint:
        projection && !document
          ? 'A projected Run exists without an authorable document. Use maestro projection show to inspect it.'
          : null
    }
  })
  return joinMaestroCanvasProgress(entries, progressEntries) as LabeledMaestroCanvasIndexEntry[]
}

export const MAESTRO_LIST_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'maestro.list',
    params: null,
    handler: (_params, { runtime }) => {
      const database = runtime.getOrchestrationDb()
      return {
        entries: buildLabeledMaestroCanvasIndex(
          database.listMaestroCanvasIndex(),
          listMaestroProjectionIndex.call(database),
          listMaestroRunProgress.call(database)
        )
      }
    }
  })
]
