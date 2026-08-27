import type { AgentStatusOrchestrationContext } from '../../../../shared/agent-status-types'
import type { MaestroProjection } from '../../../../shared/maestro-projection'
import type { WorkspaceSurface } from '../../../../shared/maestro-workspace-canvas'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

export type CanvasAgentTopologyProvenance = 'orca-orchestration' | 'runtime-lineage'

export type CanvasAgentNode = {
  surfaceId: string
  paneKey: string
  parentSurfaceId?: string
  coordinatorSurfaceId?: string
  functionLabel: string
  provenance: CanvasAgentTopologyProvenance
}

export type CanvasAgentRelation = {
  id: string
  sourceSurfaceId: string
  targetSurfaceId: string
  kind: 'coordinates' | 'delegates' | 'depends-on' | 'reports-to' | 'context-for'
  provenance: CanvasAgentTopologyProvenance
  authorityId?: string
}

export type MaestroAgentFormalRelationInput = {
  sourceSurfaceId: string
  targetSurfaceId: string
  kind: Exclude<CanvasAgentRelation['kind'], 'coordinates'>
  provenance: 'orca-orchestration'
  runId: string
  authorityId: string
  sourceFunctionLabel?: string
  targetFunctionLabel?: string
  sourceRole: 'coordinator' | 'worker'
  targetRole: 'coordinator' | 'worker'
}

export type CanvasAgentTopology = {
  coordinatorSurfaceId?: string
  nodes: CanvasAgentNode[]
  relations: CanvasAgentRelation[]
}

type TerminalSurface = { surfaceId: string; paneKey: string; title: string }

type AcceptedFormalRelation = MaestroAgentFormalRelationInput & { id: string }
type MaestroAgentFormalProjection = Pick<MaestroProjection, 'runId' | 'nodes' | 'edges'>

const FORMAL_EDGE_KIND: Readonly<
  Partial<Record<MaestroProjection['edges'][number]['type'], MaestroAgentFormalRelationInput['kind']>>
> = {
  spawned_by: 'delegates',
  depends_on: 'depends-on',
  reports_to: 'reports-to',
  context_for: 'context-for'
}

function terminalPaneKey(surface: WorkspaceSurface): string | null {
  if (surface.binding.kind !== 'terminal') {
    return null
  }
  const parsed = parsePaneKey(surface.binding.pane_key)
  if (parsed?.tabId === surface.binding.terminal_tab_id) {
    return surface.binding.pane_key
  }
  if (surface.binding.pane_key.includes(':')) {
    return null
  }
  return `${surface.binding.terminal_tab_id}:${surface.binding.pane_key}`
}

function terminalSurfaces(
  surfaces: Readonly<Record<string, WorkspaceSurface>>
): TerminalSurface[] {
  return Object.entries(surfaces)
    .flatMap(([surfaceId, surface]) => {
      const paneKey = terminalPaneKey(surface)
      return paneKey ? [{ surfaceId, paneKey, title: surface.title }] : []
    })
    .sort((left, right) => left.surfaceId.localeCompare(right.surfaceId))
}

