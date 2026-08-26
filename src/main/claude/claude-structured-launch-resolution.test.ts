import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  getSpawnArgsForWindows,
  UnsafeWindowsBatchArgumentsError
} from '../../shared/windows-batch-spawn'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import {
  CLAUDE_DEFAULT_SETTING_SOURCES,
  CLAUDE_STRUCTURED_BASE_ARGS,
  claudeSessionIdForOrcaSession,
  createClaudeStructuredLaunchResolver
} from './claude-structured-launch-resolution'

const SESSION_ID = 'orca-session-1'
const IDENTITY = { sessionId: SESSION_ID } as Parameters<
  ReturnType<typeof createClaudeStructuredLaunchResolver>
>[0]['identity']

function record(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    sessionId: SESSION_ID,
    provider: 'claude',
    location: {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/work/.claude' },
    providerHandleChain: [],
    ...overrides
  } as AgentSessionRecord
}

function resolverFor(value: AgentSessionRecord | null, resolveEnv?: () => Record<string, string>) {
  return createClaudeStructuredLaunchResolver({
    store: { getRecord: () => value } as unknown as AgentSessionRecordStore,
    resolveWorkspacePath: async (id) => `/repos/${id}`,
    settingsDirectory: join(tmpdir(), 'orca-claude-structured-launch-tests'),
    resolveCommand: () => '/usr/local/bin/claude',
    ...(resolveEnv ? { resolveEnv } : {})
  })
}

