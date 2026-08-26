import type { MaestroBrowserSurfaceReceipt } from '../../../../shared/maestro-browser-surface'

export type MaestroBrowserSurfaceViewModel = {
  title: string
  origin: string
  stateLabel: string
  visibilityLabel: string
  observedVisibilityLabel: string
  ownerLabel: string
  captureLabel: string
  captureDetail: string
  canFocus: boolean
  canPreview: boolean
  unavailable: boolean
}

const STATE_LABELS: Record<MaestroBrowserSurfaceReceipt['state'], string> = {
  reserved: 'Reserved',
  creating: 'Creating',
  active: 'Active',
  retained: 'Retained',
  release_pending: 'Release pending',
  released: 'Released',
  outcome_unknown: 'Outcome unknown',
  unavailable: 'Unavailable'
}

// `unavailable` / `unverifiable` never say "observed": nothing was observed.
const OBSERVED_VISIBILITY_LABELS: Record<
  MaestroBrowserSurfaceReceipt['observed_visibility'],
  string
> = {
  visible: 'Visible observed',
  offscreen: 'Offscreen observed',
  hidden: 'Hidden observed',
  unavailable: 'Unavailable',
  unverifiable: 'Unverifiable'
}

function visibilityLabel(receipt: MaestroBrowserSurfaceReceipt): string {
  const requested =
    receipt.requested_visibility === 'visible' ? 'Visible requested' : 'Offscreen requested'
  return `${requested} · ${OBSERVED_VISIBILITY_LABELS[receipt.observed_visibility].toLowerCase()}`
}

function captureLabel(receipt: MaestroBrowserSurfaceReceipt): string {
  const evidence = receipt.evidence_receipt
  if (!evidence) {
    return 'No capture attached'
  }
  const date = new Date(evidence.captured_at)
  return Number.isNaN(date.getTime())
    ? 'Capture time unavailable'
    : `Captured ${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)}`
}

export function maestroBrowserSurfaceViewModel(
  receipt: MaestroBrowserSurfaceReceipt
): MaestroBrowserSurfaceViewModel {
  const evidence = receipt.evidence_receipt
  const unavailable =
    receipt.state === 'unavailable' ||
    receipt.state === 'outcome_unknown' ||
    receipt.observed_visibility === 'unavailable' ||
    receipt.observed_visibility === 'unverifiable'
  return {
    title: receipt.title,
    origin: receipt.origin,
    stateLabel: STATE_LABELS[receipt.state],
    visibilityLabel: visibilityLabel(receipt),
    observedVisibilityLabel: OBSERVED_VISIBILITY_LABELS[receipt.observed_visibility],
    ownerLabel: `${receipt.task_id} · ${receipt.agent_id} · ${receipt.ownership}`,
    captureLabel: captureLabel(receipt),
    captureDetail: evidence
      ? `${evidence.dimensions.width}×${evidence.dimensions.height} @ ${evidence.dimensions.device_scale_factor}x · ${evidence.artifact_hash}`
      : 'Capture provenance is unavailable.',
    canFocus:
      Boolean(receipt.browser_page_id) &&
      receipt.state !== 'released' &&
      receipt.observed_visibility !== 'unavailable' &&
      receipt.observed_visibility !== 'unverifiable',
    canPreview: Boolean(evidence) && receipt.state !== 'released',
    unavailable
  }
}
