import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProcessMemoryMetric } from '../../shared/process-stats-types'
import {
  getProcessOutputFields,
  iterateProcessOutputLines
} from '../../shared/process-output-field-scanner'
import { enumerateWindowsProcessResources } from './windows-process-resource-collector'

const execAsync = promisify(exec)
const PROCESS_QUERY_TIMEOUT_MS = 5_000
const PROCESS_QUERY_MAX_BUFFER = 10 * 1024 * 1024

export type HostProcessResourceRow = {
  pid: number
  ppid: number
  cpu: number
  memory: number
}

export type HostProcessResourceIndex = {
  byPid: Map<number, HostProcessResourceRow>
  childrenOf: Map<number, number[]>
}

export function getProcessMemoryMetric(
  platform: NodeJS.Platform = os.platform()
): ProcessMemoryMetric {
  return platform === 'win32' ? 'working-set' : 'rss'
}

export async function enumerateHostProcessResources(): Promise<HostProcessResourceIndex> {
  const rows =
    os.platform() === 'win32'
      ? await enumerateWindowsProcessResources()
      : await enumerateUnixProcessResources()
  const byPid = new Map<number, HostProcessResourceRow>()
  const childrenOf = new Map<number, number[]>()
  for (const row of rows) {
    byPid.set(row.pid, row)
    const siblings = childrenOf.get(row.ppid)
    if (siblings) {
      siblings.push(row.pid)
    } else {
      childrenOf.set(row.ppid, [row.pid])
    }
  }
  return { byPid, childrenOf }
}

async function enumerateUnixProcessResources(): Promise<HostProcessResourceRow[]> {
  try {
    const { stdout } = await execAsync('ps -eo pid=,ppid=,pcpu=,rss=', {
      maxBuffer: PROCESS_QUERY_MAX_BUFFER,
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
    })
    return parsePsOutput(stdout)
  } catch (error) {
    console.warn('[memory] ps enumeration failed', error)
    return []
  }
}

export function parsePsOutput(stdout: string): HostProcessResourceRow[] {
  const rows: HostProcessResourceRow[] = []
  for (const line of iterateProcessOutputLines(stdout)) {
    const fields = getProcessOutputFields(line, 4)
    if (fields.length < 4) {
      continue
    }
    const pid = Number.parseInt(fields[0], 10)
    const ppid = Number.parseInt(fields[1], 10)
    if (Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue
    }
    const cpu = Number.parseFloat(fields[2])
    const rssKb = Number.parseInt(fields[3], 10)
    rows.push({
      pid,
      ppid,
      cpu: Number.isFinite(cpu) && cpu > 0 ? cpu : 0,
      memory: Number.isFinite(rssKb) && rssKb > 0 ? rssKb * 1024 : 0
    })
  }
  return rows
}

export function collectProcessSubtree(index: HostProcessResourceIndex, root: number): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.pop()
    if (pid === undefined) {
      break
    }
    if (seen.has(pid)) {
      continue
    }
    seen.add(pid)
    if (index.byPid.has(pid)) {
      result.push(pid)
    }
    const children = index.childrenOf.get(pid)
    if (children) {
      queue.push(...children)
    }
  }
  return result
}
