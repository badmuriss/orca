# Native Chat Structured Runtime — Rollout Plan

Status: ACTIVE — Track 0 COMPLETE 2026-08-06 (all three workers reported; results merged into
the design doc). Design: [`native-chat-tui-handoff.md`](./native-chat-tui-handoff.md)
(revised 2026-08-06, now 850+ lines incl. durability contracts + spike-verified provider
gates). Verdict: GO, phased (report: `~/orca-qa/native-chat-tui-handoff-verdict-2026-08-06.html`).
Codex adversarial review: go-with-changes, run_41c95564460d. Track 0 run: run_193f44f7079b.

## Track 0 results (2026-08-06)

- 0a DONE — design doc revised in place: persisted lease contract (CAS acquisition,
  proven-dead vs fenced-out, host-restart reconciliation, durable monotonic fence), journal
  crash boundary (WAL row, receipts, unknown-outcome reconcile-by-identity), mixed-version
  projection = structured sessions INVISIBLE to non-capable clients, five persisted handoff
  failure stages, four-field mutation envelope + item-revision CAS.
- 0b DONE — Codex cross-runtime resume PROVEN on 0.146.1 (single rollout, TUI turns fully
  reconstructed). Item ids NOT stable across resume → key `(threadId, turnId, ordinal)`.
  Dual-open = silent divergence (no lock/error) → lease is the only guard. `turn/interrupt`
  ack + `thread/fork` confirmed (forked turns keep original turn ids). Evidence:
  `~/orca-qa/codex-spike-t0b-20260806/`.
- 0c+ DONE — Claude cross-runtime round trip PROVEN live (2026-08-06 coordinator test:
  headless create → real TUI `--resume` recalled state → headless resume saw the TUI turn;
  one session id, one transcript, 29 records). Claude resume KEEPS session id (no silent fork on 2.1.220); concurrent resumes
  branch ONE transcript silently → handle keyed `(session_id, leaf_uuid)`. SessionStart hook
  proof CONFIRMED (`session_id` + `transcript_path` + `source`). `--session-id` pre-mint
  works; live-id reuse fails closed. Subscription auth inherited headless; trap: user
  `settings.json` env block re-injects gateway tokens → adapter must pin setting sources.

## ★★★ FINAL PROGRAM SHAPE (Brennan, 2026-08-11): TWO BIG PRs + gated sub-PR loop

- **Big PR Codex = #13438** (base MAIN, full stack diff). **Big PR Claude = #13584** (base =
  the codex branch; retargets to main after codex merges). Mid-stack PRs closed as
  superseded. Brennan merges the two big PRs; nothing else reaches main from this program.
- **Every improvement lands as a sub-PR targeting its big PR's branch**, and BEFORE merging
  into the big branch it runs Brennan's v3 gate verbatim (codex review-until-clean +
  ref-oss precedent + grok QA leg w/ platform routing; skills via setup script if missing).
- **TOGGLE REQUIREMENT (checklist item 9): chat mode ↔ terminal mode for structured
  sessions, both providers** — the doc's handoff machinery (idle-gated, proof-before-
  ownership, one-recoverable-owner). While the TUI owns, the chat view renders via the
  existing bridge machinery = exact pre-migration behavior. Legacy sessions' instant
  toggle untouched. Codex toggle sub-PR in flight; Claude toggle follows on its branch.
- Full parity bar: EVERYTHING from before the migration works when done.

## ★★★ COMPATIBILITY POLICY (Brennan, 2026-08-13; gpt-5.6-sol xhigh review: AGREE)

- **Big PRs 13438/13584 ship the backcompat AS BUILT**: capability-gated graceful
  degradation (`agent-session.structured.v1`) — old clients see no structured sessions
  (vault listing projected per caller, session-tab projection capability-aware) and
  legacy resume of structured-owned sessions is refused through the lease. No change.
- **FUTURE structured-chat iterations: per-feature UPDATE GATE, opt-in per change** —
  "Update Orca on <named device>" banner instead of capability negotiation — but ONLY
  where a truthful fallback or read-only view is impossible. Trivially-compatible
  changes (new optional fields) never gate.
