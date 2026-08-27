import { createHash } from 'node:crypto'
import type {
  WorkspaceAutomaticLink,
  WorkspaceSuggestedLink,
  WorkspaceSurface,
  WorkspaceSurfaceSnapshot
} from '../../../../shared/maestro-workspace-canvas'
import type {
  RuntimeMaestroWorkspaceCanvasScope,
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult
} from '../../../../shared/runtime-types'
import { getMaestroProjection } from '../../orchestration/db/maestro/maestro-projection-store'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import type { MaestroTerminalLease } from '../../../../shared/maestro-terminal-lease'
import {
  joinMaestroWorkspaceBrowserReceipts,
  joinMaestroWorkspaceParentChildReceipts,
  latestMaestroWorkspaceReceiptTimestamp,
  type MaestroWorkspaceLinkReceiptEndpoint
} from './maestro-workspace-link-receipt-join'

type LinkProjection = Pick<WorkspaceSurfaceSnapshot, 'automatic_links' | 'suggested_links'>

type AutomaticLinkKind = Pick<
  WorkspaceAutomaticLink,
  'link_type' | 'authority_kind' | 'explanation_code'
>

const AUTOMATIC_EDGE_KINDS: Readonly<Partial<Record<string, AutomaticLinkKind>>> = {
  executes: {
    link_type: 'executes',
    authority_kind: 'execution-receipt',
    explanation_code: 'executes-resource'
  },
  produces: {
    link_type: 'produces',
    authority_kind: 'evidence-production-receipt',
    explanation_code: 'produced-evidence'
  },
  spawned_by: {
    link_type: 'parent-child',
    authority_kind: 'parent-child-receipt',
    explanation_code: 'parent-child'
  }
}

function terminalReceiptIdentity(
  database: OrchestrationDb,
  scope: RuntimeMaestroWorkspaceCanvasScope,
  tab: RuntimeMobileSessionClientTab
): { identifiers: Set<string>; lease: MaestroTerminalLease } | null {
  if (tab.type !== 'terminal' || tab.status !== 'ready') {
    return null
  }
  const lease = database.getMaestroTerminalLeaseByHandle(tab.terminal)
  if (
    !lease ||
    lease.executionHostId !== scope.execution_host_id ||
    lease.workspaceKey !== scope.workspace_key ||
    !lease.runId ||
    !lease.launchProfile.agent
  ) {
    return null
  }
  return {
    lease,
    identifiers: new Set(
      [
        tab.terminal,
        tab.ptyId,
        tab.parentTabId,
        lease.id,
        lease.workerTerminalResourceId,
        lease.terminalHandle,
        lease.tabId
      ].filter((value): value is string => Boolean(value))
    )
  }
}

function bindGraphNodesToSurfaces(params: {
  database: OrchestrationDb
  scope: RuntimeMaestroWorkspaceCanvasScope
  session: RuntimeMobileSessionTabsResult
  surfaces: Record<string, WorkspaceSurface>
  projection: NonNullable<ReturnType<typeof getMaestroProjection>>
}): Map<string, MaestroWorkspaceLinkReceiptEndpoint> {
  const candidates = new Map<string, Map<string, MaestroWorkspaceLinkReceiptEndpoint>>()
  const add = (nodeId: string, endpoint: MaestroWorkspaceLinkReceiptEndpoint): void => {
    const existing =
      candidates.get(nodeId) ?? new Map<string, MaestroWorkspaceLinkReceiptEndpoint>()
    existing.set(endpoint.surfaceKey, endpoint)
    candidates.set(nodeId, existing)
  }
  const surfaceByTabId = new Map(
    Object.entries(params.surfaces).map(([key, surface]) => [surface.id.unified_tab_id, key])
  )
  const terminalIdsByAttempt = new Map<string, Set<string>>()
  for (const node of params.projection.nodes) {
    if (node.type !== 'terminal-receipt' || !node.attemptId || !node.terminalId) {
      continue
    }
    const terminalIds = terminalIdsByAttempt.get(node.attemptId) ?? new Set<string>()
    terminalIds.add(node.terminalId)
    terminalIdsByAttempt.set(node.attemptId, terminalIds)
  }
  for (const tab of params.session.tabs) {
    if (tab.type !== 'terminal') {
      continue
    }
    const surfaceKey = surfaceByTabId.get(tab.parentTabId)
    if (!surfaceKey) {
      continue
    }
    const identity = terminalReceiptIdentity(params.database, params.scope, tab)
    if (!identity) {
      continue
    }
    for (const node of params.projection.nodes) {
      const attemptTerminalIds = node.attemptId
        ? terminalIdsByAttempt.get(node.attemptId)
        : undefined
      if (
        (node.type === 'terminal-receipt' || node.type === 'attempt') &&
        node.terminalId &&
        (node.type === 'terminal-receipt' ||
          (attemptTerminalIds?.size === 1 && attemptTerminalIds.has(node.terminalId))) &&
        identity.identifiers.has(node.terminalId) &&
        identity.lease.runId === params.projection.runId &&
        (!node.taskId || !identity.lease.taskId || node.taskId === identity.lease.taskId) &&
        (!node.attemptId ||
          !identity.lease.attemptId ||
          node.attemptId === identity.lease.attemptId)
      ) {
        add(node.id, { surfaceKey, receipt: identity.lease, node })
      }
    }
  }
  for (const node of params.projection.nodes) {
    const receipt = node.browserSurface
    if (
      !receipt?.browser_page_id ||
      receipt.execution_host_id !== params.scope.execution_host_id ||
      receipt.workspace_key !== params.scope.workspace_key
    ) {
      continue
    }
    const matches = Object.entries(params.surfaces).filter(
      ([, surface]) =>
        surface.binding.kind === 'browser' &&
        surface.binding.browser_page_id === receipt.browser_page_id
    )
    for (const [surfaceKey] of matches) {
      add(node.id, { surfaceKey, receipt, node })
    }
  }
  return new Map(
    [...candidates.entries()].flatMap(([nodeId, endpoints]) =>
      endpoints.size === 1 ? [[nodeId, [...endpoints.values()][0]!] as const] : []
    )
  )
}

