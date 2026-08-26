import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import {
  CLAUDE_STRUCTURED_BASE_ARGS,
  prepareClaudeSessionStartProofSettings
} from './claude-structured-launch-resolution'
import {
  CLAUDE_STRUCTURED_INIT_TIMEOUT_MS,
  ClaudeStructuredSessionAdapter,
  type ClaudeStructuredSessionEvent
} from './claude-structured-session-adapter'

const command = resolveClaudeCommand()
const versionLaunch = getSpawnArgsForWindows(command, ['--version'])
const realClaudeAvailable =
  spawnSync(versionLaunch.spawnCmd, versionLaunch.spawnArgs, {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5_000
  }).status === 0
// Credentials are intentionally caller-owned; keep the binary probe separate from an explicit
// opt-in so an installed but signed-out CLI does not make ordinary test runs fail.
const runRealClaudeTests = process.env.ORCA_RUN_REAL_CLAUDE_TESTS === '1'

async function realAdapter(
  providerSessionId: string,
  claudeConfigDir: string,
  events: ClaudeStructuredSessionEvent[] = []
): Promise<{ adapter: ClaudeStructuredSessionAdapter; settingsDirectory: string }> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 'orca-claude-real-proof-'))
  const settingsPath = await prepareClaudeSessionStartProofSettings(settingsDirectory)
  const launch = getSpawnArgsForWindows(command, [
    ...CLAUDE_STRUCTURED_BASE_ARGS,
    '--settings',
    settingsPath,
    '--session-id',
    providerSessionId
  ])
  return {
    settingsDirectory,
    adapter: new ClaudeStructuredSessionAdapter({
      resolveLaunch: async () => ({
        command: launch.spawnCmd,
        args: launch.spawnArgs,
        cwd: process.cwd(),
        claudeConfigDir,
        providerSessionId,
        resumeLeafUuid: null,
        resumed: false
      }),
      proveTranscriptCursor: async ({ previousLeafUuid }) => {
        if (!previousLeafUuid) {
          throw new Error('real resumed Claude proof requires a previous transcript cursor')
        }
        return previousLeafUuid
      },
      onEvent: (event) => events.push(event),
      readProcessStartTime: async () => 1,
      now: () => 2,
      initTimeoutMs: CLAUDE_STRUCTURED_INIT_TIMEOUT_MS
    })
  }
}

function identity(providerSessionId: string): AgentSessionJournalIdentity {
  return {
    sessionId: 'real-cli-handshake',
    workspaceId: 'real-cli-workspace',
    hostId: 'local',
    agent: 'claude',
    providerHandle: { kind: 'claude', sessionId: providerSessionId, leafUuid: null }
  }
}

describe.skipIf(!realClaudeAvailable || !runRealClaudeTests)(
  'Claude structured real CLI handshake',
  () => {
    it('proves a pre-minted session before the first user message', async () => {
      const providerSessionId = randomUUID()
      const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
      const events: ClaudeStructuredSessionEvent[] = []
      const { adapter, settingsDirectory } = await realAdapter(
        providerSessionId,
        claudeConfigDir,
        events
      )

      try {
        const acquisition = await adapter.acquire({
          identity: identity(providerSessionId),
          fence: 1,
          spawnToken: 'real-cli'
        })
        const observedSubtypes = events.flatMap((event) =>
          event.type === 'message' ? [event.message.subtype] : []
        )

        expect(acquisition.link.handle).toMatchObject({
          provider: 'claude',
          sessionId: providerSessionId,
          leafUuid: null
        })
        expect(observedSubtypes).toContain('hook_started')
      } finally {
        await adapter.closeAll()
        await rm(settingsDirectory, { recursive: true, force: true })
      }
    }, 20_000)

    it('turns a real silent unauthenticated startup into sign-in guidance', async () => {
      const claudeConfigDir = await mkdtemp(join(tmpdir(), 'orca-claude-no-auth-'))
      const providerSessionId = randomUUID()
      const { adapter, settingsDirectory } = await realAdapter(providerSessionId, claudeConfigDir)

      try {
        await expect(
          adapter.acquire({
            identity: identity(providerSessionId),
            fence: 1,
            spawnToken: 'real-cli-no-auth'
          })
        ).rejects.toThrow(/not signed in.*Claude CLI.*CLAUDE_CONFIG_DIR/s)
      } finally {
        await adapter.closeAll()
        await rm(settingsDirectory, { recursive: true, force: true })
        await rm(claudeConfigDir, { recursive: true, force: true })
      }
    }, 20_000)
  }
)
