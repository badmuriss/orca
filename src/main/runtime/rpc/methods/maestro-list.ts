import {
  buildMaestroCanvasIndex,
  type MaestroCanvasIndexEntry
} from '../../../../shared/maestro-canvas-index'
import type { MaestroRunProgress } from '../../../../shared/maestro-run-progress'
import { listMaestroRunProgress } from '../../orchestration/db/maestro/maestro-projection-store'
import { defineMethod, type RpcMethod } from '../core'

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

export const MAESTRO_LIST_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'maestro.list',
    params: null,
    handler: (_params, { runtime }) => {
      const database = runtime.getOrchestrationDb()
      return {
        entries: joinMaestroCanvasProgress(
          database.listMaestroCanvasIndex(),
          listMaestroRunProgress.call(database)
        )
      }
    }
  })
]
