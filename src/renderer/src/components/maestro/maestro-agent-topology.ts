import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import {
  acceptFormalRelations,
  formalLabelCandidates,
  formalRelationsFromProjection
} from './maestro-agent-formal-relations'
import {
  terminalSurfaces,
  uniqueSurfaceByPaneKey,
  uniqueSurfaceByTerminalHandle,
  type TerminalSurface
} from './maestro-agent-terminal-bindings'
import type {
  AcceptedFormalRelation,
  CanvasAgentNode,
  CanvasAgentRelation,
  CanvasAgentTopology,
  MaestroAgentFormalProjection,
  MaestroAgentFormalRelationInput
} from './maestro-agent-topology-types'

export type {
  CanvasAgentNode,
  CanvasAgentRelation,
  CanvasAgentTopology,
  CanvasAgentTopologyProvenance,
  MaestroAgentFormalRelationInput
} from './maestro-agent-topology-types'
export { maestroTerminalSurfacePaneKey } from './maestro-agent-terminal-bindings'

function acceptedDelegateRelations(
  formalRelations: readonly AcceptedFormalRelation[],
  terminals: readonly TerminalSurface[],
  surfaceByPaneKey: ReadonlyMap<string, string>,
  orchestrationByPaneKey: Readonly<Record<string, AgentStatusOrchestrationContext>>
): CanvasAgentRelation[] {
  const formalParentsByChild = new Map<string, Set<string>>()
  for (const relation of formalRelations) {
    if (relation.kind !== 'delegates') {
      continue
    }
    const parents = formalParentsByChild.get(relation.targetSurfaceId) ?? new Set<string>()
    parents.add(relation.sourceSurfaceId)
    formalParentsByChild.set(relation.targetSurfaceId, parents)
  }
  const disputedChildren = new Set(
    [...formalParentsByChild.entries()]
      .filter(([, parents]) => parents.size !== 1)
      .map(([child]) => child)
  )
  const formalDelegates = formalRelations
    .filter(
      (relation) => relation.kind === 'delegates' && !disputedChildren.has(relation.targetSurfaceId)
    )
    .map((relation) => ({
      id: relation.id,
      sourceSurfaceId: relation.sourceSurfaceId,
      targetSurfaceId: relation.targetSurfaceId,
      kind: 'delegates' as const,
      provenance: relation.provenance,
      authorityId: relation.authorityId
    }))
  const formalChildren = new Set(formalParentsByChild.keys())
  const runtimeDelegates = terminals.flatMap((terminal): CanvasAgentRelation[] => {
    if (formalChildren.has(terminal.surfaceId)) {
      return []
    }
    const parentPaneKey = orchestrationByPaneKey[terminal.paneKey]?.parentPaneKey
    const parentSurfaceId = parentPaneKey ? surfaceByPaneKey.get(parentPaneKey) : undefined
    if (!parentSurfaceId || parentSurfaceId === terminal.surfaceId) {
      return []
    }
    return [
      {
        id: `runtime-lineage:delegates:${parentSurfaceId}\0${terminal.surfaceId}`,
        sourceSurfaceId: parentSurfaceId,
        targetSurfaceId: terminal.surfaceId,
        kind: 'delegates',
        provenance: 'runtime-lineage'
      }
    ]
  })
  return [...formalDelegates, ...runtimeDelegates]
}

function descendants(
  coordinatorSurfaceId: string,
  delegates: readonly CanvasAgentRelation[],
  coordinatorTargets: ReadonlyMap<string, ReadonlySet<string>>,
  formalRunSurfaces: ReadonlyMap<string, ReadonlySet<string>>,
  formalCoordinatorRuns: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  const found = new Set(coordinatorTargets.get(coordinatorSurfaceId) ?? [])
  for (const runId of formalCoordinatorRuns.get(coordinatorSurfaceId) ?? []) {
    for (const surfaceId of formalRunSurfaces.get(runId) ?? []) {
      if (surfaceId !== coordinatorSurfaceId) {
        found.add(surfaceId)
      }
    }
  }
  const childrenByParent = new Map<string, Set<string>>()
  for (const relation of delegates) {
    const children = childrenByParent.get(relation.sourceSurfaceId) ?? new Set<string>()
    children.add(relation.targetSurfaceId)
    childrenByParent.set(relation.sourceSurfaceId, children)
  }
  const pending = [coordinatorSurfaceId, ...found]
  while (pending.length > 0) {
    const parent = pending.pop()!
    for (const child of childrenByParent.get(parent) ?? []) {
      if (child === coordinatorSurfaceId || found.has(child)) {
        continue
      }
      found.add(child)
      pending.push(child)
    }
  }
  return found
}

