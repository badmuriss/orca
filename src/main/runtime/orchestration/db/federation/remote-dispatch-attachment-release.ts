import type { OrchestrationDb } from '../orchestration-db'

export const REMOTE_ATTACHMENT_RELEASE_STAGES = {
  pending: 'release_pending',
  completed: 'release_completed'
} as const

export type RemoteAttachmentReleaseStage =
  (typeof REMOTE_ATTACHMENT_RELEASE_STAGES)[keyof typeof REMOTE_ATTACHMENT_RELEASE_STAGES]

/**
 * The stage recorder is a prototype method bound to the whole database, so a structural
 * Pick cannot satisfy its `this`; both callers already hold the real OrchestrationDb.
 */
export function recordRemoteAttachmentReleaseStage(
  db: OrchestrationDb,
  params: { dispatchId: string; stage: RemoteAttachmentReleaseStage; lastError: string }
): void {
  db.recordRemoteAttachmentStage(params)
}
