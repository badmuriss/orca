import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type VisualManifest = {
  reviewed_with: string
  results: { browser: string; screenshot: string; sha256: string; status: string }[]
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifyVisualManifest(path: string, browser: string): number {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as VisualManifest
  if (manifest.reviewed_with !== 'view_image' || manifest.results.length !== 4) {
    throw new Error(`Visual evidence manifest is incomplete: ${path}`)
  }
  for (const result of manifest.results) {
    const screenshot = resolve(result.screenshot)
    if (
      result.status !== 'pass' ||
      result.browser !== browser ||
      !existsSync(screenshot) ||
      sha256(screenshot) !== result.sha256
    ) {
      throw new Error(`Visual evidence is stale or unreviewed: ${result.screenshot}`)
    }
  }
  return manifest.results.length
}

export function verifyCareerOpsVisualEvidence(): number {
  return (
    verifyVisualManifest(
      resolve('.visual-evidence/orchestration-maestro-operational-reliability/manifest.json'),
      'chromium'
    ) +
    verifyVisualManifest(
      resolve(
        '.visual-evidence/orchestration-maestro-operational-reliability/mobile-manifest.json'
      ),
      'webkit'
    )
  )
}
