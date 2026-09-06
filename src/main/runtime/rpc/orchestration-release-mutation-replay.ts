import type { OrcaRuntimeService } from '../orca-runtime'

// Why: worker release is idempotent on both paths — it can answer already_released —
// so an interrupted release resumes rather than reporting an unknown outcome. Only the
// federated flavour needs a dispatch to route by; a local release resumes on its own.
export function isResumableRelease(method: string): boolean {
  return method === 'orchestration.federationRelease' || method === 'orchestration.workerRelease'
}

export function isRetryableFederatedRelease(
  method: string,
  params: unknown,
  db: ReturnType<OrcaRuntimeService['getOrchestrationDb']>
): boolean {
  if (method === 'orchestration.federationRelease') {
    return true
  }
  if (method !== 'orchestration.workerRelease') {
    return false
  }
  return (
    typeof params === 'object' &&
    params !== null &&
    typeof (params as { dispatch?: unknown }).dispatch === 'string' &&
    Boolean(db.getFederatedDispatch((params as { dispatch: string }).dispatch))
  )
}

export function isRetryableFederatedReleaseResult(
  retryableFederatedRelease: boolean,
  result: unknown
): boolean {
  if (!retryableFederatedRelease || !result || typeof result !== 'object') {
    return false
  }
  return (result as { state?: unknown }).state === 'unverifiable'
}

export function attestFederatedReleaseReplay(
  method: string,
  receipt: unknown,
  servingRuntimeEpoch: string
): unknown {
  if (
    method !== 'orchestration.federationRelease' ||
    !receipt ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt)
  ) {
    return receipt
  }
  return { ...(receipt as Record<string, unknown>), servingRuntimeEpoch }
}
