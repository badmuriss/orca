import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import {
  assertWorkerLaunchPreferencesCreateTerminal,
  assertWorkerLaunchPreferencesRuntimeSupported,
  attachWorkerLaunchExecutable,
  createPendingWorkerLaunchReceipt,
  createWorkerLaunchReceipt,
  resolveFederatedWorkerLaunchReceipt,
  resolveRequestedAgentPermissionMode,
  resolveWorkerLaunchPreferences
} from './orchestration-worker-launch-preferences'
import { WorkerStartParams } from './orchestration-worker-start-schema'
import { boundedRedactedDiagnostic } from './orchestration-worker-start-receipt'

describe('orchestration worker launch preferences', () => {
  it('passes an opaque Claude model and portable effort through the shared catalog', () => {
    expect(
      resolveWorkerLaunchPreferences({
        agent: 'claude',
        model: 'aws-bedrock-opus-5',
        effort: 'high'
      })
    ).toEqual({
      preferences: { model: 'aws-bedrock-opus-5', effort: 'high' },
      receipt: {
        requested: {
          agent: 'claude',
          model: 'aws-bedrock-opus-5',
          effort: 'high',
          permissionMode: 'yolo',
          executable: null
        },
        effective: {
          agent: 'claude',
          model: 'aws-bedrock-opus-5',
          effort: 'high',
          permissionMode: 'yolo',
          executable: null
        }
      }
    })
  })

  it('does not invent an effort when only a model is requested', () => {
    expect(
      resolveWorkerLaunchPreferences({ agent: 'codex', model: 'gpt-5.6-sol' }).preferences
    ).toEqual({ model: 'gpt-5.6-sol' })
  })

  it.each([
    {
      model: 'gpt-5.6-sol',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      rejected: ['future-effort']
    },
    {
      model: 'gpt-5.6-terra',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      rejected: ['future-effort']
    },
    {
      model: 'gpt-5.6-luna',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      rejected: ['ultra', 'future-effort']
    },
    {
      model: 'gpt-5.5',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    },
    {
      model: 'gpt-5.2-codex',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    },
    {
      model: 'gpt-5.4',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    },
    {
      model: 'gpt-5.4-mini',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    },
    {
      model: 'gpt-5.3-codex-spark',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    },
    {
      model: 'future-codex-model',
      accepted: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      rejected: ['max', 'ultra', 'future-effort']
    }
  ])('enforces the Codex effort ceiling for $model', ({ model, accepted, rejected }) => {
    const catalog = getAgentSessionOptionCatalog('codex')!
    const effort =
      catalog.models
        .find((candidate) => candidate.id === model)
        ?.options.find((option) => option.id === 'effort') ??
      catalog.unknownModelOptions?.find((option) => option.id === 'effort')

    expect(effort?.kind.type).toBe('select')
    expect(
      effort?.kind.type === 'select' ? effort.kind.choices.map(({ value }) => value) : []
    ).toEqual(accepted)

    for (const effortValue of accepted) {
      expect(
        resolveWorkerLaunchPreferences({ agent: 'codex', model, effort: effortValue }).preferences
      ).toEqual({ model, effort: effortValue })
    }
    for (const effortValue of rejected) {
      expect(() =>
        resolveWorkerLaunchPreferences({ agent: 'codex', model, effort: effortValue })
      ).toThrow(`does not support effort ${effortValue}`)
    }
  })

  it('rejects effort without a model', () => {
    expect(() => resolveWorkerLaunchPreferences({ agent: 'codex', effort: 'high' })).toThrow(
      '--effort requires --model'
    )
  })

  it('rejects model selection for agents without a launch catalog', () => {
    expect(() =>
      resolveWorkerLaunchPreferences({ agent: 'grok', model: 'grok-code-fast-1' })
    ).toThrow('does not support launch-time model selection')
  })

  it('does not expose deprecated Gemini model selection to worker-start', () => {
    expect(() =>
      resolveWorkerLaunchPreferences({ agent: 'gemini', model: 'gemini-3-pro-preview' })
    ).toThrow('does not support launch-time model selection')
  })

  it('rejects preferences when reusing an existing terminal', () => {
    expect(() =>
      assertWorkerLaunchPreferencesCreateTerminal({
        terminal: 'term_existing',
        model: 'gpt-5.6-sol'
      })
    ).toThrow('cannot be applied when reusing an existing terminal')
  })

  it('requires remote capability support only for explicit preferences', () => {
    expect(() =>
      assertWorkerLaunchPreferencesRuntimeSupported({
        model: 'gpt-5.6-sol',
        capabilities: [],
        serverName: 'windows'
      })
    ).toThrow('does not support worker model or effort overrides')
    expect(() =>
      assertWorkerLaunchPreferencesRuntimeSupported({
        capabilities: [],
        serverName: 'windows'
      })
    ).not.toThrow()
    expect(() =>
      assertWorkerLaunchPreferencesRuntimeSupported({
        model: 'gpt-5.6-sol',
        capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY],
        serverName: 'windows'
      })
    ).not.toThrow()
  })

  it('uses the requested launch receipt when an older worker omits it', () => {
    const requested = createPendingWorkerLaunchReceipt({
      agent: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high'
    })

    expect(resolveFederatedWorkerLaunchReceipt(undefined, requested, true)).toEqual({
      requested: requested.requested,
      effective: requested.requested
    })
    expect(resolveFederatedWorkerLaunchReceipt(undefined, requested, false)).toBe(requested)
  })

  it.each([' custom-model', 'custom-model '])(
    'rejects model ids with surrounding whitespace: %j',
    (model) => {
      expect(WorkerStartParams.safeParse({ task: 'task_1', agent: 'codex', model }).success).toBe(
        false
      )
    }
  )

  it('bounds opaque launch preferences', () => {
    expect(
      WorkerStartParams.safeParse({
        task: 'task_1',
        agent: 'codex',
        model: 'm'.repeat(513)
      }).success
    ).toBe(false)
    expect(
      WorkerStartParams.safeParse({
        task: 'task_1',
        agent: 'codex',
        model: 'custom-model',
        effort: 'e'.repeat(513)
      }).success
    ).toBe(false)
  })
})

