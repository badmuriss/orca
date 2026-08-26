import { describe, expect, it, vi } from 'vitest'
import { MaestroBrowserSurfaceReceiptSchema } from '../../../../shared/maestro-browser-surface'
import { browserSurfaceReceipt } from '../../../../shared/maestro-browser-surface.test'
import {
  ensureMaestroBrowserSurface,
  ORCHESTRATION_BROWSER_SURFACE_METHODS
} from './orchestration-browser-surface'

// The runtime reports the raw worktree id; the Maestro anchor carries the prefixed workspace key.
const WORKTREE_ID = 'repo-1::/repos/orca-wt'
const WORKSPACE_KEY = `worktree:${WORKTREE_ID}`

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/orca-browser-surface-test' },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 1920, height: 1080 }) }) }
}))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined)
}))

vi.mock('../maestro-principal', () => ({
  resolveMaestroPrincipal: async (_context: unknown, workspace: unknown) => ({
    actor_id: 'coordinator-1',
    kind: 'coordinator',
    authenticated: true,
    session_id: 'session-1',
    workspace,
    generation: 1
  })
}))

/** A surface that settled unavailable because its paint was never observed. */
function unobservedSurfaceReceipt() {
  return {
    ...browserSurfaceReceipt(),
    workspace_key: WORKSPACE_KEY,
    state: 'unavailable',
    observed_visibility: 'unverifiable',
    evidence_receipt: null,
    focus_receipt: {
      requested: true,
      workspace_activated: true,
      exact_page_selected: false,
      native_pane_paint: 'unobserved',
      observed_at: null,
      unavailable_reason: 'The exact native Browser pane has not been observed for paint yet.'
    }
  }
}

function actionRequest(surfaceId: string) {
  return {
    schema_version: 1 as const,
    protocol: 'maestro-browser-surface/v1' as const,
    workspace: {
      repository_id: 'repo-1',
      execution_host_id: 'local',
      workspace_key: WORKSPACE_KEY,
      run_id: 'run-1'
    },
    actor: {
      actor_id: 'forged',
      kind: 'user' as const,
      authenticated: true,
      session_id: 'forged'
    },
    coordinator_generation: 1,
    surface_id: surfaceId
  }
}