function automaticLinks(params: {
  database: OrchestrationDb
  scope: RuntimeMaestroWorkspaceCanvasScope
  session: RuntimeMobileSessionTabsResult
  surfaces: Record<string, WorkspaceSurface>
}): WorkspaceAutomaticLink[] {
  const projection = getMaestroProjection.call(params.database, params.scope)
  if (!projection) {
    return []
  }
  const nodeBindings = bindGraphNodesToSurfaces({ ...params, projection })
  return projection.edges.flatMap((edge) => {
    const kind = AUTOMATIC_EDGE_KINDS[edge.type]
    const source = nodeBindings.get(edge.source_id)
    const target = nodeBindings.get(edge.target_id)
    if (!kind || !source || !target || source.surfaceKey === target.surfaceKey) {
      return []
    }
    const receiptTimestamps =
      edge.type === 'spawned_by'
        ? (() => {
            const receipts = joinMaestroWorkspaceParentChildReceipts(
              source,
              target,
              projection.runId
            )
            return receipts ? [receipts.child.updatedAt, receipts.parent.updatedAt] : null
          })()
        : (() => {
            const receipts = joinMaestroWorkspaceBrowserReceipts(source, target)
            return receipts ? [receipts.terminal.updatedAt, receipts.browser.updated_at] : null
          })()
    if (!receiptTimestamps) {
      return []
    }
    const observedAt = latestMaestroWorkspaceReceiptTimestamp(receiptTimestamps)
    return [
      {
        id: `automatic-${createHash('sha256')
          .update(`${projection.runId}\0${edge.id}`)
          .digest('hex')
          .slice(0, 24)}`,
        source_surface_key: source.surfaceKey,
        target_surface_key: target.surfaceKey,
        ...kind,
        authority_id: `${projection.runId}:${edge.id}`,
        authority_revision: projection.revision,
        observed_at: observedAt
      }
    ]
  })
}

function suggestionRevision(evidence: string): number {
  return Number.parseInt(createHash('sha256').update(evidence).digest('hex').slice(0, 8), 16)
}

function suggestedLinks(params: {
  scope: RuntimeMaestroWorkspaceCanvasScope
  session: RuntimeMobileSessionTabsResult
  surfaces: Record<string, WorkspaceSurface>
  automatic: WorkspaceAutomaticLink[]
}): WorkspaceSuggestedLink[] {
  const automaticPairs = new Set(
    params.automatic.flatMap((link) => [
      `${link.source_surface_key}\0${link.target_surface_key}`,
      `${link.target_surface_key}\0${link.source_surface_key}`
    ])
  )
  const surfaceByTabId = new Map(
    Object.entries(params.surfaces).map(([key, surface]) => [surface.id.unified_tab_id, key])
  )
  return (params.session.tabGroups ?? []).flatMap((group) => {
    const ordered = group.tabOrder
      .map((tabId) => surfaceByTabId.get(tabId))
      .filter((surfaceKey): surfaceKey is string => Boolean(surfaceKey))
    return ordered.slice(0, -1).flatMap((source, index) => {
      const target = ordered[index + 1]!
      if (source === target || automaticPairs.has(`${source}\0${target}`)) {
        return []
      }
      const evidence = JSON.stringify([
        params.scope.execution_host_id,
        params.scope.workspace_key,
        group.id,
        ordered
      ])
      const fingerprint = `suggestion-${createHash('sha256')
        .update(`${evidence}\0${source}\0${target}`)
        .digest('hex')
        .slice(0, 24)}`
      return [
        {
          fingerprint,
          revision: suggestionRevision(evidence),
          source_surface_key: source,
          target_surface_key: target,
          link_type: 'context-for',
          reason: 'Adjacent tabs in the same workspace group may be related.',
          evidence_summary: `Host tab group ${group.id} places these exact tabs next to each other.`
        }
      ]
    })
  })
}

export function projectMaestroWorkspaceLinks(params: {
  database: OrchestrationDb
  scope: RuntimeMaestroWorkspaceCanvasScope
  session: RuntimeMobileSessionTabsResult
  surfaces: Record<string, WorkspaceSurface>
}): LinkProjection {
  const automatic = automaticLinks(params)
  return {
    automatic_links: automatic,
    suggested_links: suggestedLinks({ ...params, automatic })
  }
}