describe('resolveRequestedAgentPermissionMode', () => {
  it('defaults an unconfigured agent to its shipped yolo default', () => {
    expect(resolveRequestedAgentPermissionMode('codex')).toBe('yolo')
  })

  it('reports manual when the configured args are empty', () => {
    expect(resolveRequestedAgentPermissionMode('codex', { agentDefaultArgs: { codex: '' } })).toBe(
      'manual'
    )
  })

  it('returns null when no agent is known yet', () => {
    expect(resolveRequestedAgentPermissionMode(null)).toBeNull()
  })
})

describe('launch receipt executable: requested vs effective', () => {
  it('starts both requested and effective executable as null before a host resolves', () => {
    const receipt = createWorkerLaunchReceipt({ agent: 'codex' })
    expect(receipt.requested.executable).toBeNull()
    expect(receipt.effective?.executable).toBeNull()
  })

  it('attaches the resolved executable to effective only, never requested', () => {
    const receipt = createWorkerLaunchReceipt({ agent: 'codex' })

    attachWorkerLaunchExecutable(receipt, '/home/user/.orca-relay/bin/orca')

    expect(receipt.requested.executable).toBeNull()
    expect(receipt.effective?.executable).toBe('/home/user/.orca-relay/bin/orca')
  })

  it('is a no-op on a still-pending (effective === null) federated receipt', () => {
    const receipt = createPendingWorkerLaunchReceipt({ agent: 'codex' })

    expect(() => attachWorkerLaunchExecutable(receipt, '/usr/local/bin/orca')).not.toThrow()
    expect(receipt.effective).toBeNull()
  })
})

describe('boundedRedactedDiagnostic', () => {
  it('redacts a key=value style secret while keeping the key name', () => {
    expect(boundedRedactedDiagnostic('login failed: token=abc123def456')).toBe(
      'login failed: token=[redacted]'
    )
  })

  it('redacts a Bearer authorization header', () => {
    expect(
      boundedRedactedDiagnostic('rejected: Authorization: Bearer sk-abcdefghij1234567890')
    ).toBe('rejected: Authorization: Bearer [redacted]')
  })

  it('redacts a GitHub-style installation token with no key= prefix', () => {
    expect(boundedRedactedDiagnostic('push failed using ghp_1234567890abcdefghij')).toBe(
      'push failed using [redacted]'
    )
  })

  it('redacts a long base64-looking blob', () => {
    const blob = 'A'.repeat(48)
    expect(boundedRedactedDiagnostic(`credential file: ${blob}`)).toBe(
      'credential file: [redacted]'
    )
  })

  it('never leaves a numeric match offset in place of the redaction', () => {
    // Why: the regression this guards — a replace callback that mistakes the
    // numeric match-offset argument for a capture group renders "37[redacted]"
    // instead of "[redacted]" for patterns with no capture group.
    const result = boundedRedactedDiagnostic('Bearer sk-abcdefghij1234567890 at offset 10')
    expect(result).not.toMatch(/\d+\[redacted\]/)
    expect(result).toContain('Bearer [redacted]')
  })

  it('truncates and bounds an overlong message', () => {
    // Why: spaces every 4 chars keep this well clear of the 40-char
    // unbroken-run threshold the base64-blob redaction rule matches on.
    const long = 'word '.repeat(600)
    const result = boundedRedactedDiagnostic(long)
    expect(result.length).toBeLessThan(long.length)
    expect(result).toContain('[truncated 1000 chars]')
  })

  it('leaves a plain message with no secrets untouched', () => {
    expect(boundedRedactedDiagnostic('plain message, no secrets')).toBe('plain message, no secrets')
  })

  it('is idempotent — redacting an already-redacted message changes nothing further', () => {
    const once = boundedRedactedDiagnostic('token=abc123def456 and Bearer sk-oldpeerkey1234567890')
    const twice = boundedRedactedDiagnostic(once)
    expect(twice).toBe(once)
  })
})
