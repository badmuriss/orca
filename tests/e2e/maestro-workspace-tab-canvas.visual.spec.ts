import { rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test as base } from './helpers/orca-app'
import type { Locator, Page } from '@stablyai/playwright-test'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { publishAuthenticatedHarness } from './fixtures/maestro-workspace-tab-canvas/coordinator-bridge'
import {
  PROFILES,
  capture,
  createAnnotation,
  openMaestro,
  prepareEvidence,
  removeWorkspaceResources,
  setTheme,
  startProofPage,
  stopProofPage
} from './fixtures/maestro-workspace-tab-canvas/evidence'

const FAULT_FILE = path.join(os.tmpdir(), `orca-mwc-visual-fault-${process.pid}`)
const test = base.extend({
  orcaAppExtraEnv: {
    ORCA_E2E_MWC_QUERY_DELAY_MS: '1200',
    ORCA_E2E_MWC_AUTHORITY_FAULT_FILE: FAULT_FILE
  }
})

async function surfaceForContentType(page: Page, contentType: string) {
  const surfaces = page.locator('[data-maestro-workspace-surface]')
  const index = await surfaces.evaluateAll((nodes, requestedType) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabs = worktreeId ? (state?.unifiedTabsByWorktree[worktreeId] ?? []) : []
    return nodes.findIndex((node) => {
      const key = node.getAttribute('data-maestro-workspace-surface')
      const tabId = key ? (JSON.parse(key) as [string, string, string])[2] : null
      return tabs.some((tab) => tab.id === tabId && tab.contentType === requestedType)
    })
  }, contentType)
  expect(index).toBeGreaterThanOrEqual(0)
  return surfaces.nth(index)
}

async function expectInsideCanvas(page: Page, surface: Locator) {
  const [canvas, window] = await Promise.all([
    page.locator('[data-maestro-workspace-canvas]').boundingBox(),
    surface.boundingBox()
  ])
  expect(canvas).not.toBeNull()
  expect(window).not.toBeNull()
  if (!canvas || !window) {
    throw new Error('Canvas reveal geometry is unavailable')
  }
  expect(window.x).toBeGreaterThanOrEqual(canvas.x)
  expect(window.y).toBeGreaterThanOrEqual(canvas.y + 48)
  expect(window.x + window.width).toBeLessThanOrEqual(canvas.x + canvas.width)
  expect(window.y + window.height).toBeLessThanOrEqual(canvas.y + canvas.height)
}

async function waitForExactBrowserTab(page: Page, surface: Locator) {
  const surfaceKey = await surface.getAttribute('data-maestro-workspace-surface')
  const unifiedTabId = surfaceKey ? (JSON.parse(surfaceKey) as [string, string, string])[2] : null
  expect(unifiedTabId).toBeTruthy()
  await expect
    .poll(() =>
      page.evaluate((tabId) => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        const unifiedTab = worktreeId
          ? state?.unifiedTabsByWorktree[worktreeId]?.find(
              (tab) => tab.id === tabId && tab.contentType === 'browser'
            )
          : null
        return (
          state?.activeTabType === 'browser' &&
          Boolean(unifiedTab) &&
          state.activeBrowserTabIdByWorktree?.[worktreeId ?? ''] === unifiedTab?.entityId
        )
      }, unifiedTabId)
    )
    .toBe(true)
}

async function setEvidenceProfile(page: Page, profile: (typeof PROFILES)[number]) {
  await page.setViewportSize({ width: profile.width, height: profile.height })
  await expect
    .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width: profile.width, height: profile.height })
}

async function canvasRevision(
  client: RuntimeClient,
  scope: { host: string; workspace: string }
): Promise<number | null> {
  const response = await client.call<{
    status: string
    canvas?: { revision: number }
  }>('maestro.workspaceCanvas.get', {
    execution_host_id: scope.host,
    workspace_key: scope.workspace
  })
  return response.result.status === 'available' ? (response.result.canvas?.revision ?? null) : null
}

async function fitAndWaitForAuthority(
  page: Page,
  client: RuntimeClient,
  scope: { host: string; workspace: string }
) {
  const before = await canvasRevision(client, scope)
  expect(before).not.toBeNull()
  await page.getByLabel('Zoom in').click()
  await page.getByLabel('Fit resources').click()
  await expect.poll(() => canvasRevision(client, scope)).toBeGreaterThan(before ?? -1)
}

