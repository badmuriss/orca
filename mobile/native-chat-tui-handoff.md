# Native Chat and Agent TUI Handoff

Status: Proposed architecture — revised 2026-08-06 with origin history, anonymized prior-art
survey, provider validation gates, corrections from the correctness review, and the durability
contracts (persisted lease, journal crash boundary, mixed-version projection, handoff stages)
required by the adversarial review

## Recommendation

Orca should make native chat a first-class, host-owned agent runtime instead of a
presentation layer over terminal input. Mobile and desktop clients should send typed
agent operations to the execution host. The execution host should talk to each agent
through its structured interface and publish one canonical Orca timeline.

Users should still be able to move between native chat and the agent's real TUI. That
movement must be an ownership handoff between two processes that resume the same durable
provider session. It must not be implemented as two clients concurrently controlling the
same provider session, and native chat must not continue typing control sequences into a
hidden TUI.

The initial structured integrations should be:

- Codex through app-server.
- Claude through the Claude Agent SDK.
- Agents with a sufficiently complete Agent Client Protocol implementation through ACP.
- Terminal-only agents through the existing PTY runtime until a structured adapter exists
  (today that includes Grok and OpenClaude, which native chat currently serves over the
  bridge).

This preserves the user's installed CLI, account, subscription, skills, MCP servers,
provider configuration, and execution environment. The mobile app does not hold provider
credentials or call model APIs directly.

## How We Got Here