function method(name: string) {
  const found = ORCHESTRATION_BROWSER_SURFACE_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing browser surface RPC method: ${name}`)
  }
  return found
}

describe('orchestration browser surface RPC', () => {
  it('selects and identifies the exact page by worktree id, not by workspace key', async () => {
    // Regression: `id:${workspace_key}` emitted `id:worktree:<id>`, which resolved to nothing, and
    // the identity gate compared the tab's raw worktree id against the prefixed workspace key,
    // which can never match.
    const receipt = { ...browserSurfaceReceipt(), workspace_key: WORKSPACE_KEY }
    const activateManagedWorktree = vi.fn().mockResolvedValue({ activated: true })
    const browserTabSwitch = vi.fn().mockResolvedValue({ browserPageId: receipt.browser_page_id })
    const browserTabShow = vi.fn().mockResolvedValue({
      tab: {
        browserPageId: receipt.browser_page_id,
        worktreeId: WORKTREE_ID,
        profileId: receipt.profile_id,
        active: true
      }
    })
    const updateMaestroBrowserSurface = vi.fn(
      (_surfaceId: string, update: (current: typeof receipt) => typeof receipt) => ({
        receipt: update(receipt)
      })
    )
    const runtime = {
      getOrchestrationDb: () => ({
        getMaestroBrowserSurface: () => ({ receipt }),
        updateMaestroBrowserSurface
      }),
      activateManagedWorktree,
      browserTabSwitch,
      browserTabShow
    }
    const request = {
      schema_version: 1 as const,
      protocol: 'maestro-browser-surface/v1' as const,
      workspace: {
        repository_id: 'repo-1',
        execution_host_id: 'local',
        workspace_key: WORKSPACE_KEY,
        run_id: 'run-1'
      },
      actor: {
        actor_id: 'forged',
        kind: 'user' as const,
        authenticated: true,
        session_id: 'forged'
      },
      coordinator_generation: 1,
      surface_id: receipt.surface_id
    }

    const result = await method('orchestration.browserSurface.focus').handler(request, {
      runtime
    } as never)

    expect(activateManagedWorktree).toHaveBeenCalledWith(`id:${WORKTREE_ID}`, {
      navigation: 'host'
    })
    expect(browserTabSwitch).toHaveBeenCalledWith({
      page: 'maestro-request-1',
      worktree: `id:${WORKTREE_ID}`,
      focus: true
    })
    expect(browserTabShow).toHaveBeenCalledWith({
      page: 'maestro-request-1',
      worktree: `id:${WORKTREE_ID}`
    })
    expect(result).toMatchObject({
      requested_visibility: 'visible',
      observed_visibility: 'visible',
      focus_receipt: { exact_page_selected: true, native_pane_paint: 'painted' }
    })
  })

  it('passes the ensure identity gate when the tab reports its raw worktree id', async () => {
    const receipt = { ...browserSurfaceReceipt(), workspace_key: WORKSPACE_KEY, state: 'reserved' }
    const browserTabShow = vi.fn().mockResolvedValue({
      tab: {
        browserPageId: receipt.browser_page_id,
        worktreeId: WORKTREE_ID,
        profileId: receipt.profile_id,
        active: true
      }
    })
    const runtime = {
      getOrchestrationDb: () => ({
        reserveMaestroBrowserSurface: () => ({ receipt }),
        updateMaestroBrowserSurface: (
          _surfaceId: string,
          update: (current: typeof receipt) => typeof receipt
        ) => ({ receipt: update(receipt) })
      }),
      activateManagedWorktree: vi.fn().mockResolvedValue({ activated: true }),
      browserTabSwitch: vi.fn().mockResolvedValue({ browserPageId: receipt.browser_page_id }),
      browserTabShow
    }
    const request = {
      workspace: { workspace_key: WORKSPACE_KEY },
      ownership: 'harness',
      requested_visibility: 'visible',
      profile_id: receipt.profile_id
    }

    // No paint evidence, so this settles as unavailable — reaching that verdict at all proves the
    // identity gate accepted the raw worktree id instead of throwing identity_mismatch.
    const result = await ensureMaestroBrowserSurface(request as never, { runtime } as never)

    expect(browserTabShow).toHaveBeenCalledWith({
      page: receipt.browser_page_id,
      worktree: `id:${WORKTREE_ID}`
    })
    expect(result).toMatchObject({ state: 'unavailable', observed_visibility: 'unverifiable' })
  })

  it('upgrades an unobserved paint verdict when focus genuinely observes the pane', async () => {
    const unobservedReceipt = unobservedSurfaceReceipt()
    const browserTabShow = vi.fn().mockResolvedValue({
      tab: {
        browserPageId: unobservedReceipt.browser_page_id,
        worktreeId: WORKTREE_ID,
        profileId: unobservedReceipt.profile_id,
        active: true
      }
    })
    const runtime = {
      getOrchestrationDb: () => ({
        getMaestroBrowserSurface: () => ({ receipt: unobservedReceipt }),
        updateMaestroBrowserSurface: (
          _surfaceId: string,
          update: (current: typeof unobservedReceipt) => typeof unobservedReceipt
        ) => ({ receipt: update(unobservedReceipt) })
      }),
      activateManagedWorktree: vi.fn().mockResolvedValue({ activated: true }),
      browserTabSwitch: vi.fn().mockResolvedValue({
        switched: 0,
        browserPageId: unobservedReceipt.browser_page_id,
        focusReceipt: {
          requested: true,
          exactPageSelected: true,
          nativePanePaint: 'painted',
          observedAt: '2026-08-25T12:00:00.000Z'
        }
      }),
      browserTabShow
    }

    const result = await method('orchestration.browserSurface.focus').handler(
      actionRequest(unobservedReceipt.surface_id),
      { runtime } as never
    )

    expect(result).toMatchObject({
      observed_visibility: 'visible',
      focus_receipt: {
        native_pane_paint: 'painted',
        observed_at: '2026-08-25T12:00:00.000Z',
        unavailable_reason: null
      }
    })
  })

  it('recovers an unavailable surface from a successful native capture and keeps its retention', async () => {
    const unobservedReceipt = unobservedSurfaceReceipt()
    const capturingRuntime = (receipt: typeof unobservedReceipt) => ({
      getOrchestrationDb: () => ({
        getMaestroBrowserSurface: () => ({ receipt }),
        updateMaestroBrowserSurface: (
          _surfaceId: string,
          update: (current: typeof receipt) => typeof receipt
        ) => ({ receipt: update(receipt) })
      }),
      browserTabShow: vi.fn().mockResolvedValue({
        tab: {
          browserPageId: receipt.browser_page_id,
          worktreeId: WORKTREE_ID,
          profileId: receipt.profile_id,
          active: true
        }
      }),
      browserScreenshot: vi.fn().mockResolvedValue({ data: 'Zm9v', format: 'png' })
    })

    // Parsing narrows the handler's `unknown` honestly, and proves the recovered receipt is valid.
    const result = MaestroBrowserSurfaceReceiptSchema.parse(
      await method('orchestration.browserSurface.capture').handler(
        actionRequest(unobservedReceipt.surface_id),
        { runtime: capturingRuntime(unobservedReceipt) } as never
      )
    )

    expect(result).toMatchObject({
      state: 'active',
      observed_visibility: 'visible',
      focus_receipt: {
        exact_page_selected: true,
        native_pane_paint: 'painted',
        unavailable_reason: null
      },
      evidence_receipt: {
        protocol: 'maestro-browser-evidence/v1',
        format: 'png',
        route_or_component: 'Maestro browser surface',
        capture_mode: 'native-viewport',
        dimensions: { width: 1920, height: 1080 }
      }
    })
    expect(result.focus_receipt.observed_at).toEqual(expect.any(String))

    const retained = await method('orchestration.browserSurface.capture').handler(
      actionRequest(unobservedReceipt.surface_id),
      { runtime: capturingRuntime({ ...unobservedReceipt, retention: 'retain' }) } as never
    )

    expect(retained).toMatchObject({ state: 'retained' })
  })
})
