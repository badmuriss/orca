import type { MaestroTerminalLeaseRole } from '../../../../shared/maestro-terminal-lease'
import { translate } from '@/i18n/i18n'

export type MaestroTerminalLifecycleTone = 'live' | 'retained' | 'released' | 'unknown' | 'starting'

export type MaestroTerminalLifecycleViewModel = {
  state: string
  label: string
  description: string
  tone: MaestroTerminalLifecycleTone
  canRetain: boolean
  canRelease: boolean
  canHandoffAndRelease: boolean
}

function normalizeLifecycleState(status: string): string {
  return status.trim().toLowerCase().replaceAll(' ', '_')
}

export function maestroTerminalLifecycleViewModel(params: {
  status: string
  role?: string
  live: boolean
}): MaestroTerminalLifecycleViewModel {
  const state = normalizeLifecycleState(params.status)
  const role: MaestroTerminalLeaseRole | null =
    params.role === 'coordinator' || params.role === 'worker' ? params.role : null
  if (state === 'released' || state === 'archived') {
    return {
      state,
      label: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.c9f09ac88a',
        'Released'
      ),
      description: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.5ce44b1249',
        'Process tree closed. Bounded history remains available.'
      ),
      tone: 'released',
      canRetain: false,
      canRelease: false,
      canHandoffAndRelease: false
    }
  }
  if (state === 'outcome_unknown' || state === 'release_unknown' || state === 'unverifiable') {
    return {
      state,
      label: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.65ef9ee048',
        'Owner unverifiable'
      ),
      description: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.145d2970ee',
        'Orca cannot prove process exit and will not close this terminal.'
      ),
      tone: 'unknown',
      canRetain: true,
      canRelease: false,
      canHandoffAndRelease: false
    }
  }
  if (state === 'reserved' || state === 'starting' || state.includes('handoff')) {
    return {
      state,
      label: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.03b72fbebc',
        'Successor starting'
      ),
      description: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.2503a9a8bf',
        'The current coordinator stays retained until newer authority is durable.'
      ),
      tone: 'starting',
      canRetain: true,
      canRelease: false,
      canHandoffAndRelease: false
    }
  }
  if (state === 'retained') {
    return {
      state,
      label: translate(
        'auto.components.maestro.maestro.terminal.lifecycle.view.model.15596ab484',
        'Retained'
      ),
      description: params.live
        ? 'Live process retained across restart.'
        : 'Retained ownership is not currently observable.',
      tone: 'retained',
      canRetain: false,
      canRelease: true,
      canHandoffAndRelease: false
    }
  }
  const active = ['active', 'running', 'ready', 'input_required'].includes(state)
  return {
    state,
    label: state === 'input_required' ? 'Input required' : active ? 'Active' : 'Settled',
    description: active
      ? 'Owned process is live. Closing this inspector does not stop it.'
      : 'Work is settled and the owned process can be retained or released.',
    tone: active ? 'live' : 'retained',
    canRetain: true,
    canRelease: !active,
    canHandoffAndRelease: role === 'coordinator' && active
  }
}