The PTY bridge was a deliberate incremental-adoption strategy, not an oversight. Native
chat shipped (#5824, June 2026) as a per-tab view toggle over an already-running TUI
session: composer bytes ride the exact `terminal.send` path terminal typing uses, so
local, SSH, WSL, and relay behavior came for free with no new opcode, no capability
negotiation, and old runtimes replaying client-built keystrokes verbatim. Conversation
history reuses the transcript readers and `agentStatus` pipeline that agent-hooks (#1019)
had already built for status reporting two months earlier.

The costs were acknowledged in writing at the time. The June 2026 parity notes (since
deleted; recover with `git show a56131f65e:docs/native-chat-codex-tui-parity.md`) state
that native chat "does not own Codex state … can only type commands into the TUI and
observe agent hooks/transcripts after the fact," and already named the structured
app-server route as the migration target. Notably, the repo records no design-time
comparison against structured alternatives (Agent SDK, app-server, ACP): the bridge
followed from transport and infrastructure reuse, and the structured route was articulated
a week later as future work. This proposal is that follow-through, not a reversal.

## Why Change

The current native-chat composer ultimately sends bytes through `terminal.send`. Reading
the conversation and submitting the next turn use different sources of truth:

- conversation history is reconstructed from provider transcript files;
- prompts, question answers, images, slash commands, and option changes are encoded as TUI
  input;
- delivery success means the host accepted a PTY write, not that the provider accepted a
  turn;
- disconnects can leave delivery ambiguous;
- text, Enter, paste, and selector keystrokes can interleave;
- clearing an existing multi-line draft depends on terminal control behavior;
- TUI releases can change input semantics without changing Orca's wire contract.

The resulting locks (client-side only — the host serializes nothing, and the paced
text-then-Enter write leaves an open cross-client interleave window), input healing,
timeout budgets, transcript echo matching, and TUI key sequences are necessary defenses
for a PTY bridge. Only image *bytes* travel structurally today, through the chunked upload
RPCs; the resulting path is still pasted as TUI input. These defenses cannot provide the
guarantees expected from a native chat product.

## Prior Art

A private survey of eight comparable agent-IDE and terminal products (August 2026) found:

- No product converges on a chat-versus-TUI answer. Six of the eight avoid the problem
  structurally: the surface is fixed at session creation, or the agent's TUI is never
  exposed alongside chat at all. The remaining two either specified an escape hatch that
  never shipped or deliberately reframed cross-runtime continuation as a lossy fork,
  "never a resume."
- The only live chat-over-TUI implementation of one session works the way Orca's bridge
  does today — PTY paste plus transcript reads. No surveyed product models ownership in
  the UI; non-owning composers simply fail at send time.
- The pathologies in Why Change were rediscovered independently by four teams (fixed
  pre-Enter delays, echo matching, bracketed-paste sanitizing), and every product with two
  potential writers chose single-writer via eviction or rejection. None runs dual-writer.
- The structured lane split proposed here — Claude through its SDK, Codex through
  app-server, ACP as the generic third lane — has shipped elsewhere, in one case after
  reversing an ACP-first design because the ACP bridge dropped provider-specific content.

The handoff itself is unclaimed territory: no convergent design to copy, and no evidence
anyone tried it and failed. Two mechanisms from the survey are adopted in this design:
reconciling optimistic sends by client-generated id, never by text equality; and an
exclusively claimed, TTL-bounded resume-launch guard so two surfaces can never race the
provider's resume command.

## Product Model

An agent session becomes independent from any one terminal tab.

```text
Agent session
  identity: Orca session id
  location: execution host + workspace id
  provider: Codex, Claude, or another supported agent
  provider handle: durable provider session/thread id chain
  owner: native runtime or TUI runtime
  timeline: canonical Orca journal
  presentation: chat view or terminal view on each client
```

The important separation is:

- **Agent session** is durable work and conversation identity.
- **Runtime owner** is the one process currently allowed to continue that session.
- **View** is what a particular client is displaying.
- **Workspace terminal** is an ordinary shell in the same workspace and is not an agent
  runtime owner.

Chat and TUI can therefore show the same durable conversation without being live writers
at the same time.

Switching what you *look at* stays instant in both directions: native chat is always
readable from the canonical journal, and the owning TUI's screen is always visible in its
terminal. What a handoff moves is only the right to write. This deliberately retires
today's behavior where both surfaces are simultaneously writable views of one live PTY —
that dual-writer toggle is the source of the interleaving and delivery-ambiguity defects
this document exists to eliminate.

## User Experience

### Starting a supported agent

New agent sessions keep opening in the terminal exactly as they do today; native chat is an
explicit opt-in at session creation, never the default (decision 2026-08-08). When the user
chooses a chat session, Orca starts the structured adapter on the execution host and creates
or resumes the provider's durable session there. The user sees structured messages, tool
calls, diffs, questions, approvals, reasoning, status, and usage without a hidden terminal.
Because the terminal remains the default, the import path — converting an idle, resumable
TUI session into a structured session through the switching-to-native proof machinery — is a
first-class entry point into native chat, not an afterthought.

The session header offers two distinct terminal actions:

- **Open workspace terminal** opens or focuses an ordinary shell immediately. It does not
  stop or change the agent.
- **Open agent TUI** transfers the agent session from the native runtime to its real TUI.

Keeping these actions distinct avoids implying that every terminal in the workspace owns
the agent conversation.

### Moving from native chat to the agent TUI

When the session is idle, **Open agent TUI** performs a handoff:

1. Orca marks the session as `switching-to-tui` and rejects new prompts from every client.
2. The native adapter drains accepted events into the Orca journal.
3. Orca confirms that no turn, approval, question, or provider control request is pending.
4. The adapter closes its provider process gracefully and persists the provider handle.
5. Orca launches the provider's resume command in a PTY in the same execution environment,
   workspace, account, and configuration.
6. The TUI must prove that it resumed the expected provider handle before it receives
   ownership.
7. Orca records the new owner at the new fence and shows the TUI.

The user sees short stage labels such as `Finishing chat session…` and
`Opening agent terminal…` when remote or SSH latency makes the operation visible. A
freshly resumed TUI may sit on the alternate screen with nothing to replay; Orca waits for
a first redraw before declaring the terminal visible rather than presenting a blank pane.

If a turn is running, Orca does not interrupt it silently. The action becomes:

- **Switch after this turn** by default; or
- **Stop turn and switch** when the provider supports acknowledged cancellation.

If an approval or question is pending, the user resolves or declines it before switching.
Those requests contain process-local callbacks and cannot safely be moved to another
runtime.

### Using the agent TUI

The resumed TUI is the real provider interface, including its native slash commands,
selectors, rendering, and keyboard behavior. While it owns the session:

- native chat remains readable from the canonical journal and provider transcript catch-up;
- native chat keeps its composer, routed through the bridge into the owning TUI — the
  exact pre-migration behavior (parity decision 2026-08-11: the TUI remains the sole
  provider-session writer; bridge-typed input is input TO the owner, not a second writer;
  the composer is disabled only during transfer stages);
- other clients show `Agent is open in terminal` with a **Return to chat** action;
- Orca observes provider hooks and transcript changes for status and history, but does not
  infer successful prompt delivery from a terminal write;
- only the owning TUI terminal accepts agent input.

The terminal header carries a visible **Return to chat** action. This is a runtime transfer,
not merely an overlay toggle.

### Returning from the TUI to native chat

When the TUI is idle, **Return to chat** performs the reverse handoff:

1. Orca marks the session as `switching-to-native` and stops accepting TUI input.
2. Orca asks the provider TUI to exit through provider-specific process control. It does
   not synthesize Ctrl+C, `/exit`, or other TUI keystrokes as a generic mechanism.
3. Orca waits for the exact PTY process to exit and drains its final transcript and hook
   events.
4. The host verifies the durable provider handle and records a journal checkpoint.
5. The structured adapter resumes that provider handle in the same execution environment.
6. The adapter loads authoritative provider history and reconciles it into the canonical
   journal by provider item identity.
7. The session returns to `native-idle`, and native composers become available.

If a provider has no proven out-of-band shutdown path, the first implementation tells the
user to exit the TUI normally and automatically resumes native chat after Orca observes the
process exit. It does not guess at the provider's current screen or inject an exit command.
If Orca cannot prove the TUI composer is empty, it warns that unsubmitted terminal text is
not part of the durable provider session and will not appear in native chat.

Orca must never resume the structured adapter while the TUI process may still be alive. If
the TUI cannot exit cleanly, the UI keeps the session in terminal mode and offers explicit
retry or stop actions. It does not create a second owner.

If the TUI is busy, **Return to chat** follows the same policy as the opposite direction:
wait for idle, or explicitly stop and wait for provider acknowledgement before continuing.

### Failures during handoff

A handoff is transactional from the user's perspective:

- Failure before the old runtime closes leaves the old runtime authoritative.
- Failure to launch or prove the new TUI causes Orca to resume the native adapter.
- Failure to resume the native adapter leaves the stopped TUI session recoverable and shows
  a persistent retry action.
- An unknown outcome never enables both writers.
- Retrying uses the same handoff operation id and runtime fence.

The UI must identify the current owner and recovery action. It must not claim that the
session switched until the new runtime proves ownership. Which retries and cancellations are
legal depends on how far the transfer got, so each stage is persisted and each has its own
answer — see Handoff stages.

### Handoff UX decisions (accepted 2026-08-06 from the interactive mock)

- Reverse-direction copy mirrors forward: "Couldn't resume chat — the agent terminal still
  owns this session"; busy actions read "Return after this turn" / "Stop turn and return".
- Mid-handoff, the content area shows a stage curtain naming the stage in flight; the
  header chip reads a neutral "Switching" with no owner color while ownership is in motion.
- Cancel is offered only on the queued "after this turn" pill; in-flight stages expose no
  cancel affordance.
- While chat owns there is no TUI view to toggle to — no frozen last-frame terminal is
  kept browsable.
- The failure banner is persistent with no dismiss (styleguide inline-error rule); its only
  exits are a successful Retry or an ownership change. Details is an inline expander.
- Handoff status is host state: every client renders the same owner chip, stage, and
  banner (a phone shows "Agent is open in terminal on <host> — Return to chat" while a
  desktop holds the TUI).
- The durable fence is a debug affordance only; it never appears in product UI.

## Runtime Ownership State Machine

```text
native-running      --(turn finishes / stop acknowledged)--> native-idle
native-idle         --(native turn starts)-----------------> native-running
native-idle         --(open agent TUI)---------------------> switching-to-tui
switching-to-tui    --(TUI resume proved)------------------> tui-idle
tui-idle            --(TUI turn starts)--------------------> tui-running
tui-running         --(turn finishes / stop acknowledged)--> tui-idle
tui-idle            --(return to chat)---------------------> switching-to-native
switching-to-native --(native resume proved)---------------> native-idle
```

A running runtime never transfers directly: `tui-running` must reach `tui-idle` (turn
finishes, or stop acknowledged) before `return to chat` is allowed, exactly mirroring the
native direction.

Pending approvals and questions are substates of the owning runtime and block a transfer.
`error` is recoverable to the last proven owner; it is not permission to start both.

### Handoff stages

`switching-to-tui` and `switching-to-native` are not single steps. Each is a persisted stage
sequence, so a host restart re-enters the stage it left rather than starting the transfer over
or inventing an owner:

```text
preparing         --(quiesced, transfer committed)--> old-owner-stopped
old-owner-stopped --(new runtime launched)----------> new-owner-proving
new-owner-proving --(provider handle proved)--------> tui-idle | native-idle
any stage         --(deadline, crash, failed proof)-> recovering
recovering        --(proof obtained)----------------> last proven owner
recovering        --(proof unobtainable)------------> manual-recovery
```

- **`preparing`** — the transfer is committed and both runtimes are quiesced, but the old owner
  is alive and still authoritative. No writers; new prompts are refused on every client. Retry
  is an idempotent re-run under the same handoff operation id. Cancel is free, because nothing
  stopped.
- **`old-owner-stopped`** — the old process is proven exited and the fence is bumped. The
  session has no owner. Retry relaunches the new runtime under the same handoff operation id at
  the current fence. Cancel is no longer free: it means launching the previous runtime kind
  again, which re-enters `new-owner-proving` like any other launch.
- **`new-owner-proving`** — the new process is running but has not proved the provider handle.
  It may talk to the provider only to prove resume. Retries are bounded, each is a distinct
  process identity, and the previous attempt must be proven dead before the next one starts.
  Cancel proves the new process dead and then relaunches the previous kind, again through
  proving.
- **`recovering`** — automatic reconciliation after a crash, a deadline, or an unknown outcome:
  adjudicating process identity, resolving unknown submissions, rebuilding the journal prefix.
  No writers. Retry is automatic, bounded, and backed off. There is no user cancel; the user can
  only escalate to `manual-recovery`.
- **`manual-recovery`** — automation has exhausted the evidence available to it. No writers
  until the user picks one of retry proof, force-stop the suspect process, or fork-with-seed.
  This stage is terminal until a user acts.

Across every stage:

- No stage ever permits two writers, and no stage expires into an owner. Deadlines lead to
  `recovering`, and `recovering` leads to `manual-recovery` — never to the other runtime.
- The retry key is the handoff operation id plus the current fence plus the stage. A retry
  arriving with a different operation id is `agent_session_operation_conflict`, matching the
  fingerprint rule the create path already enforces.
- Fork-with-seed is offered only from `manual-recovery`, and it is labeled a fork in the UI —
  never presented as a resume.

Every runtime launch takes the session's durable fence (see the single-writer lease). Commands,
events, journal appends, and handoff receipts all carry it, so late output from a stopped
process cannot mutate the current session.

## Host Architecture

The execution host owns an `AgentSessionManager`. It is available in desktop, headless,
SSH, WSL, and folder-workspace environments and resolves work through explicit workspace
identity rather than assuming a local git worktree.

Each structured provider adapter implements the same core operations:

```text
createSession
resumeSession
startTurn
cancelTurn
respondToApproval
respondToQuestion
setSessionOption
readHistory
subscribeEvents
closeSession
buildTuiResumeLaunch
proveTuiResume
```

The common contract should cover stable product concepts, not every provider feature.
Adapters publish capabilities for optional behavior such as images, reasoning, modes,
mid-turn steering, session option changes, and TUI handoff. Provider-specific payloads may
be retained as bounded metadata without leaking provider event names into the client wire.

The adapter and its child process run on the execution host that owns the workspace. For an
SSH workspace, this normally means the remote Orca runtime launches the provider there. The
mobile client never assumes local filesystem access or constructs native paths or shell
commands.

### Canonical journal

The host journal is the source of truth for Orca clients. It stores completed item snapshots
and session lifecycle events, while transient token deltas may remain ephemeral.

Required properties:

- one reducer is used for live events and replay;
- items upsert by stable provider or Orca identity;
- every journal has an epoch and monotonically increasing sequence;
- reconnect resumes from an epoch-qualified cursor;
- an epoch mismatch performs a clean snapshot reload;
- each user submission carries a client-generated message id;
- the host returns an acceptance receipt and reconciles the provider echo by identity;
- approvals and questions are durable timeline items with explicit resolution state;
- transcript text is never globally deduplicated by content.

Provider transcript files remain useful for import, history hydration, TUI catch-up, and
recovery. They are not the live command channel.

#### Crash boundary

The gap between "Orca dispatched a turn" and "the provider accepted it" is the only place a
crash can silently duplicate or lose a user's work. It is closed by writing first.

- A **submission row** is appended and made durable before the adapter dispatches anything. It
  carries the client message id, the fence, the payload fingerprint, the provider handle, and
  dispatch state `pending`.
- **Dispatch state** advances to exactly one of `accepted` — the provider acknowledged and
  returned its own item identity — `rejected`, which is terminal and carries a reason, or
  `unknown`, meaning the process, transport, or host died between the write and the
  acknowledgement.
- Only `accepted` produces an **acceptance receipt**. Receipts are durable, keyed by client
  message id, and retained for at least the longest supported reconnect window and never less
  than their epoch's retention. A client that reconnects and re-asks about the same client
  message id gets the same answer instead of re-sending.
- `unknown` is a displayed state, not an internal one. The turn reads as *delivery unconfirmed*
  — never as sent, never as failed.

On restart, every `pending` submission becomes `unknown` and is reconciled against provider
history before the session accepts a writer:

1. Read authoritative provider history for the handle, from the last committed provider item.
2. Match by identity: the client message id where the provider echoes it, the provider item id
   otherwise, with the payload fingerprint as a tiebreak. Never by text equality.
3. Present in history — resolve to `accepted`, adopt the provider's item id, upsert.
4. Absent from history, with the provider session at a consistent boundary and no turn in
   flight — resolve to `rejected` as not delivered.
5. Anything else — stay `unknown` and ask the user to resend or discard. Orca never re-sends a
   submission on the user's behalf.

#### Sequences, revisions, and replay

- Sequence numbers are assigned by the journal writer inside the same durable transaction that
  appends the row. An `(epoch, sequence)` space has exactly one writer, held by the lease
  fence. No gaps, no reuse. A reader that observes a gap treats the journal as corrupt and
  triggers epoch rollover rather than rendering a partial timeline.
- Items are `(item id, revision)`. An upsert appends a new revision and a deletion appends a
  tombstone, so the reducer is highest-revision-wins and a late lower revision is dropped
  rather than resurrecting stale content. Cursors remain `(epoch, sequence)`.
- After a crash between provider acceptance and journal commit, replay reconciles as above and
  then appends recovered items with fresh sequences in the current epoch. Recovered items can
  therefore sort after events that really happened later, so every row carries both an observed
  timestamp and its sequence; clients order by sequence and may mark recovered items. If
  reconciliation cannot establish a consistent prefix, the host rolls the epoch and rebuilds
  from provider history plus the retained journal, and clients take the clean snapshot reload
  the epoch-mismatch rule already requires.

#### Schema, compaction, and size

- Every row carries a schema version. The journal is append-only, so migration is read-time
  upcasting and never an in-place rewrite. A host that meets a row version it does not
  understand refuses to become that session's writer and degrades to read-only. It must not
  skip the row, and it must not compact or delete a journal it cannot read. This is not
  hypothetical: an SSH host can be rolled back independently of the clients that use it.
- Compaction writes a snapshot at an `(epoch, sequence)` boundary plus the tail as one atomic
  write, runs only under the current lease fence, and must retain a tail covering the longest
  supported client reconnect window. Epoch rollover is the escape hatch for corruption, an
  unreconcilable prefix, a provider handle chain that forked, and an unreadable schema. It
  invalidates cursors, and clients reload.
- The journal lives in Orca's host-side per-workspace state, keyed by workspace id, never
  inside the user's working tree. A journal in the tree would show up in `git status`, vanish
  with `git worktree remove`, and have no defined home in a folder workspace that is not a
  repository at all.
- Tool payloads and diffs are bounded. A row keeps a bounded head plus a content digest and
  byte length; the remainder is a content-addressed blob that clients fetch on demand and that
  shares the epoch's retention and compaction. Per-session totals and per-turn append rates are
  bounded too, so a looping agent cannot fill the host disk. Crossing a bound produces an
  explicit truncation marker on the item and never silently drops it.

### Single-writer lease

The manager persists an owner lease containing:

```text
session id
runtime kind: native or tui
runtime fence: durable monotonic integer
handoff stage
provider handle chain
owning process identity: host id + pid + process start time + spawn token
lease deadline and last renewal
handoff operation id, when transitioning
last journal checkpoint: epoch and sequence
minting claim key id
```

All prompt, approval, question, option, interrupt, and terminal-input paths validate this
lease. The lease protects Orca-owned processes. A provider launched independently outside
Orca can still contend for the same provider session, so adapters should surface upstream
conflict errors instead of attempting automatic recovery by replaying work.

The lease is durable, lives on the execution host that runs the process, and is keyed by
workspace id rather than by a path — identical for a git worktree, a folder workspace, a WSL
distro, and an SSH host. A client restart adjudicates nothing. Only the host that owns the
process can resolve that host's leases.

#### Acquisition

Acquisition is a compare-and-swap on the lease's current fence. It preserves today's
reserve-then-spawn ordering by making the reservation durable before anything is started:

1. Read the lease. Refuse unless the caller's expected fence matches and the stage permits a
   new owner.
2. Durably write a reservation at fence + 1 carrying the handoff operation id and the intended
   runtime kind. This happens before any process exists. The loser of a concurrent
   compare-and-swap gets `agent_session_conflict` and never spawns.
3. Spawn the process with the reserved fence and a spawn token in its environment.
4. Atomically write the observed process identity back into the same lease row.

A crash between steps 2 and 3 leaves a reservation with no proven process, and that is not a
free lease. It is `recovering` until the host proves nothing started, where proof means finding
no process carrying that spawn token and no provider-side session activity after the
reservation — not assuming the crash beat the spawn.

Process identity is never a bare pid. Pids are reused within minutes on a busy host, and reuse
happens precisely in the recovery case. Identity is the tuple of host id, pid, process start
time, and a spawn token that Orca places in the child's environment and reads back through the
adapter handshake or the provider's own session-start hook. Every element is unavailable
somewhere — start time costs a CIM query on Windows and is missing in some containers, and
`/proc` does not exist on macOS — so the token is the element that must always be present. A
provider runtime that cannot echo the token back does not qualify for automatic recovery, only
for manual recovery.

#### Liveness, expiry, and eviction

The owner renews on a fixed interval. A renewal asserts two things at once: the host is running
its renewal loop, and the child still matches the recorded process identity. A host that cannot
re-verify the child stops renewing rather than extending a lease it can no longer vouch for.

Expiry alone never grants a second owner. A lapsed deadline means only that Orca stopped
hearing from the owner; the provider child may still be mid-turn, editing files and spending
tokens. A second owner requires one of two proofs:

- **Proven dead.** The recorded process identity is gone: an observed exit of that exact
  process, or a host probe showing the pid absent, or present with a different start time,
  command line, or spawn token. Absent evidence is not death. Where the platform cannot produce
  a start time or command line — the common Windows and restricted-container case — the lease
  fails closed and the identity counts as possibly alive. This is the opposite polarity from
  daemon adoption checks, which deliberately fail open on a missing start time: there a wrong
  answer refuses an adoption, here it creates two writers on one provider session.
- **Fenced out.** The old fence is rejected at every Orca write path — PTY writes, adapter
  input, journal appends, mutating RPC. Fencing protects Orca state, but it does not reach
  inside a provider process already talking to its own store. Fencing therefore authorizes a
  new owner only where the contended resource is Orca-side. Ownership of the same provider
  handle still requires proven dead.

When neither proof is obtainable the session goes to `manual-recovery` and offers force-stop or
fork-with-seed. It never times out into a second owner.

#### Host-restart reconciliation

A restarting host treats every persisted lease as unreconciled and grants no writer until it
adjudicates that lease:

- **Owner alive.** Identity matches, including the spawn token. The host re-adopts the running
  process, resumes renewal, and replays the journal tail. The fence does not move; re-adoption
  is not a new generation.
- **Owner dead.** Identity is provably gone. The host bumps the fence, records the death
  evidence, and the session becomes ownerless and resumable once journal recovery completes.
- **Owner unknown.** Identity cannot be verified. The session enters `recovering`, then
  `manual-recovery` if proof stays unavailable. No writer, and the UI names the suspect process
  so the user can act on it.

Orphans are the mirror-image failure: a process carrying an Orca spawn token with no matching
lease. Orphans are stopped, never adopted, because an adopted orphan has no proven provider
handle and no journal checkpoint. Neither age nor CPU is evidence — only a token or identity
match justifies stopping a process.

Reconciliation belongs to the execution host. An SSH host reconciles its own leases on its own
restart; clients learn the outcome through capability-negotiated status and show
`Recovering agent session` rather than a stale owner.

#### Fence

Each session carries one durable monotonic integer fence, incremented only by the acquisition
compare-and-swap and by proven eviction. It is stamped on every runtime launch, every adapter
event admitted to the journal, every journal append including reconciliation appends, every
mutating RPC as the expected runtime fence, and every handoff receipt and stage transition.
Stamping only launches leaves every other path unguarded.

Anything carrying a stale fence is rejected — not merged, not queued for the new owner. An
opaque fencing token is acceptable only if the host can totally order two tokens without
consulting their issuer; absent that property, use the integer.

The session fence orders ownership. It does not order turns. Turn supersession continues to
fence on the turn slot, because a dropped and re-acquired lease bumps the fence without a
single byte having been written to the provider.

#### Extending the existing claim machinery

This is a durability upgrade to machinery that already exists. It must not become a second
scheme running beside it.

- `terminal.ensureAgentSession` and `terminal.createAgentSession` already carry a timestamped
  client operation id with fingerprint conflict detection, age-based expiry, per-client and
  global capacity limits, and tombstone retention after completion. That ledger is in memory
  today, so a host restart turns "replay this create" into "spawn another agent." It moves into
  the same durable store as the lease and is written in the same atomic transaction as the
  reservation. Its retention floor must outlive a restart; an expired tombstone that a client
  still retries is a second spawn.
- The host-authority claim already fences a provider session behind an HMAC scope — key id,
  identity digest, worktree scope digest — with generation checks. The claim keeps its job of
  proving *which* session and scope a caller means. The lease adds durability, the fence, the
  stage, and the process identity. Today's random per-launch generation becomes an instance
  nonce inside a fenced generation, not a second ordering.
- The lease records the key id that minted its claim, and retired signing keys stay verifiable
  for at least the lease retention window. Otherwise a key rotation silently invalidates every
  live lease and strands running agents.
- The claim registry's reserved / live / conflicted distinction becomes persisted state. A
  conflicted key stays conflicted across a restart; it must not resolve to "free" merely
  because the process that observed the conflict is gone.

## Client and Wire Contract

Native clients need typed agent-session RPC methods rather than additions to the terminal
binary stream:

```text
agentSession.create
agentSession.ensure
agentSession.send
agentSession.subscribe
agentSession.cancel
agentSession.respondToApproval
agentSession.respondToQuestion
agentSession.setOption
agentSession.requestHandoff
agentSession.handoffStatus
```

The subscription publishes snapshots and cursor-qualified event batches. Handoff status is
shared state, so a transfer initiated on mobile is visible on desktop and vice versa.

Mixed client and host versions are normal. The host advertises optional capabilities such
as `structuredAgentSession` and provider-scoped `tuiHandoff`. New clients fall back to the
existing terminal-backed session when the host lacks them. Old clients continue to see
terminal-backed sessions and must not be sent new required fields or unnegotiated stream
frames. See [Remote wire compatibility](../docs/reference/remote-wire-compatibility.md).

### Mutation envelope

Every mutating `agentSession.*` call carries the same four fields:

```text
session id
client operation id      timestamped; a retry reuses it, a new intent mints a new one
expected runtime fence   the durable fence the caller last observed
payload fingerprint      recomputed host-side over host-resolved fields
```

The rules follow the ones `terminal.createAgentSession` already enforces, now durable:

- Same operation id and same fingerprint replays the recorded outcome. The result is marked
  `replayed`; the effect happens once.
- Same operation id with a different fingerprint is `agent_session_operation_conflict`.
- A stale expected fence is `agent_session_checkpoint_stale`. The call is refused, never
  applied optimistically, and the client refreshes and shows the current owner.
- An operation id older than the durable retention floor is `agent_session_operation_expired`
  rather than a new operation, so an unseen replay can never become a second effect.
- The fingerprint is computed by the host over host-resolved fields in a fixed order. Path
  aliases, symlinks, and client property order are syntax, not authority, and must not make one
  intent look like two.
- `agentSession.send` carries the client message id that is also the journal submission row's
  identity, so acceptance receipts and replay share one key.
- `agentSession.cancel` names the turn, not only the session. Cancellation fences on the turn
  slot for the same reason turn supersession does.

Approvals and questions carry one more field, because the provider callback behind them is
process-local and not idempotent: the item id plus the **expected item revision**. The host
applies the response only if the item is still unresolved at that revision. A second client
answering the same prompt gets a typed already-resolved result carrying the winning response
and resolver, and the provider callback is invoked exactly once. Compare-and-set here is what
stops two people on two devices from both resolving one approval.

### Mixed-version projection

A structured session has no terminal. The published session-tab union in
`src/shared/runtime-types.ts` is closed — terminal, markdown, file, browser — and the snapshot
carries a matching `activeTabType`. There is no truthful way to represent a structured session
in it.

**Structured sessions are invisible to clients that do not advertise `structuredAgentSession`.**
The host projects each publication per connection by capability:

- Structured tabs are omitted from `tabs`, from every group's `tabOrder` and `recentTabIds`,
  and from `activeTabId`, `activeGroupId`, and `activeTabType`. A projection must never leave a
  dangling active pointer; when the real active tab is structured, the projection falls back to
  that connection's most recent visible tab, or to null.
- `publicationEpoch` and `snapshotVersion` still advance on structured-only changes. A version
  that stalls would wedge an old client's cursor, and an identical projected payload is cheap.
- Every `agentSession.*` method is refused with a typed error for a connection lacking the
  capability, so a hand-built call is rejected rather than half-applied.

An old desktop attached to a workspace that has structured sessions sees the workspace
normally: its shells, files, diffs, browser tabs, and source control are unaffected, and agent
work that lands in the tree shows up through git and the filesystem as it always has. What it
does not see is the conversation. Status rows keyed to a terminal handle omit structured
sessions; workspace-level "agent is working" indicators may include them only where their
schema carries no terminal identity. Nothing renders a placeholder or an error card — the
feature is simply absent, which is what an old client should experience.

If an old client creates a session, it uses the unchanged legacy path and gets a real
terminal-backed PTY agent session. It is never attached to, adopted into, or converted from a
structured session. A workspace can therefore hold a structured session and legacy PTY sessions
at once; they are different Orca sessions with different provider handles and different leases,
which is the truth. Where the two contend inside the provider's own store, that is the same
upstream conflict as a provider launched outside Orca, and adapters surface it rather than
recovering by replay.

Downgrades lose visibility, not work. A downgraded client stops seeing structured sessions and
sees them again after upgrading, because the journal and the lease are host-side. A downgraded
*host* — the realistic case, an independently rolled-back SSH runtime — cannot read the
journal, so it refuses to write or compact it and offers only the terminal lane until it is
upgraded again.

The alternative, publishing a synthetic terminal-backed tab so old clients see something, is
rejected. It needs a forged terminal handle, and terminal handles are load-bearing in the claim
scope digest and in tab-close adjudication. Worse, old clients would send `terminal.send` bytes
into it, leaving two choices: drop them, which is a silent lie that the composer works, or
translate them into structured turns, which rebuilds the input-healing and echo-matching
machinery this design exists to delete — now with no way to report acceptance. Invisibility
fails visibly at the top of the stack instead of invisibly at the bottom.

Cross-version testing must be extended; the existing harness covers only the terminal stream.
Required coverage:

- projection: an old-capability connection receives no structured tab, no dangling active
  pointer, and a monotonically advancing cursor across structured-only mutations;
- new client against an old host: absent `structuredAgentSession`, it falls back to the
  terminal-backed session with no unknown-method errors;
- old client against a new host: every `agentSession.*` method is refused with a typed error;
- mixed fleet: a new mobile client and an old desktop on one workspace with a live structured
  session, where the old desktop's reorder, split, and close operations neither reference nor
  disturb the structured tab, and do not reorder it out of the new client's view;
- host downgrade and re-upgrade with a structured journal present, asserting no compaction and
  no data loss;
- capability negotiation itself over relay, SSH, and WSL, since the capability belongs to the
  execution host rather than to the client build.

## Provider Handoff Requirements

TUI handoff is enabled per provider and per execution host only after a real capability
probe. A provider qualifies when Orca can demonstrate all of the following:

- the structured runtime exposes a durable session handle;
- the official TUI can resume that exact handle;
- the structured runtime can later resume changes made by the TUI;
- history exposes stable enough item identities for reconciliation;
- both launch paths use the same account and configuration roots;
- the old process can be proven stopped before the other starts;
- the launched process can be identified in a PID-reuse-safe way — it echoes Orca's spawn token
  through a handshake or hook, or the host can verify its start time; without one of those the
  provider gets manual recovery only;
- session resume works on macOS, Linux, Windows, WSL, and SSH where that provider is
  otherwise supported.

If any requirement is absent, the provider may still support native chat without offering
agent-TUI handoff. It can always offer a separate workspace shell.

Handoff support must be pinned to provider capability, not inferred only from the agent
name or installed version string. Wrappers, forks, remote installations, and independently
updated CLIs can behave differently.

None of these requirements is a documented provider contract, so every one is an empirical
gate. The 2026-08-06 spikes (codex-cli 0.146.1, claude 2.1.220; evidence in the Track 0
worktrees and `~/orca-qa/codex-spike-t0b-20260806/`) settled the first round:

- Codex — cross-runtime resume is PROVEN: one thread advanced alternately by app-server and
  the TUI stays a single append-only rollout, and `thread/resume` fully reconstructs
  TUI-written turns. Item identity is NOT stable: resumed history uses positional `item-N`
  ordinals across three disjoint id namespaces, so reconciliation must key on
  `(threadId, turnId, ordinal-within-turn)` and never on a persisted item id — and
  `thread/fork` copies turns keeping their ORIGINAL turn ids, so turnId alone is not unique
  post-fork. Dual-open is a silent-divergence hazard, not a crash: no lock, no error, no
  notification — a live app-server handle answers from stale context and appends a
  conversation that never happened. Orca's lease is therefore a correctness guard the
  provider will never backstop. `turn/interrupt` acks (empty `{}` then
  `status: "interrupted"`, with an empty `items` array on the terminal event).
- Claude — the full cross-runtime round trip is PROVEN on 2.1.220: a headless-created
  session resumed in the real TUI renders the complete prior history and continues it, and
  a subsequent headless resume sees the TUI-written turns — one session id, one transcript
  file across all three legs. Headless resume KEEPS the session id and appends to one
  transcript; the earlier "silent fork" concern did not reproduce. But an unchanged session id is NOT
  proof of an unchanged conversation: two concurrent resumes of one id both succeed and
  write sibling branches into the same transcript, and the next resume silently attaches to
  the last-written leaf, orphaning the other branch. The provider handle must therefore be
  keyed `(session_id, leaf_uuid)`, with mutual exclusion enforced entirely by Orca's lease.
  `--fork-session` mints a new id but copies history with the ORIGINAL item uuids, so
  reconciliation keys `(session_id, uuid)`. Resume proof via the SessionStart hook is
  CONFIRMED: it fires on startup, resume, and fork with `session_id`, `transcript_path`,
  and a `source` discriminator. `--session-id` pre-minting works, and reusing a live id
  fails closed before any API call. Subscription-auth inheritance is confirmed headless,
  with one trap: an `env` block in the user's `settings.json` can silently re-inject a
  gateway `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` — the adapter must control setting sources
  deliberately. Still open: no documented graceful-close contract for the SDK, and
  subscription use through the SDK remains a policy question, not a mechanical one.
- If a provider's cross-runtime resume proof regresses, fork-with-seed — a new provider
  session seeded from journal history — is the fallback lane; both providers ship it
  natively (`thread/fork`, `--fork-session`). It must be labeled as a fork in the UI and
  never presented as a resume.

## State That Cannot Cross the Boundary

Switching processes preserves durable provider conversation and workspace state. It does
not preserve arbitrary process memory.

The UI must warn before a handoff would discard known process-local work, including:

- pending approvals or questions;
- unreported background commands or subagents;
- provider workflows whose completion callback lives in the current process;
- unsaved text in the TUI composer;
- TUI-only modal or selector state;
- transient streamed output not yet journaled.

The first implementation should allow handoff only from a proven idle state with no known
process-local work. Broader transfers require provider-specific evidence and tests rather
than a generic force path.

## Existing Sessions and Fallbacks

This change does not require converting every existing terminal agent.

- Existing TUI-backed sessions remain terminal-owned and keep the current native transcript
  view as a compatibility surface.
- Their chat composer may continue using the PTY bridge during migration, clearly marked as
  legacy behavior.
- New sessions use structured native chat only when the execution host advertises support.
- Unsupported agents remain normal Orca terminal sessions.
- A failed structured launch may offer **Open terminal agent** as an explicit fallback; it
  must not silently change the runtime after a prompt has an unknown delivery outcome.

Provider-session import can later convert an idle, resumable TUI session into a structured
session through the same `switching-to-native` proof path.

## Delivery Plan

### Phase 1: Separate agent identity from terminal identity

- Add a durable agent-session record scoped to an execution host and workspace.
- Add the durable fence, the persisted single-writer lease, and restart reconciliation, by
  extending the existing client-operation ledger and host-authority claim rather than beside
  them.
- Keep current TUI agents working without presentation changes.
- Define the canonical timeline, cursor contract, and journal crash boundary.
- Project structured sessions out of publications to clients without the capability, and
  extend the cross-version harness past the terminal stream.

### Phase 2: Structured native chat

- Add the Codex structured adapter and then the Claude structured adapter.
- Route mobile create, send, cancel, approval, question, image, and option flows through
  agent-session RPC.
- Render live and replayed content through one reducer.
- Retain the PTY bridge only for legacy sessions and unsupported agents.

### Phase 3: Workspace terminal alongside chat

- Make **Open workspace terminal** a first-class action from a native agent session.
- Keep the agent running while the user uses the shell.
- Preserve explicit workspace identity for folders, worktrees, SSH, and WSL.

### Phase 4: Agent-TUI handoff

- Implement idle native-to-TUI and TUI-to-native transfers for one provider first.
- Add stage persistence, fence enforcement, idempotent recovery, process-exit proof, and
  cross-client status.
- Validate real conversation continuation in both directions over multiple cycles.
- Enable the second provider only after it passes the same contract.

### Phase 5: Default and cleanup

- Native chat stays opt-in at session creation on every platform; no default flip without
  an explicit later product decision (2026-08-08).
- Measure handoff failures, recovery, unknown outcomes, and legacy PTY sends.
- Remove PTY composer workarounds only after supported-session usage has migrated.
- Keep terminal-only agents as a supported product mode rather than forcing a lowest-common-
  denominator adapter.

## Acceptance Criteria

The architecture is ready when:

- a mobile prompt is acknowledged by the agent-session host rather than a PTY write;
- disconnect and reconnect recover without duplicate or missing timeline items;
- approvals, questions, cancellation, images, and session options use structured operations;
- desktop and mobile observe the same owner, status, and canonical history;
- a supported idle session can complete native → TUI → native cycles without replaying a
  prompt or duplicating tool work;
- the old process is proven stopped before the new owner accepts input;
- a host restart re-enters the persisted handoff stage it left and never produces two writers,
  and an unverifiable process identity ends in manual recovery rather than a second owner;
- a submission whose outcome was unknown at crash time is reconciled against provider history
  by identity and never re-sent on the user's behalf;
- two clients answering one approval produce one provider callback;
- clients without `structuredAgentSession` see no structured session and no dangling active-tab
  pointer;
- a failed handoff returns to one recoverable owner;
- unsupported or older hosts degrade to terminal sessions without hanging;
- the flow works for folder workspaces and git worktrees;
- the provider runtime and TUI execute on the correct native, WSL, or SSH host;
- macOS, Linux, and Windows launch paths avoid shell-specific command construction;
- mixed-version client/host behavior is covered by cross-version tests. The existing
  cross-version harness covers only the terminal stream; agent-session publications need
  their own coverage.

## Decision

Build native chat as a host-owned structured agent session. Keep workspace terminals
available at all times. Treat the real agent TUI as an optional, provider-qualified runtime
handoff that is allowed only when Orca can prove a single owner and a durable resume path.

This produces a reliable native chat without abandoning the terminal-native workflow that
existing Orca users value.
