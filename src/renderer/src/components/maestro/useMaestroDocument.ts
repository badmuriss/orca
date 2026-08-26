import { useCallback, useEffect, useState } from 'react'
import type { MaestroDocument, MaestroDocumentReadScope } from '../../../../shared/maestro-contract'
import { getMaestroDocument } from '@/runtime/runtime-maestro-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { MaestroAuthoringDocument } from './maestro-canvas-view-model'

export type MaestroDocumentState =
  | { state: 'loading'; revision: null; document: null; errorCode: null }
  | { state: 'empty'; revision: null; document: null; errorCode: null }
  | { state: 'ready'; revision: number; document: MaestroDocument; errorCode: null }
  | { state: 'unavailable'; revision: null; document: null; errorCode: string | null }

export const MAESTRO_DOCUMENT_RETRY_DELAY_MS = 50

const loadingState: MaestroDocumentState = {
  state: 'loading',
  revision: null,
  document: null,
  errorCode: null
}

function isTransientLocalWorkspacePublicationRace(
  target: RuntimeClientTarget,
  error: unknown
): error is RuntimeRpcCallError {
  return (
    target.kind === 'local' && error instanceof RuntimeRpcCallError && error.code === 'unauthorized'
  )
}

async function readMaestroDocumentWithRecovery(
  target: RuntimeClientTarget,
  scope: MaestroDocumentReadScope
): Promise<MaestroDocumentState> {
  try {
    const response = await getMaestroDocument(target, scope)
    return response.state === 'empty'
      ? { state: 'empty', revision: null, document: null, errorCode: null }
      : {
          state: 'ready',
          revision: response.revision,
          document: response.document,
          errorCode: null
        }
  } catch (error) {
    if (!isTransientLocalWorkspacePublicationRace(target, error)) {
      throw error
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, MAESTRO_DOCUMENT_RETRY_DELAY_MS)
    })
    const response = await getMaestroDocument(target, scope)
    return response.state === 'empty'
      ? { state: 'empty', revision: null, document: null, errorCode: null }
      : {
          state: 'ready',
          revision: response.revision,
          document: response.document,
          errorCode: null
        }
  }
}

export type MaestroDocumentResource = MaestroDocumentState & {
  reload: () => void
  authoringDocument: MaestroAuthoringDocument | null
}

export function useMaestroDocument(
  target: RuntimeClientTarget | null,
  scope: MaestroDocumentReadScope | null
): MaestroDocumentResource {
  const [reloadToken, setReloadToken] = useState(0)
  const [result, setResult] = useState<MaestroDocumentState>(loadingState)
  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    if (!target || !scope) {
      setResult({ state: 'unavailable', revision: null, document: null, errorCode: null })
      return
    }
    let active = true
    setResult(loadingState)
    void readMaestroDocumentWithRecovery(target, scope)
      .then((nextState) => {
        if (active) {
          setResult(nextState)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const errorCode = error instanceof RuntimeRpcCallError ? error.code : null
          setResult({ state: 'unavailable', revision: null, document: null, errorCode })
        }
      })
    return () => {
      active = false
    }
  }, [reloadToken, scope, target])

  return {
    ...result,
    reload,
    authoringDocument: result.document
  }
}
