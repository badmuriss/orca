function frameString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isClaudeToolResultOnlyUserFrame(message: Record<string, unknown>): boolean {
  if (message.type !== 'user') {
    return false
  }
  const body = message.message
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false
  }
  const content = (body as { content?: unknown }).content
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'tool_result'
    )
  )
}

/** Identifies the provider replay that acknowledges one submitted user payload. */
export function readClaudeReplayedUserFrameUuid(
  message: Record<string, unknown>,
  sessionId?: string
): string | null {
  if (
    message.type !== 'user' ||
    message.parent_tool_use_id !== null ||
    isClaudeToolResultOnlyUserFrame(message) ||
    (sessionId !== undefined && frameString(message, 'session_id') !== sessionId)
  ) {
    return null
  }
  return frameString(message, 'uuid')
}
