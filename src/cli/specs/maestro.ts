import { GLOBAL_FLAGS, type CommandSpec } from '../args'

const MAESTRO_PAYLOAD_FLAGS = [...GLOBAL_FLAGS, 'payload']

export const MAESTRO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['maestro', 'show'],
    summary: 'Read the bounded Maestro document',
    usage: 'orca maestro show --host <id> --workspace <key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'host', 'workspace']
  },
  {
    path: ['maestro', 'watch'],
    summary: 'Read bounded Maestro document deltas',
    usage: 'orca maestro watch --payload <json> [--once] [--json]',
    allowedFlags: [...MAESTRO_PAYLOAD_FLAGS, 'once']
  },
  {
    path: ['maestro', 'apply'],
    summary: 'Apply one revisioned Maestro mutation',
    usage: 'orca maestro apply --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'author'],
    summary: 'Apply one revisioned Maestro document authoring mutation',
    usage: 'orca maestro author --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'index'],
    summary: 'List bounded Maestro Canvas progress',
    usage: 'orca maestro index [--json]',
    allowedFlags: GLOBAL_FLAGS
  },
  {
    path: ['maestro', 'open'],
    summary: 'Focus the exact workspace Maestro Canvas',
    usage: 'orca maestro open --host <id> --workspace <key> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'host', 'workspace']
  },
  {
    path: ['maestro', 'workspace-bootstrap-receipt'],
    summary: 'Issue the exact workspace bootstrap receipt for a Run',
    usage:
      'orca maestro workspace-bootstrap-receipt --run <id> --orchestration-home <selector> --execution-workspace <selector> --host <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'orchestration-home', 'execution-workspace', 'host']
  },
  {
    path: ['maestro', 'coordinator-handoff'],
    summary: 'Start or inspect one composed coordinator handoff',
    usage: 'orca maestro coordinator-handoff --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'browser-surface', 'open'],
    summary: 'Reserve and open one managed Maestro browser surface',
    usage: 'orca maestro browser-surface open --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'browser-surface', 'focus'],
    summary: 'Focus one managed Maestro browser surface',
    usage: 'orca maestro browser-surface focus --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'browser-surface', 'capture'],
    summary: 'Capture one managed Maestro browser surface',
    usage: 'orca maestro browser-surface capture --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'browser-surface', 'retain'],
    summary: 'Retain one managed Maestro browser surface',
    usage: 'orca maestro browser-surface retain --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'browser-surface', 'release'],
    summary: 'Release one managed Maestro browser surface',
    usage: 'orca maestro browser-surface release --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'delegate'],
    summary: 'Request one Maestro delegation intent',
    usage: 'orca maestro delegate --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'list'],
    summary: 'List available Maestro delegation options',
    usage: 'orca maestro list --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'take'],
    summary: 'Take one Maestro delegation intent',
    usage: 'orca maestro take --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  },
  {
    path: ['maestro', 'settle'],
    summary: 'Settle one Maestro delegation intent',
    usage: 'orca maestro settle --payload <json> [--json]',
    allowedFlags: MAESTRO_PAYLOAD_FLAGS
  }
]
