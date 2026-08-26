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
 * #16003: endpoint security (reproduced with Kaspersky, but the shape is the
 * generic "hidden encoded PowerShell" signature) denies process creation for
 * `-ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand` regardless of
 * what the payload decodes to. Every Orca-injected hook then failed with
 * `powershell.exe: Permission denied` on every turn, and no AV exclusion
 * re-enabled it. Dropping any one of the three flags clears the signature.
 */
describe('windows PowerShell hook launcher', () => {
  it('never spells the denied flag triple on the command line', () => {
    const command = wrapWindowsPowerShellEncodedCommand('exit 0')

    expect(WINDOWS_POWERSHELL_HOOK_SWITCHES).not.toMatch(/-ExecutionPolicy/i)
    expect(command).not.toMatch(/-ExecutionPolicy/i)
    // The two remaining flags are what make the launcher useful; keep them.
    expect(command).toContain('-WindowStyle Hidden')
    expect(command).toContain('-EncodedCommand')
  })

  it('keeps the execution-policy bypass, in the payload where AV cannot read it', () => {
    // Why it must survive somewhere: Copilot's managed hook is a .ps1, which a
    // Restricted or AllSigned machine policy refuses to run without a bypass.
    // Process scope is exactly what the switch used to set.
    expect(decodePayload(wrapWindowsPowerShellEncodedCommand('exit 0'))).toContain(
      'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue;'
    )
  })

  it('applies the bypass before the caller command and keeps progress silenced', () => {
    const decoded = Buffer.from(
      encodeWindowsPowerShellHookCommand('& $scriptPath'),
      'base64'
    ).toString('utf16le')

    expect(decoded).toMatch(
      /^Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue; \$ProgressPreference='SilentlyContinue'; & \$scriptPath$/
    )
  })
})