describe('claude structured launch resolution', () => {
  it('pre-mints a stable provider id and pins interactive setting sources', async () => {
    const first = await resolverFor(record())({ identity: IDENTITY })
    const second = await resolverFor(record())({ identity: IDENTITY })

    expect(first.providerSessionId).toBe(claudeSessionIdForOrcaSession(SESSION_ID))
    expect(second.providerSessionId).toBe(first.providerSessionId)
    expect(first).toMatchObject({
      command: '/usr/local/bin/claude',
      cwd: '/repos/workspace-1',
      claudeConfigDir: '/home/work/.claude',
      resumeLeafUuid: null,
      resumed: false
    })
    expect(first.args).toContain('--session-id')
    expect(first.args).toContain(first.providerSessionId)
    expect(first.args).toContain('--permission-prompt-tool')
    expect(first.args).toContain('stdio')
    expect(first.args).toContain('--setting-sources')
    expect(first.args).toContain(CLAUDE_DEFAULT_SETTING_SOURCES.join(','))
    expect(CLAUDE_STRUCTURED_BASE_ARGS).toContain('--verbose')
  })

  it('provides SessionStart proof without relying on optional user hooks', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'orca-claude-structured-launch-'))
    await writeFile(join(claudeConfigDir, 'settings.json'), '{"hooks":{}}', 'utf8')

    try {
      const launch = await resolverFor(
        record({ accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: claudeConfigDir } })
      )({ identity: IDENTITY })
      const overlayValues = launch.args.flatMap((arg, index) =>
        launch.args[index - 1] === '--settings' ? [arg] : []
      )
      const overlayContents = await Promise.all(
        overlayValues.map(async (value) => {
          try {
            JSON.parse(value)
            return value
          } catch {
            const path = isAbsolute(value) ? value : resolve(launch.cwd, value)
            return readFile(path, 'utf8').catch(() => '')
          }
        })
      )
      const pinnedSettings = await readFile(join(claudeConfigDir, 'settings.json'), 'utf8')

      expect([pinnedSettings, ...overlayContents].join('\n')).toContain('SessionStart')
      expect(launch.args.slice(-2)).toEqual(['--session-id', launch.providerSessionId])
    } finally {
      await rm(claudeConfigDir, { recursive: true, force: true })
    }
  })

  it('writes the SessionStart overlay to a file before resolving a Windows Claude shim', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const claudeConfigDir = join(
      await mkdtemp(join(tmpdir(), 'orca-claude-account-')),
      'account root'
    )
    await mkdir(claudeConfigDir, { recursive: true })

    try {
      const launch = await createClaudeStructuredLaunchResolver({
        store: {
          getRecord: () =>
            record({ accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: claudeConfigDir } })
        } as unknown as AgentSessionRecordStore,
        resolveWorkspacePath: async () => join(claudeConfigDir, 'project root'),
        settingsDirectory: join(claudeConfigDir, 'Orca launch settings'),
        resolveCommand: () => 'C:\\Program Files\\Claude\\claude.cmd'
      })({ identity: IDENTITY })
      const settingsIndex = launch.args.indexOf('--settings')
      const settingsPath = launch.args[settingsIndex + 1]

      expect(settingsIndex).toBeGreaterThanOrEqual(0)
      expect(settingsPath).toBeTruthy()
      expect(settingsPath).not.toMatch(/^\{/)
      expect(JSON.parse(await readFile(settingsPath!, 'utf8'))).toEqual({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'exit 0' }] }] }
      })
      expect(launch.args).toContain('--setting-sources')
      expect(launch.args).toContain(CLAUDE_DEFAULT_SETTING_SOURCES.join(','))
      expect(launch.claudeConfigDir).toBe(claudeConfigDir)
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      await rm(claudeConfigDir, { recursive: true, force: true })
    }
  })

  it('proves the current inline SessionStart payload is rejected by the real Windows shim seam', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      expect(() =>
        getSpawnArgsForWindows('C:\\Program Files\\Claude\\claude.cmd', [
          '--settings',
          '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"exit 0"}]}]}}'
        ])
      ).toThrow(UnsafeWindowsBatchArgumentsError)
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
    }
  })

  it('resumes the session and leaf at the durable chain head', async () => {
    const launch = await resolverFor(
      record({
        providerHandleChain: [
          { handle: { provider: 'claude', sessionId: 'provider-old', leafUuid: 'leaf-old' } },
          {
            handle: {
              provider: 'claude',
              sessionId: 'provider-current',
              leafUuid: 'leaf-current'
            }
          }
        ] as AgentSessionRecord['providerHandleChain']
      })
    )({ identity: IDENTITY })

    expect(launch).toMatchObject({
      providerSessionId: 'provider-current',
      resumeLeafUuid: 'leaf-current',
      resumed: true
    })
    expect(launch.args.slice(-2)).toEqual(['--resume', 'provider-current'])
  })

  it('preserves launch arguments pinned when the session was created', async () => {
    const launch = await resolverFor(record({ launchArgs: ['--dangerously-skip-permissions'] }))({
      identity: IDENTITY
    })

    expect(launch.args[0]).toBe('--dangerously-skip-permissions')
    expect(launch.args.slice(-2)).toEqual(['--session-id', launch.providerSessionId])
  })

  it('resolves configured environment live without storing it in the session record', async () => {
    let token = 'first-token'
    const resolver = resolverFor(record(), () => ({
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_BASE_URL: 'https://gateway.example.test'
    }))

    expect((await resolver({ identity: IDENTITY })).env).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'first-token',
      ANTHROPIC_BASE_URL: 'https://gateway.example.test'
    })
    token = 'rotated-token'
    expect((await resolver({ identity: IDENTITY })).env?.ANTHROPIC_AUTH_TOKEN).toBe('rotated-token')
    expect(JSON.stringify(record())).not.toContain('token')
  })

  it('refuses other hosts, WSL, providers, and account-home variables', async () => {
    await expect(
      resolverFor(record({ location: { ...record().location, executionHostId: 'ssh:build' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/local host/)
    await expect(
      resolverFor(record({ location: { ...record().location, wslDistro: 'Ubuntu' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/local host/)
    await expect(
      resolverFor(record({ provider: 'codex' } as Partial<AgentSessionRecord>))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/codex session/)
    await expect(
      resolverFor(record({ accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex' } }))({
        identity: IDENTITY
      })
    ).rejects.toThrow(/CLAUDE_CONFIG_DIR/)
  })
})