function uniqueCandidateValues(
  candidates: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, string> {
  return new Map(
    [...candidates.entries()].flatMap(([key, values]) =>
      values.size === 1 ? [[key, [...values][0]!] as const] : []
    )
  )
}

function uniqueSurfaceByPaneKey(terminals: readonly TerminalSurface[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>()
  for (const terminal of terminals) {
    const surfaceIds = candidates.get(terminal.paneKey) ?? new Set<string>()
    surfaceIds.add(terminal.surfaceId)
    candidates.set(terminal.paneKey, surfaceIds)
  }
  return uniqueCandidateValues(candidates)
}

function uniqueSurfaceByTerminalHandle(
  terminals: readonly TerminalSurface[],
  terminalHandleByPaneKey: Readonly<Record<string, string | undefined>>
): Map<string, string> {
  const candidates = new Map<string, Set<string>>()
  for (const terminal of terminals) {
    const handle = terminalHandleByPaneKey[terminal.paneKey]
    if (!handle) {
      continue
    }
    const surfaceIds = candidates.get(handle) ?? new Set<string>()
    surfaceIds.add(terminal.surfaceId)
    candidates.set(handle, surfaceIds)
  }
  return uniqueCandidateValues(candidates)
}

function sameFormalRelation(
  left: MaestroAgentFormalRelationInput,
  right: MaestroAgentFormalRelationInput
): boolean {
  return (
    left.sourceSurfaceId === right.sourceSurfaceId &&
    left.targetSurfaceId === right.targetSurfaceId &&
    left.kind === right.kind &&
    left.runId === right.runId &&
    left.sourceFunctionLabel === right.sourceFunctionLabel &&
    left.targetFunctionLabel === right.targetFunctionLabel &&
    left.sourceRole === right.sourceRole &&
    left.targetRole === right.targetRole
  )
}

function formalRelationsFromProjection(
  projection: MaestroAgentFormalProjection | null | undefined,
  surfaceByHandle: ReadonlyMap<string, string>
): MaestroAgentFormalRelationInput[] {
  if (!projection) {
    return []
  }
  const candidatesByNode = new Map<string, Set<string>>()
  const add = (nodeId: string, surfaceId: string): void => {
    const candidates = candidatesByNode.get(nodeId) ?? new Set<string>()
    candidates.add(surfaceId)
    candidatesByNode.set(nodeId, candidates)
  }
  const directSurfaceByNode = new Map<string, string>()
  for (const node of projection.nodes) {
    const surfaceId = node.terminalId ? surfaceByHandle.get(node.terminalId) : undefined
    if (surfaceId) {
      directSurfaceByNode.set(node.id, surfaceId)
      add(node.id, surfaceId)
    }
  }
  const surfaceIdsByTask = new Map<string, Set<string>>()
  for (const node of projection.nodes) {
    const surfaceId = directSurfaceByNode.get(node.id)
    if (!surfaceId || !node.taskId) {
      continue
    }
    const surfaceIds = surfaceIdsByTask.get(node.taskId) ?? new Set<string>()
    surfaceIds.add(surfaceId)
    surfaceIdsByTask.set(node.taskId, surfaceIds)
  }
  for (const node of projection.nodes) {
    const surfaceIds = node.type === 'task' && node.taskId ? surfaceIdsByTask.get(node.taskId) : null
    if (surfaceIds?.size === 1) {
      add(node.id, [...surfaceIds][0]!)
    }
  }
  const bindings = uniqueCandidateValues(candidatesByNode)
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]))
  return projection.edges.flatMap((edge): MaestroAgentFormalRelationInput[] => {
    const kind = FORMAL_EDGE_KIND[edge.type]
    const edgeSource = bindings.get(edge.source_id)
    const edgeTarget = bindings.get(edge.target_id)
    if (!kind || !edgeSource || !edgeTarget || edgeSource === edgeTarget) {
      return []
    }
    const reverse = edge.type === 'spawned_by'
    const sourceNode = nodesById.get(reverse ? edge.target_id : edge.source_id)
    const targetNode = nodesById.get(reverse ? edge.source_id : edge.target_id)
    return [
      {
        sourceSurfaceId: reverse ? edgeTarget : edgeSource,
        targetSurfaceId: reverse ? edgeSource : edgeTarget,
        kind,
        provenance: 'orca-orchestration',
        runId: projection.runId,
        authorityId: `${projection.runId}:${edge.id}`,
        sourceFunctionLabel: sourceNode?.title,
        targetFunctionLabel: targetNode?.title,
        sourceRole: sourceNode?.role === 'coordinator' ? 'coordinator' : 'worker',
        targetRole: targetNode?.role === 'coordinator' ? 'coordinator' : 'worker'
      }
    ]
  })
}

function acceptFormalRelations(
  relations: readonly MaestroAgentFormalRelationInput[],
  surfaceIds: ReadonlySet<string>
): AcceptedFormalRelation[] {
  const byAuthority = new Map<string, MaestroAgentFormalRelationInput[]>()
  for (const relation of relations) {
    if (
      relation.sourceSurfaceId === relation.targetSurfaceId ||
      !surfaceIds.has(relation.sourceSurfaceId) ||
      !surfaceIds.has(relation.targetSurfaceId)
    ) {
      continue
    }
    const candidates = byAuthority.get(relation.authorityId) ?? []
    candidates.push(relation)
    byAuthority.set(relation.authorityId, candidates)
  }
  return [...byAuthority.entries()].flatMap(([authorityId, candidates]) => {
    const first = candidates[0]
    if (!first || candidates.some((candidate) => !sameFormalRelation(first, candidate))) {
      return []
    }
    return [{ ...first, id: `formal:${authorityId}` }]
  })
}

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

function labelCandidates(
  formalRelations: readonly AcceptedFormalRelation[]
): ReadonlyMap<string, string> {
  const candidates = new Map<string, Set<string>>()
  const add = (surfaceId: string, label: string | undefined): void => {
    const trimmed = label?.trim()
    if (!trimmed) {
      return
    }
    const labels = candidates.get(surfaceId) ?? new Set<string>()
    labels.add(trimmed)
    candidates.set(surfaceId, labels)
  }
  for (const relation of formalRelations) {
    add(relation.sourceSurfaceId, relation.sourceFunctionLabel)
    add(relation.targetSurfaceId, relation.targetFunctionLabel)
  }
  return uniqueCandidateValues(candidates)
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
  const formalLabels = labelCandidates(formalRelations)
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
