import { expect, test } from '@playwright/test'
import { exerciseCareerOpsJourney } from './fixtures/orchestration-maestro-operational-reliability/career-ops-journey-fixture'
import { exerciseSettledChildWorktreeCleanup } from './fixtures/orchestration-maestro-operational-reliability/run-cleanup-fixture'

test('proves the bounded Career Ops lifecycle and exact Run cleanup', async (// oxlint-disable-next-line no-empty-pattern -- The real desktop/mobile surfaces are represented by their vision-reviewed manifests, so this contract fixture reuses the active runtimes.
{}) => {
  const journey = await exerciseCareerOpsJourney()
  const result = await exerciseSettledChildWorktreeCleanup()

  expect(journey).toMatchObject({
    launch: {
      discovery: { requestedId: 'opencode', resolvedId: 'opencode', executable: 'opencode' },
      pendingReadiness: 'pending',
      composerReady: true,
      readinessUnverifiable: true,
      replacementAgent: 'opencode',
      replacementAttempt: 'replacement-dispatch-launch',
      recoveryCommand: expect.stringContaining('replace-worker --task task-launch')
    },
    session: {
      leaseTransferred: true,
      activeRead: ['successor output'],
      predecessorRead: ['predecessor output'],
      restartPreserved: true,
      restartedRead: ['successor output']
    },
    workflow: {
      deliverablesPercent: 100,
      reliability: { successful: 1, failed: 0, superseded: 1, unverifiable: 1 },
      runLabel: 'Career Ops application run',
      projectionRevision: 7,
      browserIdentityStable: true,
      browserUrlSanitized: true,
      consentRevoked: true,
      reviewStates: ['needs_input', 'approved_for_submit', 'submitted'],
      exactMobileTab: 'tab-browser-career-ops',
      mixedVersionState: 'unavailable'
    },
    visualEvidenceCount: 8
  })
  expect(result).toEqual({
    selectedWorktreeCount: 1,
    firstDisposition: 'removed',
    replayDisposition: 'already_absent',
    childAbsent: true,
    branchPreserved: true
  })
})
