import { z } from 'zod'
import { MaestroBootstrapRequestSchema } from '../shared/maestro-bootstrap-contract'
import {
  AgentGraphViewSchema,
  MaestroDocumentAuthoringMutationSchema,
  MaestroMutationSchema,
  MaestroWorkspaceAnchorSchema
} from '../shared/maestro-contract'
import {
  MAESTRO_COMPOSED_BOOTSTRAP_RUNTIME_CAPABILITY,
  MAESTRO_RUNTIME_CAPABILITY
} from '../shared/protocol-version'

export const MaestroProjectionApplyParamsSchema = z
  .object({
    workspace: MaestroWorkspaceAnchorSchema,
    view: AgentGraphViewSchema
  })
  .strict()

const JSON_SCHEMA_OPTIONS = { io: 'input' } as const

export const MAESTRO_AGENT_PAYLOAD_CONTRACTS = {
  'maestro apply': {
    schema: z.toJSONSchema(MaestroMutationSchema, JSON_SCHEMA_OPTIONS),
    requiredCapabilities: [MAESTRO_RUNTIME_CAPABILITY],
    preconditions: ['The authenticated actor may mutate the exact active Run workspace.'],
    stdinExample: 'orca maestro apply --payload-file - --json'
  },
  'maestro author': {
    schema: z.toJSONSchema(MaestroDocumentAuthoringMutationSchema, JSON_SCHEMA_OPTIONS),
    requiredCapabilities: [MAESTRO_RUNTIME_CAPABILITY],
    preconditions: ['The current projection anchor authorizes the document mutation.'],
    stdinExample: 'orca maestro author --payload-file - --json'
  },
  'maestro projection apply': {
    schema: z.toJSONSchema(MaestroProjectionApplyParamsSchema, JSON_SCHEMA_OPTIONS),
    requiredCapabilities: [MAESTRO_RUNTIME_CAPABILITY],
    preconditions: ['Only the current coordinator may publish a validated projection revision.'],
    stdinExample: 'orca maestro projection apply --payload-file - --json'
  },
  'maestro bootstrap': {
    schema: z.toJSONSchema(MaestroBootstrapRequestSchema, JSON_SCHEMA_OPTIONS),
    requiredCapabilities: [MAESTRO_COMPOSED_BOOTSTRAP_RUNTIME_CAPABILITY],
    preconditions: [
      'Use the exact execution host, public workspaceKey, active Run, and coordinator generation.'
    ],
    stdinExample: [
      "orca maestro bootstrap --payload-file - --json <<'JSON'",
      '{"schema_version":1,"protocol":"maestro-bootstrap/v1","mutation":{"mutation_id":"mutation_1","execution_host_id":"local","workspace_key":"folder:workspace_1","run_id":"run_1"},"coordinator_generation":1}',
      'JSON'
    ].join('\n')
  }
} as const

export type MaestroAgentPayloadContracts = typeof MAESTRO_AGENT_PAYLOAD_CONTRACTS
