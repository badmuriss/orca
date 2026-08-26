import { describe, expect, it } from 'vitest'
import {
  AUTHORIZED_MANIFEST_DIGEST,
  REQUIRED_CAPABILITIES,
  verifyHarnessMaestroCompatibilityManifest
} from './harness-maestro-compatibility-manifest'

const manifestPath = `tests/fixtures/harness-maestro-compatibility/sha256/${AUTHORIZED_MANIFEST_DIGEST.slice(7)}/manifest.json`

describe('Harness Maestro compatibility manifest', () => {
  it('pins the complete MLK-13 v1 exporter bundle', () => {
    expect(REQUIRED_CAPABILITIES).toHaveLength(8)
    expect(verifyHarnessMaestroCompatibilityManifest(manifestPath)).toEqual({
      accepted: true,
      manifestDigest: AUTHORIZED_MANIFEST_DIGEST
    })
  })
})
