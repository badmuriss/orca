import { TerminalShellLifecycleScanner } from '../daemon/terminal-shell-lifecycle-scanner'
import type { TerminalOwner } from '../../shared/terminal-owner'

// Why bounded: a serialize awaiting settle() must not inherit a slow daemon RPC
// or ps fork; a proof that lands later is still generation-guarded.
const SETTLE_DEADLINE_MS = 750

/**
 * Mirror-side shell ownership for the runtime's per-PTY headless emulator.
 * Never pauses or injects: for daemon-backed PTYs the host barrier already
 * ordered the stream (any recovery reset arrives as ordinary bytes), so a
 * trigger here is only a proof candidate answered by the host's settled
 * verdict; for direct local PTYs the answer is a fresh process inspection.
 * Fed the same bytes the emulator parses, in the same order.
 */
export class PtyShellOwnershipMirror {
  private readonly scanner = new TerminalShellLifecycleScanner()
  private confirmInFlight = false
  private latestCandidateGeneration: number | undefined
  private settleWaiters: (() => void)[] = []
  private disposed = false

  constructor(private readonly confirm: () => Promise<boolean>) {}

  scan(data: string): void {
    if (this.disposed) {
      return
    }
    let rest = data
    while (rest.length > 0) {
      const events = this.scanner.scan(rest)
      if (events.cleanExitCandidate) {
        this.startConfirmation(events.cleanExitCandidate.generation)
      }
      if (events.uncleanDeathTriggerEnd === undefined) {
        return
      }
      // The stream owner already resolved this boundary; ask it, keep scanning.
      this.startConfirmation(this.scanner.generation)
      rest = rest.slice(events.uncleanDeathTriggerEnd)
    }
  }

  get owner(): TerminalOwner | undefined {
    return this.scanner.owner
  }

  seedOwner(owner: TerminalOwner | undefined, opts: { alternateScreen?: boolean } = {}): void {
    this.scanner.seedOwner(owner, opts)
  }

  /** Waits out an in-flight proof for the current generation; a generation
   *  advance past the entry point ends the wait (that proof is stale), and the
   *  wait is bounded — serialize latency must never inherit a slow RPC or
   *  process inspection; an unsettled proof just reads as no owner. */
  async settle(): Promise<void> {
    const target = this.scanner.generation
    let deadlineHit = false
    const deadline = setTimeout(() => {
      deadlineHit = true
      this.resolveSettleWaiters()
    }, SETTLE_DEADLINE_MS)
    deadline.unref?.()
    try {
      while (
        this.confirmInFlight &&
        this.scanner.generation <= target &&
        !this.disposed &&
        !deadlineHit
      ) {
        await new Promise<void>((resolve) => this.settleWaiters.push(resolve))
      }
    } finally {
      clearTimeout(deadline)
    }
  }

  dispose(): void {
    this.disposed = true
    this.resolveSettleWaiters()
  }

  private startConfirmation(generation: number): void {
    this.latestCandidateGeneration = generation
    if (this.confirmInFlight || this.disposed) {
      return
    }
    this.confirmInFlight = true
    const requested = generation
    void this.confirm()
      .then((confirmed) => {
        if (confirmed && !this.disposed) {
          this.scanner.trySetOwner(requested)
        }
      })
      .catch(() => {})
      .finally(() => {
        this.confirmInFlight = false
        const latest = this.latestCandidateGeneration
        if (
          latest !== undefined &&
          latest !== requested &&
          latest === this.scanner.generation &&
          !this.disposed
        ) {
          // One superseding candidate can still be current; stale ones are not retried.
          this.startConfirmation(latest)
        }
        this.resolveSettleWaiters()
      })
  }

  private resolveSettleWaiters(): void {
    const waiters = this.settleWaiters
    this.settleWaiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }
}
