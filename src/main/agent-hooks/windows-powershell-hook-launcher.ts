// Why: centralizing the launcher keeps every installer on one command shape; #14815 and #16003 both turned on which shape it is.

// Why: an absolute forward-slash path avoids PATH hijacking and survives cmd.exe and Git Bash.
export function getWindowsSystem32Path(relativePath: string): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return `${systemRoot.replaceAll('\\', '/')}/System32/${relativePath}`
}

export function getWindowsPowerShellExecutablePath(): string {
  return getWindowsSystem32Path('WindowsPowerShell/v1.0/powershell.exe')
}

/**
 * Switches for the PowerShell that relays hook output and exit status
 * (#14818 — conhost does neither).
 *
 * Only `-NoProfile` survives on the command line, because `-NoProfile
 * -EncodedCommand <b64>` is the one encoded shape the #16003 reporter actually
 * ran on the affected machine (Kaspersky Premium, Windows 11) and saw exit 0.
 * The four measured rows there were:
 *
 *   -NoProfile -WindowStyle Hidden -Command 'exit 0'                     -> 0
 *   -NoProfile -EncodedCommand <b64>                                     -> 0
 *   -NoProfile -ExecutionPolicy Bypass -Command 'exit 0'                 -> 0
 *   -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand -> 126
 *
 * Every passing row drops two of the three flags; none drops exactly one, so
 * "drop any one flag" is extrapolation, not measurement. `-WindowStyle Hidden
 * -EncodedCommand` is itself the "hidden encoded PowerShell" shape the denial
 * is named for, so keeping it would be a guess. Dropping it costs at most a
 * console flash where the parent has no console to inherit; keeping
 * `-Command` instead of `-EncodedCommand` would cost path and switch integrity
 * across cmd.exe and MSYS (#6078, #14815), which is a correctness loss.
 *
 * `-ExecutionPolicy Bypass` moves into the encoded payload below, where it is
 * the same process-scope setting with the same power.
 */
export const WINDOWS_POWERSHELL_HOOK_SWITCHES = '-NoProfile'

// Why: redirected PowerShell progress becomes CLIXML that can corrupt merged JSON output.
const HOOK_PROGRESS_SILENCER = "$ProgressPreference='SilentlyContinue'; "

/**
 * Process-scope stand-in for the `-ExecutionPolicy Bypass` switch (#16003).
 *
 * Equivalent by construction: the switch sets the Process scope too, and both
 * lose to a Group Policy scope. `-EncodedCommand` itself is never policy-gated,
 * so this always gets to run; it is what lets the managed `.ps1` hooks (Copilot)
 * execute under a Restricted or AllSigned machine policy.
 *
 * try/catch as well as `-ErrorAction SilentlyContinue`: under a MachinePolicy or
 * UserPolicy GPO the cmdlet reports that the process scope did not take, and
 * `-ErrorAction` only governs the non-terminating half of that. The switch this
 * replaces printed nothing at all in the same situation, and an ErrorRecord on
 * stderr is a live corruption risk for the consumers that merge our streams into
 * JSON stdout (see the progress silencer above). A hook must still answer its
 * agent when the policy is locked down.
 */
const HOOK_EXECUTION_POLICY_BYPASS =
  'try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue } catch {}; '

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