- **Update-gate primitive** (own small PR to main, AFTER Brennan's device tests + both
  merges; Brennan approved 2026-08-13):
  - Gate on a **named feature generation**, never app version (backports, flags,
    unpackaged builds, and independently installed SSH services make version a poor
    proxy; version strings are banner copy only).
  - **Never strand active sessions**: stamp required reader/writer generations at
    session creation; grandfather existing sessions; block only the new mutation or
    creation that needs the generation — history/export/recovery stay readable.
  - **Bootstrap soak window**: graceful degradation remains the fallback until both
    endpoints understand the update-required envelope. The global protocol floor
    (`MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION`) stays an emergency kill switch only.
  - Banner names WHICH side to update (client vs host) + install mode (App Store /
    desktop updater / manual service update on SSH hosts).
- **Lease/fencing is permanent and orthogonal** — it adjudicates concurrent writers
  (bare CLI resumes, crash/retry races, handoff), which no update policy covers.
- Fast-follows flagged by the review (either policy): visibility telemetry so hidden
  structured sessions don't read as lost work on stale devices; legacy fallback stays
  CREATE-ONLY (never attach an old client to a structured session).

## ★★ FULL-SWITCHOVER ACCEPTANCE (Brennan, 2026-08-11): ONE bar, ONE gate, ONE build

- **2026-08-14 HARD QA-RIG RULE (from the CODEX_LB_API_KEY miss)**: the FINAL build-gate leg
  must run the PACKAGED ad-hoc build launched from Finder (launchd env), not dev-launched
  Electron. Dev Electron inherits the QA shell's env (gateway keys present) and structurally
  cannot catch launch-context bugs; terminals mask them via login shells; only adapter-spawned
  children expose them. Dev-Electron QA remains fine for inner loops.
- **2026-08-13 additions to the QA matrix** (from teammate mobile 0.0.43 feedback,
  Slack C0AK2T3JEF4/p1786581810138399): (a) LIVE mobile model-set on a structured codex
  session (pick model + effort from the mobile option rows, verify applied on the host —
  wire/tests verified, never yet live on the sim); (b) confirm the two bridge-era mobile
  failure modes are absent on structured sessions: model pick requires no terminal, and
  a send never leaves the chat silently stuck on a hidden TUI prompt. Bridge-world
  "terminal misclassified as claude chat" tracked separately (legacy inference bug; the
  structured path eliminates the mechanism; legacy persists until Phase 5).

**No further ad-hoc builds until every item passes in a single verified state. "Everything
should work as per usual for the native chat" — both platforms, both paths.**

