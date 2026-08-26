// Why: centralizing the launcher keeps window suppression consistent across installers (#14815).

// Why: an absolute forward-slash path avoids PATH hijacking and survives cmd.exe and Git Bash.
export function getWindowsSystem32Path(relativePath: string): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return `${systemRoot.replaceAll('\\', '/')}/System32/${relativePath}`
}

export function getWindowsPowerShellExecutablePath(): string {
  return getWindowsSystem32Path('WindowsPowerShell/v1.0/powershell.exe')
}

/**
 * Switches for the hidden PowerShell that relays hook output and exit status
 * (#14818 — conhost does neither).
 *
 * `-ExecutionPolicy Bypass` is deliberately absent. Spelled on the command line
 * it completes `-ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand`,
 * the textbook "hidden encoded PowerShell" malware shape, and endpoint security
 * denies that combination at process creation whatever the payload decodes to —
 * even `exit 0`. Users saw every hook fail with `powershell.exe: Permission
 * denied` (exit 126 from bash's execve, i.e. EACCES) on every turn, with no
 * exclusion that re-enabled it (#16003). Dropping any one of the three flags
 * clears the signature, so the bypass moves into the encoded payload below,
 * where it is the same process-scope setting with the same power.
 */
export const WINDOWS_POWERSHELL_HOOK_SWITCHES = '-NoProfile -WindowStyle Hidden'

// Why: redirected PowerShell progress becomes CLIXML that can corrupt merged JSON output.
const HOOK_PROGRESS_SILENCER = "$ProgressPreference='SilentlyContinue'; "

/**
 * Process-scope stand-in for the `-ExecutionPolicy Bypass` switch (#16003).
 *
 * Equivalent by construction: the switch sets the Process scope too, and both
 * lose to a Group Policy scope. `-EncodedCommand` itself is never policy-gated,
 * so this always gets to run; it is what lets the managed `.ps1` hooks (Copilot)
 * execute under a Restricted or AllSigned machine policy. Failures are swallowed
 * because a hook must still answer its agent when the policy is locked down.
 */
const HOOK_EXECUTION_POLICY_BYPASS =
  'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue; '

// Why: encoding shields paths and switches from cmd.exe and MSYS rewriting (#6078, #14815).
export function encodeWindowsPowerShellHookCommand(command: string): string {
  return Buffer.from(
    `${HOOK_EXECUTION_POLICY_BYPASS}${HOOK_PROGRESS_SILENCER}${command}`,
    'utf16le'
  ).toString('base64')
}

export function wrapWindowsPowerShellEncodedCommand(command: string): string {
  return `${getWindowsPowerShellExecutablePath()} ${WINDOWS_POWERSHELL_HOOK_SWITCHES} -EncodedCommand ${encodeWindowsPowerShellHookCommand(command)}`
}
