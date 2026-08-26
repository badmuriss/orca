import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

const MAX_WATCH_EVENTS = 128

function parsePayload(flags: Map<string, string | boolean>): Record<string, unknown> {
  const raw = getRequiredStringFlag(flags, 'payload')
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not_an_object')
    }
    return value as Record<string, unknown>
  } catch {
    throw new RuntimeClientError('invalid_argument', 'Expected --payload to be a JSON object.')
  }
}

async function printCall(
  handler: Parameters<CommandHandler>[0],
  method: string,
  params: Record<string, unknown>
): Promise<void> {
  const result = await handler.client.call(method, params)
  printResult(result, handler.json, (value) => JSON.stringify(value, null, 2))
}

function watchEvent(
  value: unknown
): Record<string, unknown> & { revision: number; resetRequired: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RuntimeClientError(
      'invalid_receipt',
      'Maestro watch returned an invalid progress receipt.'
    )
  }
  const receipt = value as Record<string, unknown>
  if (typeof receipt.revision !== 'number' || typeof receipt.resetRequired !== 'boolean') {
    throw new RuntimeClientError(
      'invalid_receipt',
      'Maestro watch returned an invalid cursor receipt.'
    )
  }
  return { ...receipt, revision: receipt.revision, resetRequired: receipt.resetRequired }
}

async function emitNdjson(
  value: Record<string, unknown>,
  interrupted: Promise<void>
): Promise<void> {
  if (process.stdout.write(`${JSON.stringify(value)}\n`)) {
    return
  }
  await Promise.race([
    new Promise<void>((resolve) => process.stdout.once('drain', resolve)),
    interrupted
  ])
}

const payloadMethodHandlers: Record<string, string> = {
  'maestro apply': 'maestro.mutation.apply',
  'maestro author': 'maestro.document.authoring.apply',
  'maestro coordinator-handoff': 'orchestration.coordinatorHandoff',
  'maestro browser-surface open': 'orchestration.browserSurface.ensure',
  'maestro browser-surface focus': 'orchestration.browserSurface.focus',
  'maestro browser-surface capture': 'orchestration.browserSurface.capture',
  'maestro browser-surface retain': 'orchestration.browserSurface.retain',
  'maestro browser-surface release': 'orchestration.browserSurface.release',
  'maestro delegate': 'maestro.delegation.request',
  'maestro list': 'maestro.delegation.catalog',
  'maestro take': 'maestro.delegation.take',
  'maestro settle': 'maestro.delegation.settle'
}

export const MAESTRO_HANDLERS: Record<string, CommandHandler> = {
  'maestro show': async (handler) => {
    await printCall(handler, 'maestro.document.get', {
      scope: {
        execution_host_id: getRequiredStringFlag(handler.flags, 'host'),
        workspace_key: getRequiredStringFlag(handler.flags, 'workspace')
      }
    })
  },
  'maestro index': async (handler) => {
    await printCall(handler, 'maestro.list', {})
  },
  'maestro watch': async (handler) => {
    const request = parsePayload(handler.flags)
    const once = handler.flags.get('once') === true
    const requestedRevision = request.sinceRevision
    if (
      typeof requestedRevision !== 'number' ||
      !Number.isInteger(requestedRevision) ||
      requestedRevision < 0
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Expected --payload.sinceRevision to be non-negative.'
      )
    }
    let interrupted = false
    let resolveInterrupted: (() => void) | null = null
    const interruptedPromise = new Promise<void>((resolve) => {
      resolveInterrupted = resolve
    })
    const stop = (): void => {
      interrupted = true
      resolveInterrupted?.()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      let sinceRevision = requestedRevision
      for (let eventCount = 0; eventCount < MAX_WATCH_EVENTS && !interrupted; eventCount += 1) {
        const result = await handler.client.call('maestro.document.deltas', {
          ...request,
          sinceRevision
        })
        if (interrupted) {
          return
        }
        const event = watchEvent(result.result)
        await emitNdjson(event, interruptedPromise)
        if (once || interrupted || event.resetRequired || event.revision === sinceRevision) {
          return
        }
        sinceRevision = event.revision
      }
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
  },
  'maestro open': async (handler) => {
    await printCall(handler, 'maestro.canvas.open', {
      execution_host_id: getRequiredStringFlag(handler.flags, 'host'),
      workspace_key: getRequiredStringFlag(handler.flags, 'workspace')
    })
  },
  'maestro workspace-bootstrap-receipt': async (handler) => {
    await printCall(handler, 'orchestration.workspaceBootstrapReceipt', {
      runId: getRequiredStringFlag(handler.flags, 'run'),
      orchestrationHomeSelector: getRequiredStringFlag(handler.flags, 'orchestration-home'),
      executionWorkspaceSelector: getRequiredStringFlag(handler.flags, 'execution-workspace'),
      executionHostId: getRequiredStringFlag(handler.flags, 'host')
    })
  }
}

for (const [command, method] of Object.entries(payloadMethodHandlers)) {
  MAESTRO_HANDLERS[command] = async (handler) => {
    await printCall(handler, method, parsePayload(handler.flags))
  }
}