Checklist (each item verified by the unified gate's QA, evidence attached):
1. Desktop BRIDGE chat: send/stream, ask cards, approvals, model picker (doorway flow),
   effort, slash commands (typed + truthful Ran chips), images, Stop, load-earlier —
   behaves exactly as pre-program plus the merged fixes. Dropdown menus never clip.
   [2026-08-11 Brennan on build 3: flicker GONE, regular chat "looked solid" — the flicker
   was main's renderer churn, fixed by the perf fleet and inherited via the main merge.
   Remaining known: dropdown clipping (fix in flight).]
2. Desktop STRUCTURED chat (part D): the SAME chat view over structured sessions — opt-in
   create on desktop, send/stream, cards live-resolve, hydrated model/effort via setOption,
   paged history, reconnect; shared client logic hoisted to src/shared (mobile re-imports);
   status projection into sidebar/cards.
3. Mobile BRIDGE chat: post-13685 behavior verified (picker doorway, typed slash).
4. Mobile STRUCTURED chat: the already-GO surface re-verified at the final tip.
5. Account switcher: structured create honors selected account (both providers), bridge
   unchanged.
6. Session history: AI Vault listing + reopen/continue incl. after host restart.
7. Backcompat VERDICT SAFE (update order either way) — hard requirement.
8. No NEW perf regression vs a same-day main baseline (main's own renderer/typing
   regression is tracked by the perf fleet and excluded from this bar, but the delta vs
   main must be ~zero).
Sequence: finish+verify part D against its full brief → land dropdown-clip fix → one
candidate tip → ONE unified adversarial gate + comprehensive two-platform QA → ONE build →
Brennan's device pass = merge readiness for the whole stack.

## ★ CLAUDE RC FINAL (2026-08-10): v3 gate CLEAN + QA R3 GO — cut the build

- **RC: `brennanb2025/claude-structured-mobile` @ `2729ec02f3`** (PR #13584 tip; stack
  #13569 → #13578 → #13584 on the codex tip).
- Cleared by the v3 gate (CLEAN with lifecycle/mixed-version/prompt-decoding fixes) + QA
  GO: create via SessionStart proof (~3-5s), send/stream, question AND approval cards
  tap-resolved, colon/comma free text, attachment-only Stop, model setOption next-turn,
  Claude/Codex no-bleed. Evidence on PR #13584.
- Disclosed: effort picker only PARTIALLY validated (check it on device); auth-policy
  question still PARKED with Brennan (blocks merge, not the RC test); silent auth stalls
  now surface as durable refusals with a 10s bound.
- Root-caused en route: Claude defers system/init until the first user frame —
  SessionStart is the pre-turn proof (as the design doc originally specified).

## ★ CODEX RC FINAL (2026-08-10): v3 gate CLEAN + QA GO — cut the build

- **RC: `brennanb2025/codex-structured-mobile-write` @ `42df910d9b`** (PR #13438 tip).
- Cleared by Brennan's v3 template verbatim: review-until-clean with ref-oss precedent
  check (final round fixed chunk ownership, provenance, replay ordering, crash-safe
  reservations, blob-before-row persistence, stale pre-spawn proof) + grok QA GO 7/7
  (create, send/stream, LIVE approval resolve, cancel, image attach, bg/fg reconnect with
  host burst). Evidence + screenshots on PR #13438.
- Disclosed for the device test: sidebar/status projection deferred to part D (desktop
  surface); ask-user question cards work only in provider Plan mode (upstream policy);
  SSH/WSL opt-in gated off this slice.
- Claude lane: create-fix verified live; QA round 3 completing the remaining checklist.

## RC READY (2026-08-11, superseded by the FINAL above): earlier staging notes

- **RC branch: `brennanb2025/codex-structured-mobile-write` @ `5435cf7257`** (PR #13438 head;
  full stack A→B→C1→C2 beneath it). Cut the ad-hoc build from this.
- Cleared by: 6 adversarial review rounds (findings 6→12→10+1→10→7→2→VERDICT CLEAN) + grok
  QA GO on the paired iOS path (create → live chat tab → send/stream → cancel → 12s bg/fg
  reconnect with journal intact). Evidence on PR #13438.
- **RC BAR EXPANDED (Brennan, 2026-08-10): full Orca-Codex integration parity, not just
  chat widgets.** In scope before the RC ships: account switcher (structured create honors
  the selected managed CODEX_HOME; record pins it; rollout bridge still works), agent
  session history (AI Vault listing + reopen/continue incl. after restart), sidebar/status
  integration (structured sessions have NO hooks — cards/status rows must still reflect
  working/idle/attention), rate-limit surfaces (app-server account/rateLimits/read), and
  any other TUI-wired codex feature (trust grants, quick commands, orchestration
  targeting). Parity audit 2 covers these; fixes route into the stack before the RC.
- **Round-6 queue (from parity audit 2, 2026-08-10) — RC-blocking:** selected-account
  correctness (structured create must honor the account switcher; record already pins),
  status projection (journal working/idle/attention → sidebar cards/status rows; no hooks
  exist for structured sessions), restart continuation (shared with round 5). **Proposed
  disclosed-knowns (not RC-blocking, Brennan to confirm):** quick-command targeting,
  orchestration dispatch targeting structured sessions, WSL/SSH (already deferred).
- **Ask-user cards: provider policy, not our gap** — codex 0.146.1 permits
  request_user_input only in Plan mode by default (Default mode needs a provider flag).
  Our card/reply path is wired and tested; document in the PR, revisit when provider
  broadens.
- **FINAL READINESS GATE (Brennan, 2026-08-10): when the codex slice is ready (rounds 5+6
  landed), run ONE new codex agent with his v3 template verbatim (see
  merge-gate-codex-review-template memory): review-until-clean + ref-oss precedent check
  ("standard, senior-dev-level fix, nothing hacky"), then that agent orchestrates the grok
  QA leg (electron screenshots / mobile emulator / windows-remote / ssh-linux as
  applicable). Only after ITS clean+GO does the RC pointer go to Brennan.**
- Device-test focus (things QA could NOT fully exercise): resolve a LIVE approval card
  (QA's run auto-approved); long-conversation backward pagination under real scroll; your
  real workflows (images, options, multiple sessions).
- Disclosed known items (non-blocking, tracked for the D round): per-physical longevity,
  bootstrap retry, migration cursor refresh, authoritative structured-tab close (all C1
  P2 class). SSH/WSL chat opt-in deliberately gated off this slice.
- Part D (desktop parity) + Claude slice queue behind your verdict.

## RELEASE STRATEGY (Brennan, 2026-08-09): NO merges yet — RC-from-branch testing

- Integration base: `brennanb2025/native-chat-structured-base` (worktree
  `native-chat-structured-base`, child of finback in the sidebar) = fresh main + #13084 +
  #13085 merged (conflict-free), pushed. Wave-3 PRs target THIS branch, not main.
- After wave 3 lands on the base: `codex-structured` and `claude-structured` branches stack
  on it; Brennan cuts an ad-hoc RC from each and tests on device before anything merges.
- MERGE-TIME CAUTION (for later): this is a stack — when merging to main, land in order
  (#13084, #13085, then a base/wave-3 PR, then providers) or re-cut; repo squash-merges
  break stacked children (retarget FIRST). The base branch must be refreshed from main
  before cutting RCs if main has moved materially.

## Wave 3 — DISPATCHED 2026-08-09 (run_7f076f099104)

- 1b lease enforcement: worktree `native-chat-1b-lease-enforce` (child of base),
  task_b4dc0300ded6, ctx_fedb280a48c4, opus. PR → structured-base.
- 1d agentSession wire (+ paged history + rehydration recovery + cross-version tests):
  worktree `native-chat-1d-wire` (child of base), task_b2ca22a0a274, ctx_3ca843c4fa9a,
  opus. PR → structured-base.

## Wave 2 — COMPLETE 2026-08-07: both PRs gate-cleared, CI green (merge DEFERRED per
release strategy above; PRs stay open as review artifacts)

- **PR #13084** (1a session store + persisted lease): 95→115 tests after the gate review's
  hardening commits (cross-process CAS locking, stale-probe replacement-owner race,
  fail-closed recovery, `__proto__` record loss, collision-free handle chains). Adversarial
  passes until CLEAN; Electron CDP validation + no-screenshot rationale on the PR. 42/42
  checks green, mergeable.
- **PR #13085** (1c canonical journal): 87→106 tests after nine adversarial passes fixed
  durability/fencing/compaction/cursor/replay/idempotency/bounds defects. CLEAN verdict;
  screenshots-inapplicable comment on the PR. 42/42 checks green, mergeable.
- Merge order: either first; no file overlap. After BOTH land → wave 3: 1b (lease
  enforcement at PTY write choke points) + 1d (agentSession.* RPC + capability +
  cross-version harness), briefs to be written against the landed shapes.

## Wave 2 dispatch record (run_eb4c1e7ba2d8)

- 1a session store + lease: worktree `native-chat-1a-session-store` (branch off MAIN),
  task_7b4b87f3bc84, dispatch ctx_cc8ebadeadc3, opus. PR to main via template.
- 1c canonical journal: worktree `native-chat-1c-journal` (branch off MAIN),
  task_06c547215961, dispatch ctx_309ccd0a6dd9, opus. PR to main via template.
- Both briefs mandate /ref-oss with the secrecy rule and coordinate-by-contract (no
  cross-dependence on each other's code; 1d joins them).
- UX decisions from the 2026-08-06 mock are pinned in the design doc ("Handoff UX
  decisions" subsection). Strategy: walking skeleton after wave 2 — next is 1b + 1d, then
  a Codex vertical slice (adapter + minimal read path) before broadening flows.

Parked for Brennan: land PR #12503 host-ask-executor as bridge hardening; start the Claude
subscription-auth policy conversation (org toggles can kill the SDK lane — seen live
2026-08-06); freeze non-P0 bridge polish.

Wave 3 after review gate: 1b (lease enforcement at PTY write choke points) + 1d
(agentSession.* RPC + capability + cross-version harness).

## Conformance audit vs reference cohort (2026-08-09) — folded into scope

CONFORMS (keep): RPC surface near name-for-name; capability-gated invisibility; long-lived
app-server child per session; epoch+seq cursors w/ enumerated reset reasons;
pending/accepted/rejected/unknown dispatch states; client-message-id dedup; one reducer;
provider-derived composite identity keys.

DOCUMENTED DEVIATIONS (justify in PR bodies, do not "fix"):
- File-based journal/store instead of the cohort's SQLite+WAL — Orca ships NO sqlite dep,
  has a glibc-floor packaging constraint, and atomic-rename JSON is the repo's own idiom.
- Per-session lease/fence instead of a whole-store single-instance lock — the lease exists
  for the chat↔TUI handoff, which no cohort product ships.
- Blob store + tombstones are richer than the cohort's truncate-with-flag + status enums —
  built/tested/reviewed; optional simplification fast-follows, NOT merge blockers.

MISSING STANDARD PIECES → now required scope:
- 1d REQUIREMENT: paged history fetch (cursor + limit + direction); subscribe alone would
  make mobile pull whole journals (also violates the payload-diet rule).
- Wave 3 REQUIREMENT: provider-history rehydration as the journal recovery path (journal
  unreadable/corrupt → re-read provider history via the legacy-import machinery, open a
  fresh epoch). Universal in the cohort.
- Phase 2 scope: prompt queue/outbox with bounded retry (not a bare send); attachments
  reuse the existing chunked upload RPCs.

## Ground rules

- **Agent choice (Brennan, 2026-08-10): CODEX for implementation AND review going forward.**
  New implementation dispatches use `--agent codex` (the in-flight Claude author finishes
  PR B, then retires; C1 onward are fresh Codex workers reading TRACK.md + the stack state).
  Review leg stays codex; QA leg is grok per the gate below.
- **Gate per stack PR (Brennan, 2026-08-10): TWO agents before compose/merge.** (1) Codex
  reviewer: subagents-until-clean template + ref-oss allowed, fixes pushed (or posted, on a
  shared stacked branch). (2) Grok QA agent: electron + screenshots to the PR; mobile
  changes → mobile emulator QA; windows/wsl changes → worktree on the Windows remote host
  (low spec) + electron there; ssh/linux → ssh into a linux box. Skills from the Orca
  store; run the setup script if a skill is missing on the QA host.
- **Standard-solution rule (Brennan, 2026-08-08): do what the reference cohort does.** Every
  wave brief mandates studying the routed ref-oss repos BEFORE designing; any deviation from
  cohort practice must be named and justified in the PR body. A conformance audit of landed
  shapes runs before each merge wave. (Secrecy rule always applies: no reference names in
  any artifact.)

- Every part runs as a supervised Opus worker in its own child worktree with a part brief
  (`TRACK.md`) at the worktree root. Coordinator merges results forward.
- Phases ship independently behind `structuredAgentSession` capability negotiation; the PTY
  bridge remains for legacy sessions and unsupported agents (Grok, OpenClaude) throughout.
- Phase 4 (chat↔TUI handoff) stays gated on the empirical provider proofs; `thread/fork`
  (native in Codex app-server 0.146.1) / `--fork-session` (Claude 2.1.220) is the fallback lane.

## Track 0 — prerequisites (wave 1, parallel)

| Part | Worktree | Deliverable |
|---|---|---|
| 0a Spec pass | `native-chat-t0a-spec` | Design doc revised for the 4 review blockers: persisted lease contract, journal crash boundary, mixed-version projection decision, failure-stage state machine + per-mutation idempotency fields |
| 0b Codex spike | `native-chat-t0b-codex-spike` | Empirical verdict: cross-runtime resume app-server↔TUI, item-id stability across reconstruction, dual-open behavior, live turn/interrupt ack |
| 0c Claude spike | `native-chat-t0c-claude-spike` | Empirical verdict: session-id chain across resume/fork, SessionStart hook payload on resume (proveTuiResume mechanism), subscription-auth inheritance headless |
| 0d Host-ask executor | (in flight, `sta-3333-host-ask-executor`) | Already-built Phase-1 groundwork lands as bridge hardening |

## Phase 1 — agent identity (after 0a; mostly sequential)

- 1a Durable session store: persist session record (identity, workspace/host, provider handle
  CHAIN, pinned account home, owner) extending `ensureAgentSession` + HMAC claim.
- 1b Persisted lease + generation fencing enforced at the PTY write choke points
  (`terminal.send`, renderer IPC write, plugin sends).
- 1c Canonical journal: append store, one reducer, epoch/seq cursors, client message ids,
  acceptance receipts; legacy import via existing transcript readers.
- 1d `agentSession.*` RPC + capability + old-client invisibility + cross-version harness
  extension (existing harness covers the terminal stream only).

## Phase 2 — structured chat (after 1d; per-provider vertical PRs)

**PR + release shape (Brennan, 2026-08-09): Codex support and Claude support are SEPARATE
PRs, and each must be independently AD-HOC RELEASABLE — Brennan cuts a build from the branch
and tests it himself on device before merge. Consequence: each provider PR is a full
vertical slice (adapter + agentSession wire usage + opt-in entry point + mobile UI on the
one reducer), not a host-only module. MOBILE IS THE PRIMARY PROOF TARGET — it has to work
properly on the phone, not just in desktop dev. A ref-oss mobile survey (mobile/remote
routing) feeds the mobile client brief: reconnect/background/pagination/receipt patterns
from products that ship real mobile clients.**

### Mobile client requirements (2026-08-09 survey of shipped mobile agent clients)

1. Background-duration threshold: backgrounded ≥ ~10s ⇒ assume the socket dead, tear down
   and reconnect immediately, skipping the first backoff rung; shorter ⇒ probe.
2. Epoch invalidates the cursor; sequence resumes within it (our design already). Refinement:
   an in-flight older-page fetch under a stale epoch is DISCARDED, never merged.
3. Reset reconnect backoff on stream longevity (>5s alive), never on connect alone.
4. Two-stage delta coalescing: host batches token deltas into item snapshots (~60ms), client
   re-batches (~48ms); lifecycle and turn-boundary events bypass both stages.
5. Backward-only pagination, 40–50/page, maintainVisibleContentPosition + a latching loader
   state machine; dedicated Android workaround (inverted lists ignore
   maintainVisibleContentPosition) and momentum-scroll guards.
6. PERSISTED outbox surviving app restart, single in-flight dispatch, editable while queued;
   delivery-unknown renders as "unconfirmed", NEVER as failure, and never deletes the bubble.
   Retries always carry the client message id (no text-heuristic reconciliation, ever).
7. Push carries the approval: actionable category + deep link into the specific request,
   presence-gated so a foregrounded phone isn't spammed; presence must never gate delivery
   correctness. Decide the web/PWA notification story explicitly.
8. Attachments: on-device downsample + quality ladder before upload, chunked transfer (we
   have the RPCs); never uncapped base64 frames.

- PR "codex-structured": long-lived app-server session transport (existing client is
  short-lived request-scoped), journal feed, mobile opt-in create + send/subscribe/cancel/
  approvals/paged history, outbox with bounded retry.
- SCOPE DECISIONS (2026-08-10, C1 Q&A): agentSession.create gains a backward-compatible
  intent form {worktree, agent} — host resolves location/account home and mints the provider
  handle (clients NEVER author host paths or handles; fixes a 1d contract flaw). Chat opt-in
  is gated OFF for SSH/WSL locations in this slice via an adapter-capability check (not a
  location-kind list); remote execution is a recorded deferral required before Phase-5
  rollout, not a design change.
- PR "claude-structured": Agent SDK adapter (gated on 0c results + auth-policy answer;
  `settingSources` parity), same client surface.
- Then: desktop on the same reducer; option pickers → `setSessionOption`; attachments reuse
  the existing chunked upload RPCs.

## Phase 3 — workspace terminal alongside chat (deferred until the vertical slice proves
chat-mode usage; it is a SHELL beside a chat session, not the agent TUI — complementary to
phase 4, not redundant with it)

## Phase 4 — handoff (GATED on per-provider proofs) · Phase 5 — rollout + cleanup (last)

**DEFAULT DECISION (Brennan, 2026-08-08): native chat is OPT-IN at session creation on every
platform — new Codex/Claude sessions keep opening in the terminal as today. No default flip
without an explicit later decision. Consequence: the TUI→structured import path is a
first-class entry point, not an afterthought.**

## Estimates (Codex review, assumes reference-implementation cribbing)

Ph1 6–9 ew (high) · Ph2 14–20 ew (high) · Ph3 2–4 ew (med) · Ph4 10–16 ew (high, gated) ·
Ph5 4–7 ew (med). Committed core (1–3): ~22–33 ew.

## Confirmed by zero-cost probes (2026-08-06, installed binaries)

- codex 0.146.1 app-server: `thread/start|resume|list|archive|fork`, `turn/start|interrupt|steer`,
  all approval request types, `account/*`, `model/list`.
- claude 2.1.220: `--resume`, `--fork-session`, `--session-id`, `--continue`.
- Item identity anchors exist in both stores: rollout records carry `id`/`turn_id`/`session_id`;
  Claude transcripts carry `uuid`/`parentUuid`/`sessionId`.
