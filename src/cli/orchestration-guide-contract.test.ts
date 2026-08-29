import { describe, expect, it } from 'vitest'
import { normalizeCommandPositionals, parseArgs, specPaths, validateCommandAndFlags } from './args'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'
import { COMMAND_SPECS } from './specs'
import { applyVersionMatchedGuideContract } from './version-matched-guide-contract'

const COMMAND_PATHS = COMMAND_SPECS.flatMap((spec) => specPaths(spec))

function markedCommands(markdown: string): string[] {
  return [...markdown.matchAll(/<!-- cli-contract:start -->[\s\S]*?<!-- cli-contract:end -->/g)]
    .flatMap(([block]) => block.split('\n'))
    .map((line) => line.trim())
    .filter((line) => /^(?:ORCA|orca) /.test(line))
}

describe('version-matched guide command contract', () => {
  it('parses every marked command against the live registry', () => {
    const commands = BUNDLED_SKILL_GUIDES.flatMap((guide) =>
      markedCommands(applyVersionMatchedGuideContract(guide.name, guide.markdown))
    )
    expect(commands.length).toBeGreaterThan(0)

    for (const command of commands) {
      const parsed = normalizeCommandPositionals(
        COMMAND_SPECS,
        parseArgs(command.split(/\s+/).slice(1), COMMAND_PATHS)
      )
      expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed), command).not.toThrow()
    }
  })

  it('includes the required Attempt identity in every worker-start example', () => {
    const orchestration = BUNDLED_SKILL_GUIDES.find((guide) => guide.name === 'orchestration')
    const workerExamples = applyVersionMatchedGuideContract(
      orchestration?.name ?? '',
      orchestration?.markdown ?? ''
    )
      .split('\n')
      .filter((line) => line.includes('worker-start --task <'))

    expect(workerExamples?.length).toBeGreaterThan(0)
    for (const example of workerExamples ?? []) {
      expect(example).toContain('--attempt-id <attempt_id>')
    }
  })
})