test.describe('Maestro workspace Canvas visual refinement', () => {
  test('@mwc-visual-refinement-composite captures the bounded responsive refinement', async ({
    orcaPage,
    testRepoPath,
    electronApp
  }) => {
    test.setTimeout(600_000)
    prepareEvidence(FAULT_FILE)
    const proof = await startProofPage()
    let cleanupHarness = async (): Promise<void> => {}
    try {
      const desktop = PROFILES[0]
      const notebook = PROFILES[1]
      await setEvidenceProfile(orcaPage, notebook)
      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      const scope = await openMaestro(orcaPage, true)
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const runtimeClient = new RuntimeClient(userDataDir, 30_000, null, null)
      await removeWorkspaceResources(orcaPage)

      await orcaPage.getByRole('button', { name: 'Terminal', exact: true }).click()
      const surfaces = orcaPage.locator('[data-maestro-workspace-surface]')
      await expect(surfaces).toHaveCount(1, { timeout: 30_000 })
      const terminal = surfaces.first()
      await terminal.locator('header').click()
      const inspector = orcaPage.locator('aside').filter({
        has: orcaPage.getByLabel('Tab title')
      })
      await expect(inspector).toBeVisible()
      await expectInsideCanvas(orcaPage, terminal)
      const [terminalBox, inspectorBox] = await Promise.all([
        terminal.boundingBox(),
        inspector.boundingBox()
      ])
      expect(terminalBox).not.toBeNull()
      expect(inspectorBox).not.toBeNull()
      expect(
        terminalBox !== null &&
          inspectorBox !== null &&
          terminalBox.x < inspectorBox.x + inspectorBox.width &&
          terminalBox.x + terminalBox.width > inspectorBox.x &&
          terminalBox.y < inspectorBox.y + inspectorBox.height &&
          terminalBox.y + terminalBox.height > inspectorBox.y
      ).toBe(false)
      await setTheme(orcaPage, 'dark')
      await capture(orcaPage, 'terminal-focused', notebook)
      await inspector.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click')
      await expect(inspector).toBeHidden()

      await setTheme(orcaPage, 'light')
      await orcaPage.getByRole('button', { name: 'Browser', exact: true }).click()
      await expect(surfaces).toHaveCount(2, { timeout: 30_000 })
      const browser = await surfaceForContentType(orcaPage, 'browser')
      await expectInsideCanvas(orcaPage, browser)
      await browser.getByRole('button', { name: 'Focus exact tab' }).click()
      await waitForExactBrowserTab(orcaPage, browser)
      const addressBar = orcaPage.locator('[data-orca-browser-address-bar="true"]')
      await expect(addressBar).toBeVisible()
      await addressBar.fill(proof.url)
      await expect(addressBar).toHaveValue(proof.url)
      await addressBar.press('Enter')
      await expect
        .poll(
          () =>
            orcaPage.evaluate(async () => {
              const webview = document.querySelector('webview') as Electron.WebviewTag | null
              return webview
                ? await webview.executeJavaScript('document.querySelector("h1")?.textContent')
                : null
            }),
          { timeout: 30_000 }
        )
        .toBe('MWC exact Browser page')
      const browserPageId = await orcaPage.evaluate((url) => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        return worktreeId
          ? state?.browserTabsByWorktree[worktreeId]?.find((tab) => tab.url === url)?.activePageId
          : null
      }, proof.url)
      if (!browserPageId) {
        throw new Error('Exact Browser page identity was not found')
      }
      await openMaestro(orcaPage, true)
      const projectedBrowser = await surfaceForContentType(orcaPage, 'browser')
      await expect(projectedBrowser.locator('img[data-browser-page-id]')).toBeVisible({
        timeout: 30_000
      })
      await expectInsideCanvas(orcaPage, projectedBrowser)
      await capture(orcaPage, 'browser-rendered', notebook)

      const contentPath = path.join(testRepoPath, 'MWC-EVIDENCE.md')
      writeFileSync(
        contentPath,
        '# Exact editor content\n\nWorkspace-owned recognizable content.\n'
      )
      await orcaPage.getByRole('button', { name: 'Refresh Explorer' }).click()
      await orcaPage.getByText('MWC-EVIDENCE.md', { exact: true }).dblclick()
      await expect(orcaPage.getByText('Exact editor content', { exact: false })).toBeVisible()
      await openMaestro(orcaPage, true)
      const content = await surfaceForContentType(orcaPage, 'editor')
      await expect(content).toContainText('Workspace-owned recognizable content.', {
        timeout: 30_000
      })
      await expectInsideCanvas(orcaPage, content)
      await setTheme(orcaPage, 'dark')
      await capture(orcaPage, 'content-rendered', notebook)

      await createAnnotation(orcaPage, 'decision', 'Decision: preserve exact workspace tabs')
      await createAnnotation(orcaPage, 'warning', 'Warning: receipt identity must remain exact')
      await createAnnotation(orcaPage, 'blocked', 'Blocked: authority conflict requires retry')
      await createAnnotation(orcaPage, 'observation', 'Observation: exact surfaces remain live')
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await setTheme(orcaPage, 'light')
      await capture(orcaPage, 'annotation-tones', notebook)

      const linkSource = await surfaceForContentType(orcaPage, 'browser')
      const linkTarget = await surfaceForContentType(orcaPage, 'terminal')
      await linkSource.locator('header').click()
      await inspector.getByRole('button', { name: 'Link from this surface' }).click()
      const exactLinkTarget = linkTarget.getByRole('button', { name: 'Link to this surface' })
      await expect(exactLinkTarget).toBeVisible()
      await exactLinkTarget.click()
      await expect(orcaPage.locator('[data-link-provenance="manual"]')).toHaveCount(1, {
        timeout: 30_000
      })
      await inspector.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click')
      await expect(inspector).toBeHidden()
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await expect(orcaPage.locator('[data-link-provenance="manual"] text')).toHaveText('Manual')
      await capture(orcaPage, 'links-manual', notebook)
      await setEvidenceProfile(orcaPage, desktop)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await capture(orcaPage, 'links-manual', desktop)
      await setEvidenceProfile(orcaPage, notebook)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)

      const harness = await publishAuthenticatedHarness({
        page: orcaPage,
        userDataDir,
        scope,
        browserPageId,
        browserUrl: proof.url
      })
      cleanupHarness = harness.cleanup
      await openMaestro(orcaPage, true)
      await expect(orcaPage.locator('[data-link-provenance="automatic"]')).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.getByLabel('Fit resources').click()
      const refreshedBrowser = await surfaceForContentType(orcaPage, 'browser')
      await refreshedBrowser.locator('header').click()
      const suggestions = inspector.locator('.rounded-md').filter({ hasText: 'Suggestion' })
      const suggestionCount = await suggestions.count()
      expect(suggestionCount).toBeGreaterThanOrEqual(2)
      await suggestions.first().getByRole('button', { name: 'Accept' }).click()
      await expect(suggestions).toHaveCount(suggestionCount - 1)
      await suggestions.first().getByRole('button', { name: 'Hide' }).click()
      await expect(suggestions).toHaveCount(suggestionCount - 2)
      await inspector.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click')
      await expect(inspector).toBeHidden()
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await capture(orcaPage, 'links-automatic-suggested', notebook)
      await setEvidenceProfile(orcaPage, desktop)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await capture(orcaPage, 'links-automatic-suggested', desktop)
      await setEvidenceProfile(orcaPage, notebook)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)

      const progress = orcaPage.getByRole('complementary', {
        name: new RegExp(`Harness run ${harness.runId}`)
      })
      await expect(progress).toContainText('MWC-BLOCKED')
      await capture(orcaPage, 'progress-all-states', notebook)
      await setEvidenceProfile(orcaPage, desktop)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)
      await capture(orcaPage, 'progress-all-states', desktop)
      await setEvidenceProfile(orcaPage, notebook)
      await fitAndWaitForAuthority(orcaPage, runtimeClient, scope)

      writeFileSync(FAULT_FILE, 'unavailable')
      await expect(
        orcaPage.getByText('Authority unavailable. Last-known resources remain unverifiable.')
      ).toBeVisible({ timeout: 30_000 })
      await setTheme(orcaPage, 'dark')
      await capture(orcaPage, 'unavailable', notebook)
      await setEvidenceProfile(orcaPage, desktop)
      await capture(orcaPage, 'unavailable', desktop)
    } finally {
      await cleanupHarness()
      rmSync(FAULT_FILE, { force: true })
      await stopProofPage(proof.server)
    }
  })
})