function compareRelations(left: CanvasAgentRelation, right: CanvasAgentRelation): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.sourceSurfaceId.localeCompare(right.sourceSurfaceId) ||
    left.targetSurfaceId.localeCompare(right.targetSurfaceId) ||
    left.id.localeCompare(right.id)
  )
}

export function projectMaestroAgentTopology(params: {
  surfaces: Readonly<Record<string, WorkspaceSurface>>
  orchestrationByPaneKey: Readonly<Record<string, AgentStatusOrchestrationContext>>
  terminalHandleByPaneKey: Readonly<Record<string, string | undefined>>
  formalRelations?: readonly MaestroAgentFormalRelationInput[]
  formalProjection?: MaestroAgentFormalProjection | null
}): CanvasAgentTopology {
  const terminals = terminalSurfaces(params.surfaces)
  const surfaceIds = new Set(terminals.map((terminal) => terminal.surfaceId))
  const surfaceByPaneKey = uniqueSurfaceByPaneKey(terminals)
  const surfaceByHandle = uniqueSurfaceByTerminalHandle(terminals, params.terminalHandleByPaneKey)
  const projectedFormalRelations = formalRelationsFromProjection(
    params.formalProjection,
    surfaceByHandle
  )
  const formalRelations = acceptFormalRelations(
    [...(params.formalRelations ?? []), ...projectedFormalRelations],
    surfaceIds
  )
  const delegates = acceptedDelegateRelations(
    formalRelations,
    terminals,
    surfaceByPaneKey,
    params.orchestrationByPaneKey
  )
  const delegateTargets = new Set(delegates.map((relation) => relation.targetSurfaceId))
  const coordinatorCandidates = new Set(
    delegates
      .map((relation) => relation.sourceSurfaceId)
      .filter((surfaceId) => !delegateTargets.has(surfaceId))
  )
  const coordinatorTargets = new Map<string, Set<string>>()
  const formalCoordinatorCandidates = new Set<string>()
  for (const terminal of terminals) {
    const orchestration = params.orchestrationByPaneKey[terminal.paneKey]
    const coordinatorHandle = orchestration?.coordinatorHandle
    const coordinatorSurfaceId = coordinatorHandle
      ? surfaceByHandle.get(coordinatorHandle)
      : undefined
    if (!coordinatorSurfaceId || coordinatorSurfaceId === terminal.surfaceId) {
      continue
    }
    coordinatorCandidates.add(coordinatorSurfaceId)
    if (orchestration.orchestrationRunId) {
      formalCoordinatorCandidates.add(coordinatorSurfaceId)
    }
    const targets = coordinatorTargets.get(coordinatorSurfaceId) ?? new Set<string>()
    targets.add(terminal.surfaceId)
    coordinatorTargets.set(coordinatorSurfaceId, targets)
  }

  const formalRunSurfaces = new Map<string, Set<string>>()
  const formalCoordinatorRuns = new Map<string, Set<string>>()
  const formalSurfaceIds = new Set<string>()
  for (const relation of formalRelations) {
    formalSurfaceIds.add(relation.sourceSurfaceId)
    formalSurfaceIds.add(relation.targetSurfaceId)
    const runSurfaces = formalRunSurfaces.get(relation.runId) ?? new Set<string>()
    runSurfaces.add(relation.sourceSurfaceId)
    runSurfaces.add(relation.targetSurfaceId)
    formalRunSurfaces.set(relation.runId, runSurfaces)
    for (const [surfaceId, role] of [
      [relation.sourceSurfaceId, relation.sourceRole],
      [relation.targetSurfaceId, relation.targetRole]
    ] as const) {
      if (role !== 'coordinator') {
        continue
      }
      coordinatorCandidates.add(surfaceId)
      formalCoordinatorCandidates.add(surfaceId)
      const runs = formalCoordinatorRuns.get(surfaceId) ?? new Set<string>()
      runs.add(relation.runId)
      formalCoordinatorRuns.set(surfaceId, runs)
    }
  }

  const descendantsByCandidate = new Map(
    [...coordinatorCandidates].map((surfaceId) => [
      surfaceId,
      descendants(
        surfaceId,
        delegates,
        coordinatorTargets,
        formalRunSurfaces,
        formalCoordinatorRuns
      )
    ])
  )
  const rootsWithDescendants = [...coordinatorCandidates].filter(
    (surfaceId) => (descendantsByCandidate.get(surfaceId)?.size ?? 0) > 0
  )
  const coordinatorSurfaceId =
    rootsWithDescendants.length === 1 ? rootsWithDescendants[0] : undefined
  const coordinatorDescendants = coordinatorSurfaceId
    ? (descendantsByCandidate.get(coordinatorSurfaceId) ?? new Set<string>())
    : new Set<string>()
  const coordinatorIsFormal =
    Boolean(coordinatorSurfaceId && formalCoordinatorCandidates.has(coordinatorSurfaceId)) ||
    delegates.some(
      (relation) =>
        relation.sourceSurfaceId === coordinatorSurfaceId &&
        relation.provenance === 'orca-orchestration'
    )
  const coordinateRelations: CanvasAgentRelation[] = coordinatorSurfaceId
    ? [...coordinatorDescendants].map((targetSurfaceId) => ({
        id: `topology:coordinates:${coordinatorSurfaceId}\0${targetSurfaceId}`,
        sourceSurfaceId: coordinatorSurfaceId,
        targetSurfaceId,
        kind: 'coordinates',
        provenance: coordinatorIsFormal ? 'orca-orchestration' : 'runtime-lineage'
      }))
    : []
  const formalNonDelegates: CanvasAgentRelation[] = formalRelations
    .filter((relation) => relation.kind !== 'delegates')
    .map((relation) => ({
      id: relation.id,
      sourceSurfaceId: relation.sourceSurfaceId,
      targetSurfaceId: relation.targetSurfaceId,
      kind: relation.kind,
      provenance: relation.provenance,
      authorityId: relation.authorityId
    }))
  const parentBySurfaceId = new Map(
    delegates.map((relation) => [relation.targetSurfaceId, relation.sourceSurfaceId])
  )
  const formalLabels = formalLabelCandidates(formalRelations)
  const nodes = terminals.map((terminal): CanvasAgentNode => {
    const orchestration = params.orchestrationByPaneKey[terminal.paneKey]
    const functionLabel =
      orchestration?.displayName?.trim() ||
      orchestration?.taskTitle?.trim() ||
      formalLabels.get(terminal.surfaceId) ||
      terminal.title
    const inCoordinatorLineage =
      terminal.surfaceId === coordinatorSurfaceId || coordinatorDescendants.has(terminal.surfaceId)
    return {
      surfaceId: terminal.surfaceId,
      paneKey: terminal.paneKey,
      parentSurfaceId: parentBySurfaceId.get(terminal.surfaceId),
      coordinatorSurfaceId: inCoordinatorLineage ? coordinatorSurfaceId : undefined,
      functionLabel,
      provenance:
        formalSurfaceIds.has(terminal.surfaceId) ||
        orchestration?.orchestrationRunId ||
        (terminal.surfaceId === coordinatorSurfaceId && coordinatorIsFormal)
          ? 'orca-orchestration'
          : 'runtime-lineage'
    }
  })
  return {
    coordinatorSurfaceId,
    nodes,
    relations: [...delegates, ...formalNonDelegates, ...coordinateRelations].sort(compareRelations)
  }
}
