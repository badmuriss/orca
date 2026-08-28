import { z } from 'zod'
import { AgentGraphWorkspaceScopeSchema, type AgentGraphWorkspaceScope } from './workspace-scope'
import {
  parseNegotiatedWorkspaceBootstrapReceipt,
  type NegotiatedWorkspaceBootstrapReceipt
} from './workspace-bootstrap-receipt'

const WorkspaceScopeBindingSchema = z
  .object({
    run_id: z.string().min(1).max(512),
    coordinator_generation: z.number().int().positive(),
    binding_receipt_ref: z.string().min(1).max(4_096).startsWith('artifact:'),
    binding_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/)
  })
  .strict()

export type WorkspaceScopeBinding = z.infer<typeof WorkspaceScopeBindingSchema>

export function receiptToAgentGraphWorkspaceScope(
  receiptValue: NegotiatedWorkspaceBootstrapReceipt,
  bindingValue: WorkspaceScopeBinding
): AgentGraphWorkspaceScope {
  const receipt = parseNegotiatedWorkspaceBootstrapReceipt(
    receiptValue,
    receiptValue.schema_version
  )
  const binding = WorkspaceScopeBindingSchema.parse(bindingValue)
  if (receipt.authority.issued_for_run_id !== binding.run_id) {
    throw new Error('Workspace bootstrap receipt was issued for another run')
  }

  const executionWorkspace =
    receipt.execution_workspace.kind === 'git-worktree'
      ? {
          execution_host_id: receipt.execution_workspace.execution_host_id,
          workspace_key: receipt.execution_workspace.workspace_key,
          kind: receipt.execution_workspace.kind,
          path: receipt.execution_workspace.path,
          worktree_path: receipt.execution_workspace.worktree_path
        }
      : {
          execution_host_id: receipt.execution_workspace.execution_host_id,
          workspace_key: receipt.execution_workspace.workspace_key,
          kind: receipt.execution_workspace.kind,
          path: receipt.execution_workspace.path
        }

  return AgentGraphWorkspaceScopeSchema.parse({
    schema_version: 1,
    repository_id: receipt.repository_id,
    canonical_root: receipt.canonical_root,
    execution_host: {
      id: receipt.execution_host.id,
      boundary: receipt.execution_host.boundary
    },
    orchestration_home: {
      execution_host_id: receipt.orchestration_home.execution_host_id,
      workspace_key: receipt.orchestration_home.workspace_key,
      kind: 'folder',
      path: receipt.orchestration_home.path
    },
    execution_workspace: executionWorkspace,
    base_revision: receipt.base_revision,
    dirty_paths: [...receipt.dirty_paths],
    run_id: binding.run_id,
    coordinator_generation: binding.coordinator_generation,
    binding_receipt_ref: binding.binding_receipt_ref,
    binding_receipt_hash: binding.binding_receipt_hash
  })
}
