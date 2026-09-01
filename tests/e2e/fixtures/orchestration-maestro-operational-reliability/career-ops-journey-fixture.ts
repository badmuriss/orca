import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exerciseLaunchContracts } from './launch-contract-fixture'
import { exerciseSessionTransferAndRestart } from './session-transfer-fixture'
import { verifyCareerOpsVisualEvidence } from './visual-evidence-fixture'
import { exerciseWorkflowReviewAndMobile } from './workflow-review-fixture'

export async function exerciseCareerOpsJourney() {
  const root = mkdtempSync(join(tmpdir(), 'orca-omr-journey-'))
  try {
    return {
      launch: exerciseLaunchContracts(),
      session: exerciseSessionTransferAndRestart(root),
      workflow: await exerciseWorkflowReviewAndMobile(),
      visualEvidenceCount: verifyCareerOpsVisualEvidence()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
