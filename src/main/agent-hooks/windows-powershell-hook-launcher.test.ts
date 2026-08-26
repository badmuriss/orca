import { describe, expect, it } from 'vitest'
import {
  encodeWindowsPowerShellHookCommand,
  WINDOWS_POWERSHELL_HOOK_SWITCHES,
  wrapWindowsPowerShellEncodedCommand
} from './windows-powershell-hook-launcher'

function decodePayload(command: string): string {
  const encoded = command.match(/ -EncodedCommand (\S+)$/)?.[1]
  expect(encoded).toBeTruthy()
  return Buffer.from(encoded!, 'base64').toString('utf16le')
}

/*
 * #16003: endpoint security (reproduced with Kaspersky Premium on Windows 11)
 * denies process creation for `-ExecutionPolicy Bypass -WindowStyle Hidden
 * -EncodedCommand` regardless of what the payload decodes to, and no AV
 * exclusion re-enabled it. The reporter measured exactly four command lines;
 * the only encoded one that ran was `-NoProfile -EncodedCommand <b64>`. No
 * measurement exists for a shape that drops just one flag, so the launcher must
 * emit the measured-passing shape rather than an interpolated one.
 */
describe('windows PowerShell hook launcher', () => {
  it('emits only the encoded command line the affected host measured as allowed', () => {
    const command = wrapWindowsPowerShellEncodedCommand('exit 0')

    expect(WINDOWS_POWERSHELL_HOOK_SWITCHES).toBe('-NoProfile')
    expect(command).toMatch(/ -NoProfile -EncodedCommand [A-Za-z0-9+/=]+$/)
  })

  it('spells neither flag of the denied "hidden encoded PowerShell" pair', () => {
    // -WindowStyle Hidden alongside -EncodedCommand *is* the signature the
    // denial is named for; unmeasured on the affected host, so it cannot ship.
    const command = wrapWindowsPowerShellEncodedCommand('exit 0')

    expect(WINDOWS_POWERSHELL_HOOK_SWITCHES).not.toMatch(/-WindowStyle/i)
    expect(WINDOWS_POWERSHELL_HOOK_SWITCHES).not.toMatch(/-ExecutionPolicy/i)
    expect(command.replace(/ -EncodedCommand \S+$/, '')).not.toMatch(
      /-WindowStyle|-ExecutionPolicy/i
    )
  })

  it('keeps the execution-policy bypass, in the payload where AV cannot read it', () => {
    // Why it must survive somewhere: Copilot's managed hook is a .ps1, which a
    // Restricted or AllSigned machine policy refuses to run without a bypass.
    // Process scope is exactly what the switch used to set.
    expect(decodePayload(wrapWindowsPowerShellEncodedCommand('exit 0'))).toContain(
      'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue'
    )
  })

  it('swallows a terminating execution-policy failure, not just a non-terminating one', () => {
    // A GPO MachinePolicy/UserPolicy scope makes the cmdlet complain that the
    // process scope did not take. -ErrorAction covers only the non-terminating
    // half; the switch this replaced printed nothing either way, and an
    // ErrorRecord on stderr corrupts consumers that merge our streams into JSON.
    const decoded = decodePayload(wrapWindowsPowerShellEncodedCommand('exit 0'))

    expect(decoded).toMatch(/try \{[^}]*Set-ExecutionPolicy[^}]*\} catch \{\}/)
  })

  it('applies the bypass before the caller command and keeps progress silenced', () => {
    const decoded = Buffer.from(
      encodeWindowsPowerShellHookCommand('& $scriptPath'),
      'base64'
    ).toString('utf16le')

    expect(decoded).toBe(
      "try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue } catch {}; $ProgressPreference='SilentlyContinue'; & $scriptPath"
    )
  })
})
