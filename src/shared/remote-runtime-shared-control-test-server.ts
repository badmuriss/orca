import type { WebSocket } from 'ws'
import { encrypt } from './e2ee-crypto'

export function isStreamingTestMethod(method: string): boolean {
  return (
    method.endsWith('.subscribe') ||
    method === 'session.tabs.subscribeAll' ||
    method === 'files.watch'
  )
}

export function sendEncryptedTestMessage(
  webSocket: WebSocket,
  sharedKey: Uint8Array,
  message: unknown
): void {
  webSocket.send(encrypt(JSON.stringify(message), sharedKey))
}
