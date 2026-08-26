import { runProcess } from '../../shared/child-process/run-process'

/** Session-name namespace Orca gives one daemon per browser tab. */
export const ORCA_TAB_SESSION_PREFIX = 'orca-tab-'

const SWEEP_LIST_TIMEOUT_MS = 5_000
const SWEEP_CLOSE_TIMEOUT_MS = 5_000
const SWEEP_MAX_OUTPUT_BYTES = 256 * 1024

type SessionListEnvelope = {
  success?: unknown
  data?: { sessions?: unknown }
}

function parseSessionNames(stdout: string): string[] {
  let envelope: SessionListEnvelope
  try {
    envelope = JSON.parse(stdout) as SessionListEnvelope
  } catch {
    return []
  }
  const sessions = envelope?.data?.sessions
  if (!Array.isArray(sessions)) {
    return []
  }
  return sessions.filter((name): name is string => typeof name === 'string' && name.length > 0)
}

/**
 * Close agent-browser daemons left behind by a previous Orca run.
 *
 * A crash (or SIGKILL) leaves one daemon per open tab with nobody holding its
 * name; `closeStaleAgentBrowserSession` only resets the single name a new tab
 * is about to reuse, so the rest persist. This closes them through
 * agent-browser's own CLI rather than by walking pids.
 *
 * Scoping — this only runs when `AGENT_BROWSER_SOCKET_DIR` is set, because that
 * private per-profile directory is what proves the enumeration can only see
 * this Orca profile's daemons. `createAgentBrowserProcessEnvironment` never
 * sets it on Windows (named pipes there make the directory moot), so Windows
 * gets no sweep at all rather than a machine-wide `session list` that could
 * close a daemon Orca does not own. Windows is still bounded by
 * `AGENT_BROWSER_IDLE_TIMEOUT_MS`, which needs no ownership proof.
 */
export async function sweepOrphanedAgentBrowserSessions(options: {
  binaryPath: string
  env: NodeJS.ProcessEnv
  isSessionLive?: (sessionName: string) => boolean
}): Promise<string[]> {
  if (!options.env.AGENT_BROWSER_SOCKET_DIR?.trim()) {
    return []
  }
  let listed: string[]
  try {
    const result = await runProcess({
      program: options.binaryPath,
      args: ['session', 'list', '--json'],
      env: options.env,
      timeoutMs: SWEEP_LIST_TIMEOUT_MS,
      maxOutputBytes: SWEEP_MAX_OUTPUT_BYTES
    })
    listed = result.timedOut ? [] : parseSessionNames(result.stdout)
  } catch {
    return []
  }

  const closed: string[] = []
  for (const sessionName of listed) {
    if (!sessionName.startsWith(ORCA_TAB_SESSION_PREFIX) || options.isSessionLive?.(sessionName)) {
      continue
    }
    try {
      await runProcess({
        program: options.binaryPath,
        args: ['--session', sessionName, 'close'],
        env: options.env,
        timeoutMs: SWEEP_CLOSE_TIMEOUT_MS,
        maxOutputBytes: SWEEP_MAX_OUTPUT_BYTES
      })
      closed.push(sessionName)
    } catch {
      // A daemon that died mid-sweep needs no closing.
    }
  }
  return closed
}
