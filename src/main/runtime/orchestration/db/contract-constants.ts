import { ORCHESTRATION_LEGACY_RUN_ID } from '../../../../shared/orchestration-rpc-contract'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'

export const LEGACY_RUN_ID = ORCHESTRATION_LEGACY_RUN_ID

export const LEGACY_CONTRACT_VERSION = 0
export const CURRENT_CONTRACT_VERSION = ORCHESTRATION_CONTRACT_VERSION

// Upstream v31-v38 retain their published meanings; Maestro migrations continue at v39-v44.
export const SCHEMA_VERSION = 44
