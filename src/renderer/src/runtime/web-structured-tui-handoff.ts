type StructuredTuiHandoffBinding = {
  environmentId: string
  worktreeId: string
  hostTabId: string
  sessionId: string
  agent: 'codex' | 'claude'
}

const bindingsByHostTab = new Map<string, StructuredTuiHandoffBinding>()

function bindingKey(
  args: Pick<StructuredTuiHandoffBinding, 'environmentId' | 'worktreeId' | 'hostTabId'>
): string {
  return `${args.environmentId}\0${args.worktreeId}\0${args.hostTabId}`
}

export function recordStructuredTuiHandoffBinding(binding: StructuredTuiHandoffBinding): void {
  if (
    !binding.environmentId.trim() ||
    !binding.worktreeId.trim() ||
    !binding.hostTabId.trim() ||
    !binding.sessionId.trim()
  ) {
    return
  }
  bindingsByHostTab.set(bindingKey(binding), binding)
}

export function resolveStructuredTuiHandoffBinding(
  args: Pick<StructuredTuiHandoffBinding, 'environmentId' | 'worktreeId' | 'hostTabId'>
): StructuredTuiHandoffBinding | null {
  return bindingsByHostTab.get(bindingKey(args)) ?? null
}

export function clearStructuredTuiHandoffBinding(
  args: Pick<StructuredTuiHandoffBinding, 'environmentId' | 'worktreeId' | 'hostTabId'>
): void {
  bindingsByHostTab.delete(bindingKey(args))
}

export function clearStructuredTuiHandoffBindingsForWorktree(
  environmentId: string,
  worktreeId: string
): void {
  const prefix = `${environmentId}\0${worktreeId}\0`
  for (const key of bindingsByHostTab.keys()) {
    if (key.startsWith(prefix)) {
      bindingsByHostTab.delete(key)
    }
  }
}

export function clearStructuredTuiHandoffBindingsForEnvironment(environmentId: string): void {
  const prefix = `${environmentId}\0`
  for (const key of bindingsByHostTab.keys()) {
    if (key.startsWith(prefix)) {
      bindingsByHostTab.delete(key)
    }
  }
}

export function resetStructuredTuiHandoffBindingsForTests(): void {
  bindingsByHostTab.clear()
}
