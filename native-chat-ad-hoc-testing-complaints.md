# Native Chat Ad-Hoc Testing Complaints

Collected from the ad-hoc release testing feedback on 2026-08-24.

These complaints, constraints, and release rules apply equally to the Codex and Claude native-chat restructures.

## Observed failures

- Repeated ad-hoc builds have been unusable in basic manual testing.
- A new Codex TUI session appeared not to spawn or render anything after the first interaction.
- A second attempt produced a failure switching the session to structured chat:
  `Couldn't resume chat — the agent terminal still owns this session`.
- The failure was visible within seconds of opening a worktree and trying the basic flow.
- Code review and focused unit tests did not catch the catastrophic end-to-end failure before an ad-hoc build was handed back for testing.
- A real Electron CDP run reproduced the same class of failure on this branch: native Codex chat answered a prompt, native → TUI adoption succeeded, and native → TUI launch then opened a Codex terminal whose `thread/resume` immediately failed with `already has an active writer` before returning to the shell.
- The failed launch was not an ordinary provider refusal: the durable flow had attempted to transfer ownership, but the new TUI could not prove a single-writer handoff. This is a release-blocking lifecycle failure because the user sees an apparently empty/non-spawning terminal and the conversation is left needing recovery.

## Process concerns

- Fixes appear to be accumulating as patches on top of earlier patches, increasing the chance of workaround-on-workaround behavior.
- We should remove hacky code rather than layer another guard over it.
- A senior review should be able to identify structural lifecycle problems before release, not only validate isolated functions.
- The current organization and test strategy are not providing enough confidence for a release candidate.
- Reviewers and implementation agents need to discuss findings and converge, rather than independently adding narrowly scoped fixes that can interact badly.

## Requested engineering bar

- Perform a structural review of the ownership, proof, handoff, restart, and recovery state machine.
- Prefer a small, explicit design with one authoritative owner/proof path over duplicated checks and special cases.
- Add failure-injection and end-to-end tests for the flows that fail in practice, including blank TUI sessions, prompt-created rollouts, retries, restart recovery, renderer rollback, process-stop proof, and native acquisition failure.
- Validate the real Electron surface before each ad-hoc release, not only stores, RPCs, or unit-test doubles.
- Use senior-level, precedent-driven design and call out or delete anything that is merely a workaround.
- Consider splitting the work into multiple reviewable PRs when the branch contains separate conceptual changes. Splitting should follow dependency boundaries and make correctness easier to review; it must not hide unresolved defects or be purely mechanical.
- The goal is that the next ad-hoc build works in the basic user flow without requiring the user to discover immediate catastrophic failures.
- Every failed Electron validation must trigger a second question: why did the existing architecture/review/tests fail to catch this before an ad-hoc build? The follow-up must either fix the structural seam that allowed the failure or add a regression test that exercises that seam; a green rerun alone is not sufficient.
- Apply the same review and testing bar to Claude native chat; do not assume a Codex fix or review proves Claude safety.
- Do not prohibit ordinary users from actions they otherwise have access to. A refusal or capability gate is acceptable only for a developer-facing control, or after the user has gone through a clear path that explicitly opts them into an experimental feature and its limitations. Any user-facing refusal must preserve an ordinary supported fallback and must not silently strand the session.

## Ongoing instructions to retain across context compaction

- Keep working toward a genuinely usable ad-hoc release; do not stop at a green focused test run.
- Do not call a build ready when real Claude/Codex TUI cycles, the visible Electron flow, or relevant platform paths remain unverified.
- Use the available high-spec Windows machine and Linux/OpenClaw machine for platform testing when those paths are in scope.
- Run every manual Electron validation as a supervised Orca orchestration task assigned to a Grok worker. The worker prompt must explicitly invoke `$electron` and must prohibit Orca computer-use, `orca computer`, accessibility automation, and OS-level mouse or keyboard automation; if `$electron` is unavailable, report the validation blocked instead of falling back.
- Run parallel senior reviews with the requested high-effort Claude and Codex reviewers, have them use the reference-driven review workflow, and require them to discuss findings with one another.
- Review the entire branch that produced the ad-hoc build, not only the latest bug fix.
- Check whether the branch should be split into multiple PRs. If it should, define a minimal correctness slice and defer unrelated feature slices instead of shipping a tangled branch.
- Consider landing the work incrementally behind a development-only toggle or explicit opt-in capability, preserving the current Codex path while the restructured path proves itself. The toggle must be deliberate, visible to developers, and removable; it must not silently fork behavior or become permanent configuration debt.
- Do not expand scope unnecessarily, but do include refactors and tests that are required to eliminate structural defects.
- Preserve the existing user-owned rollout documents; this note is the separate durable record of the complaints and release bar.

## Release decision rule

Do not cut or present the next ad-hoc build as ready until the structural audit, failure-injection tests, focused regression tests, visible Electron validation, and reviewer convergence are complete. Any remaining unverified platform or provider path must be stated plainly rather than implied to work.

## Progress tracker

Updated during the same release effort:

| Area                                    | Status                                          | Evidence or next action                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank Codex TUI safety                  | In progress / regression covered                | A blank TUI is kept alive and reports an actionable refusal; focused handoff test passes.                                                                                                                                                                                                                                                             |
| Prompt-created Codex rollout retry      | In progress                                     | Owner re-proof now refreshes a missing rollout path before close; focused runtime and handoff tests cover it.                                                                                                                                                                                                                                         |
| Renderer rollback after failed adoption | Covered                                         | Renderer test and visible Electron proof show terminal view is restored while the durable binding remains retryable.                                                                                                                                                                                                                                  |
| Focused regression suites               | Passing with parallelism caveat                 | Handoff/runtime suites and the broader five-file sweep pass; the 47-file matrix passes single-worker (301 tests), while an unconstrained parallel run exposed two timing/cleanup failures that must be made deterministic.                                                                                                                            |
| Full desktop Vitest suite               | One load-sensitive failure under investigation  | The bounded 8-worker run completed 6,311 files: 6,268 passed, 42 skipped, and one unrelated paired-websocket test timed out after 30 seconds with its matching connection rejection (58,757 tests passed, 247 skipped). The failed file immediately passed alone, 17/17 in 553 ms; repeat/load diagnosis remains required before release.                |
| Structural architecture review          | Complete / two current P1 blockers               | Fresh Sol 5.6/xhigh and Fable/xhigh reviewers independently audited the corrected exact tree with `$ref-oss`, exchanged four Run messages, and converged: the main launch-owned proof, torn-tail classifier, forward stop, and cleanup de-patching are sound, but Windows `claude.cmd` rejects the inline settings JSON and reverse/recovery acquisition leaves `hasProviderChild` stale. Latest report: `~/orca-qa/native-chat-fable-final-convergence-audit-2026-08-25.md`. |
| Failure-injection test matrix           | Core local matrix covered                       | Dedicated handoff failure-injection coverage now covers prompt-created rollout discovery, cancellation refusal, dead `preparing` recovery, dead `new-owner-proving` recovery, and native acquisition/rollback paths; platform/process-table proof remains pending.                                                                                    |
| Visible Electron validation             | Blocked / current source repro                  | A fresh orchestrated Grok `$electron` run proved ordinary Codex TUI and terminal creation work. It also reproduced three structured blockers: direct structured create does not activate its published tab, structured-created chat has no native → TUI control, and Show terminal failed to restore the TUI after a successful TUI → native handoff. |
| Windows/Linux/WSL/SSH                   | Pending                                         | Use the available Windows and Linux/OpenClaw hosts where the provider path is supported.                                                                                                                                                                                                                                                              |
| Branch/PR split decision                | Decided: split for merge                        | Reviewers recommend PR-A shared/Codex core, PR-B handoff/recovery, PR-C Claude parity, and PR-D mobile, each against fresh main/dependency seams. The full branch may remain the ad-hoc test vehicle.                                                                                                                                                 |
| Incremental landing strategy            | Decided: use existing gate                      | Keep `experimentalNativeChat` plus provider capability negotiation; do not add a second dev-only toggle. The preview HTML was updated to reflect this proposal and remains an approval artifact.                                                                                                                                                      |
| Claude native-chat parity               | Backend proof works locally; release still blocked | A real signed-in Claude 2.1.237 launch now produces launch-owned `SessionStart` identity proof and the isolated unsigned account produces sign-in guidance. Windows file-backed settings, reverse/recovery child ownership, two sibling torn-tail retry sites, and the real resumed native → TUI → native cycle remain before parity can be claimed. |
| Next ad-hoc release                     | Blocked pending correctness and packaging proof | Fix the two converged P1s and two P2 retry gaps with failing-first tests, obtain approval before the three user-facing HTML-described changes, then run exact-tree Grok `$electron` provider cycles, lower-concurrency full tests, exact-SHA Windows/Linux/WSL/SSH validation, packaging, installation, and final Grok smoke proof. |

## Remote validation progress (2026-08-25)

- The pushed branch head `a357915cd1` is checked out through Orca CLI on the Windows high-spec host at `native-chat-validation-windows-high`. Repository setup completed. That host's running Orca app is still `1.4.186-hourly.202608200132` and does not advertise `agent-session.structured.*`, so it cannot yet prove native-chat behavior until the host app is updated.
- An Orca-managed SSH worktree was created on OpenClaw Linux at `/home/brennan/orca-native-chat-validation-openclaw-ssh` at the same branch head. The SSH worktree was created successfully; remote runtime terminal control still needs a live SSH/Orca runtime connection before Electron proof can be claimed.
- The supervised Grok Electron-validation dispatch completed through `$electron` and Playwright CDP only. It verified the exact source-backed branch, ordinary Codex TUI launch, ordinary terminal creation, structured Codex send, and the structured activation/return failures recorded below. The report is `/tmp/orca-electron-validation-task_beaa8f49b897/report.md`; it did not claim remote platform proof.

## Latest implementation progress (2026-08-25)

### Electron follow-up: why the previous tests missed the failure

- The latest supervised `$electron` run found a new release-blocking seam: the host proved TUI ownership and created a live Codex PTY, but the renderer filtered the TUI surface out before its in-memory binding was recorded. The user therefore remained on native chat, and closing the native tab left the unpublished PTY alive.
- Existing tests missed this because they tested projection after a binding already existed and tested the handoff state machine without the asynchronous ordering between host publication, renderer binding, activation, and close. A green unit suite was therefore not evidence of a visible end-to-end surface.
- Required correction: make the binding/publication ordering explicit and idempotent, add a composed test where the terminal snapshot arrives before binding, and add a close test proving an unpublished/retained TUI owner cannot leak. A passing rerun without those tests is insufficient.
- Follow-up implementation is now in the shared tree: the renderer records the binding as soon as the host first publishes the terminal identity and refreshes the exact host tab snapshot before activation; host close explicitly stops a retained TUI owner with exit proof before releasing its lease. Focused race/close/projection suites pass (30 tests in the latest combined run; formatting and Node/web typechecks pass). A fresh visible Electron rerun is still required; this does not yet make the ad-hoc release ready.

- Claude close/persist failure now preserves the live provider session until its durable handle is saved. A failed persistence attempt no longer deletes the in-memory session or closes the provider, so the native owner remains retryable and the handoff checkpoint stays recoverable. Adapter and flow-level regression tests cover this boundary.

- The fresh Electron failure was narrowed further: failed TUI launch cleanup waited on a terminal
  handle after `closeTerminal` could retire that handle, turning a stopped PTY into a false
  `StructuredTuiLaunchCleanupError` and leaving native ownership reported as unrecoverable.
- The launch path now uses the existing PID/start-time-safe structured exit proof after cleanup;
  it falls back to PTY exit proof only when provider process identity was never published. A focused
  regression covers the stale-handle cleanup race and passes with the router/handoff suites.
- This is a lifecycle correction, not a user-facing redesign. The rollout preview remains the
  approval artifact for any future copy, fallback action, toggle, or presentation change.
- The real Electron cycle must be rerun against this rebuilt source. The prior fresh profile run
  created native Codex successfully, but the test prompt invoked a long-running provider turn;
  the handoff was correctly refused while that turn remained running, so no new clean cycle is
  claimed yet.

## Latest visible Electron validation (2026-08-25)

- A source-backed Electron instance was verified as
  `brennanb2025/native-chat-restructure-recovery` on CDP port 9350.
- Creating a normal workspace terminal through the rendered UI and entering `codex` visibly
  launched Codex v0.149.1 to its interactive prompt in the target worktree; evidence is
  `/tmp/orca-native-chat-codex-launch.png`.
- This confirms ordinary terminal creation/provider startup on the current source. It does not
  prove native chat ownership transfer, a clean native → TUI → native cycle, Claude, or any
  Windows/Linux/WSL/SSH path.

## Latest direct-launch reproduction (2026-08-25)

- With `experimentalNativeChat: true` and `openAgentTabsInChatByDefault: true`, the rendered
  New tab → Codex action creates a durable structured Codex session and projects a new `Codex
Chat` tab, but the previously focused terminal remains active. The structured tab is present
  in `unifiedTabsByWorktree` while `activeTabId` still points at the terminal.
- This is the direct equivalent of the user's report that the first click “didn't spawn
  anything”: the work was created but the user was not taken to it. It is release-blocking
  because a successful provider launch is indistinguishable from a no-op in the visible UI.
- The intended correction is to activate the exact newly created structured tab after the
  session publication is observable, with a test that proves both durable creation and visible
  activation. This is a user-facing behavior change and is gated by the rollout-preview approval
  rule before source changes.

## Latest live Electron reproduction (2026-08-24)

- Dev app identity was verified as `brennanb2025/native-chat-restructure-recovery`.
- Through the real Electron surface, a worktree was opened, a Codex TUI was adopted into native chat, a native prompt returned the expected response, and native → TUI was requested.
- The launched TUI printed `thread/resume failed during TUI bootstrap: thread ... already has an active writer (code -32600)` and the PTY returned to `zsh` with no child process.
- Evidence captured during the run: `/tmp/orca-native-chat-validation-codex-spawn.png`, `/tmp/orca-native-chat-validation-codex-prompt.png`, `/tmp/orca-native-chat-validation-toggle.png`, `/tmp/orca-native-chat-validation-chat-response.png`, and `/tmp/orca-native-chat-validation-return-terminal.png`.
- The reproduction establishes that unit-level shutdown/lease tests are not enough: the release gate must observe the provider writer being gone before TUI `thread/resume` is sent, and must cover launch failure recovery through the visible Electron path.

## Structural audit findings (release blockers)

The high-effort review has confirmed that the repeated failures are structural, not just missing one guard:

- Claude restart recovery can wedge after the conversation leaf advances because recovery expects a stale leaf identity.
- A crash between closing the old owner and persisting the stopped stage can strand a session with no valid recovery path.
- The original Codex rollout guard checked a stale owner field before re-proving or re-resolving the live rollout, so “send a prompt and retry” could never heal in-session.
- Structured tab session identity is not safely persisted through the workspace schema, allowing restart to fall back to the wrong presentation/runtime.
- The cross-version agent-session wire suite is present but not included in the CI job that runs the related terminal wire tests.
- Windows process liveness probing and child teardown need to follow the host process-table and job ownership boundaries; the current paths risk per-PID shell churn and orphan/reaped children.
- Lease renewal can fail closed for every session when one poisoned record is encountered.
- Claude dispatch echo matching can bind a send to the wrong user-shaped frame during tool activity.
- Failed Codex cancellation can leave a turn permanently blocked.
- Fingerprint canonicalization rules can drift between client and host.

These findings are now the authoritative blocker list. They must be fixed, deleted, or explicitly excluded by a reviewed incremental rollout plan; adding more one-off guards is not an acceptable resolution.

## Latest progress (2026-08-24)

- Claude restart recovery no longer compares a live TUI against a frozen leaf UUID. Reproof reads the authoritative transcript leaf, returns a new resumed provider link, and the durable record persists it before recovery or handoff continues.
- Restart recovery now handles a dead TUI in `preparing` and `new-owner-proving` by committing a safe old-owner-stopped/abandoned stage and continuing the existing handoff operation instead of wedging on the recovery-only transition.
- The renderer records the structured provider on the tab, refuses to render a structured session with unknown provider identity, and uses a stable local target object. Claude no longer inherits a hardcoded Codex catalog.
- Claude dispatch replay waiters ignore top-level user frames made entirely of `tool_result` blocks.
- Mobile advertises the Claude structured capability and its session-tab model accepts both structured providers. Mobile typecheck and targeted transport/task tests pass.
- A full single-worker native-chat/Claude/runtime sweep passed 133 files, 1,096 tests (two skips), with the credential-dependent real Claude CLI handshake excluded. The credential-dependent test still needs a signed-in account to run.
- The restart recovery helper was split out to keep both modules under the repository max-lines ratchet.
- The PR cross-version wire job now runs the agent-session journey alongside the terminal journey instead of silently excluding it from CI.

## Failure-injection review progress (2026-08-24)

- Added a composed retry test for a Codex TUI that starts before its rollout is flushed, then creates the rollout after a user prompt; the next native handoff must discover the new durable path.
- Added restart tests for a dead TUI in both `preparing` and `new-owner-proving`; recovery now proves the old process stopped before retrying or restoring native ownership.
- Added a Claude restart test asserting that the newly re-proven transcript leaf is persisted before recovery is cleared.
- Added cancellation-failure coverage asserting that an unacknowledged native interrupt never launches a second TUI owner and leaves the native owner live/recoverable.
- Added a direct structured-launch failure test so the launch path produces an actionable error instead of appearing to do nothing.
- The focused handoff, restart, adoption, renderer-route, and RPC suites pass after these additions.

The structural audit still has an unresolved platform finding: `agent-session-process-identity-probe.ts` reads Windows start times by launching PowerShell per PID even though the runtime already has a centralized Windows process-table boundary. This remains a release blocker until it is moved behind that boundary or explicitly excluded from the first platform-qualified slice.

- Lease renewal is now isolated per session: one superseded/stale record cannot abort the durable renewal of every healthy session. Added sibling-failure regression coverage; focused lease suites (9 tests) and Node typecheck pass.
- Platform audit attempted the saved hosts. Windows high spec is reachable but runs an older build without `agent-session.structured.*` capabilities, so it cannot validate this branch until updated. The openclaw Linux environment was unreachable (`remote_runtime_unavailable`); no Linux/SSH proof is claimed.
- Windows process identity still uses per-PID PowerShell CIM for creation time because the native process-table module currently exposes no creation-time field. Replacing that path requires a separately reviewed native/API change; it remains a release blocker for full Windows handoff proof.

## Claude review additions (2026-08-24)

- Claude dispatch replay now requires the exact outgoing user payload before accepting a provider UUID; an unrelated root-user frame can no longer settle a send. A focused stale-replay regression passes.
- Duplicate AskUserQuestion labels are disambiguated (`label`, `label#2`, …), preventing one answer from overwriting another. The adapter regression passes and is included in commit `a7933dd3e0`.
- Claude close now has failure-injection coverage: if durable provider-handle persistence fails, the child is still closed, an `ended` event is emitted, and a repeated close is harmless (committed in `9ba7fa9e99`).
- Structured terminal tabs now persist `structuredSessionId` in the workspace schema (`50e08308b8`), preventing restart from silently routing a native owner back through PTY.
- Lease renewal is per-session rather than all-or-nothing (`2a77e2d95e`); a stale sibling cannot expire healthy sessions.
- A direct structured launch failure currently produces an actionable error toast and stays out of the terminal path. Offering an explicit “Open terminal agent” action is described in the HTML proposal but is not implemented pending user approval for that user-facing change.
- The real Claude CLI handshake remains credential-dependent. Ordinary suites now require explicit `ORCA_RUN_REAL_CLAUDE_TESTS=1` in addition to an installed CLI, so a signed-out local account is a deliberate skip rather than a false release regression. A signed-in run is still required for provider proof.
- Claude structured acquisition now retries its process start-time probe and refuses to publish an owner when the probe is unreadable (`f3444db789`); the spawn token is not treated as a self-asserted identity because Claude has no verified token echo hook.
- The live Codex active-writer reproduction is traced to `StructuredAgentSessionAdapterRouter` lacking `closeSession`; `suspendNative` therefore skipped native shutdown and launched TUI concurrently. The router now routes close to the owning provider adapter, retains ownership on an unproven exit, and the host handoff refuses when no close proof exists. Added a router regression test; node/web typechecks and the focused handoff suites pass.

## New Claude branch-identity audit (2026-08-25)

- A structural review sampled 200 real local Claude transcripts. The latest `last-prompt.leafUuid` matched neither a simple latest root-user UUID nor a stable frame namespace (observed marker records included assistant, user, system, and attachment rows).
- Therefore, treating a root-user frame as the durable Claude leaf is not sufficient, and dropping leaf checks in favor of session-id-only identity would permit silent sibling-branch adoption under concurrent resumes.
- The required proof is still unresolved: close/reproof must use the provider's authoritative transcript marker and prove continuity/ancestry from the persisted branch before accepting a new leaf. This is a Claude release blocker until covered by real-transport tests and a signed-in cycle.

## Codex/Claude close-proof failure matrix (2026-08-24)

- The provider adapter contract now requires `closeSession()` to return explicit `true` exit proof. The router, native handoff, and eviction paths fail closed for `false` or an unknown result, retaining ownership for a retry rather than launching a second writer.
- Codex and Claude `closeAll()` shutdown is bounded to three attempts and reports manual-recovery failure if a child remains indexed, preventing an unbounded shutdown loop when provider exit cannot be proven.
- Focused Codex/router/eviction/handoff suites pass (73 tests); Node and web typechecks pass after the runtime narrowing fix. The full Claude adapter suite still has one pre-existing failure while the in-progress leaf refactor drops the expected persisted `prompt-leaf` to `null`; this remains a Claude identity blocker, not a release-ready result.

## Exact-head Claude audit (2026-08-24, HEAD `4fc103cd0e`)

- The focused Claude adapter, integration, and legacy-adoption suites pass (28/28), but their
  fixtures model a synthetic root-user UUID as the durable leaf. They do not exercise the real
  transcript marker shape.
- A sample of 200 real Claude JSONL transcripts found that the final `last-prompt.leafUuid`
  pointed to `assistant` (58), `system` (76), `user` (39), or `attachment` (27) records; none
  matched the latest root-user UUID. The adapter's root-user tracking and the TUI proof's
  `last-prompt` tracking therefore identify different cursors.
- This is still a Claude release blocker. Dispatch replay may use a root-user UUID as the
  per-submission item identity, but owner/handoff continuity must persist the authoritative
  transcript cursor and validate `parentUuid` ancestry (descendant accepted; sibling, missing,
  malformed, or cyclic chain refused).
- The current real-CLI handshake test expects a non-null leaf immediately after a pre-minted
  `--session-id` startup, but no user frame exists at that point; it remains credential-gated and
  has not supplied release proof.
- Exact-head review also retains these blockers: direct structured launch can publish a hidden tab
  without focus intent (visible no-op), Claude launch args lack Codex's semantic allowlist, and
  Claude's deterministic pre-minted session id has no crash/collision healing path.
- A new P0 process-proof finding applies to both provider handoff and Claude specifically: the
  Claude stream connection marks itself exited on an `error` event before `exit`/`close` is
  observed. An error is not proof that the child stopped, so an error-only failure could launch a
  second writer. A failing-first regression must keep the session indexed and return `false` until
  exit/close or an independent PID-safe host probe proves death.
- Claude's journal translator still has a separate lifecycle predicate from dispatch replay: a
  top-level `user` frame with `parent_tool_use_id: null` starts a turn even when its content is
  entirely `tool_result`. This can churn turn state during tool activity; the predicate must be
  shared and covered with a real transcript-shaped regression.

## Codex failure-matrix review (2026-08-25)

- The Codex-side failure matrix is recorded at `~/orca-qa/codex-native-chat-failure-matrix-review-2026-08-25.md`.
- The shared handoff state machine can remain provider-neutral if ownership compares a stable provider root and history reconciliation carries an advisory provider cursor. Claude's session id is the root; transcript `last-prompt.leafUuid` is a cursor and must not be conflated with a root-user item UUID or a process-owner identity.
- Current focused Claude adapter/connection/launch/journal tests pass 36/36, and Node/web typechecks plus formatting pass. These are necessary checks, not release proof: the new error-without-exit case, real transcript ancestry, and visible Electron activation/handoff cases remain to be added or exercised.
- The Claude reviewer independently reported the same root/cursor conflation, so this is now a converged structural blocker rather than a provider-specific style preference.

## Current ad-hoc release gate (2026-08-25)

- The Claude stream connection no longer treats a child-process `error` event as exit proof. An error-only child remains unproven, `close()` returns `false`, and handoff cannot launch a second writer until `exit`/`close` is observed. The regression passes.
- The malformed Windows process-table dependency patch was removed in favor of the last proven patch, and the pnpm patch hash was regenerated. `pnpm install --frozen-lockfile --offline` now succeeds.
- Fresh Grok `$electron` validation reproduced the reported first-click no-op: a structured Codex session was durably created, but the old terminal remained active. Clicking the published Codex Chat tab a second time revealed a working native chat surface and accepted a send.
- The same validation found that the newly created structured tab does not expose the intended native → TUI control. This means the advertised end-to-end handoff cycle is not reachable from that launch surface.
- The activation behavior already shown in `native-chat-incremental-rollout-preview.html` is therefore still a release blocker: the exact newly published session must become the visible active tab after create. Implementation remains pending the required user-facing approval.
- The first complete Vitest sweep is not green: 58,706 tests passed, 247 were skipped, and 12 failed across four files. The failures reproduce in a focused rerun. Eight are a broken PTY IPC test harness, two are an unaudited local structured-tab mirror-settle path, and two are worktree activation/seed expectations. These must be resolved or proven unrelated before another build.
- The latest Fable structural review and Claude-parity review are complete and both applied this complaint ledger. A fresh `gpt-5.6-sol` xhigh reviewer is now dispatched against the current tree to challenge the Fable findings and distinguish current blockers from findings already fixed after the reports' earlier SHAs.
- Current source compares Claude TUI ownership by stable provider handle root plus PID/start-time-safe process identity, so the stale full-handle equality finding is fixed. The remaining cursor gate is narrower: the transcript's authoritative `last-prompt.leafUuid` must be proven equal to or descended from the durable cursor; sibling, missing, malformed, and cyclic transcript graphs must fail closed.

## Post-review structural repair progress (2026-08-25)

- The fresh `gpt-5.6-sol` xhigh review completed with the full complaint ledger and `$ref-oss` workflow. Its report is `~/orca-qa/native-chat-restructure-senior-review-2026-08-25.md`; it independently confirmed the error/EPIPE ownership loss, Claude root/cursor conflation, and visible structured-create activation gap as release blockers.
- Codex and Claude adapters no longer delete the published session record on a transport-only `onExit`. They mark it ended so new provider operations fail, but retain the child ownership record until `connection.close()` proves process exit. A false close result remains indexed and retryable; the ended event is emitted once.
- Forward native → TUI handoff now rolls the durable `preparing` checkpoint back when provider suspension either returns `false` or throws before the native owner is stopped. This preserves one live native owner instead of latching a failed handoff stage.
- Replayed TUI adoption compares the stable provider-handle root plus persisted process identity. Claude cursor advances are accepted only after the provider-specific transcript ancestry proof; the shared adoption layer no longer reinterprets the moving leaf as owner identity.
- The four deterministic failures from the 58,706-test sweep are repaired at their actual seams: PTY IPC injection, mirror-settle receipt capture, asynchronous structured adoption in the worktree seed test, and explicit local activation ownership/readiness. The focused rerun now passes 8 files and 86 tests; Node/web typechecks pass.
- A follow-up adversarial review is active in the same Sol/xhigh session against these exact fixes. It must challenge close/acquire races, duplicate terminal events, close-all behavior, rollback correctness, and root/cursor proof before the worker is released.
- The combined post-repair verification passes Node/web typechecks and 14 focused files with 145/145 tests. The first fresh full Vitest snapshot reached 6,262 passing files and 58,718 passing tests with five failures: four were stale Claude adoption fixtures loaded before their correction, and the remaining interactive-zsh portability test passed 206/206 when rerun alone. The Claude fixtures contained only a synthetic marker with no session id or referenced graph node, unlike real transcripts; they now model a real graph and the focused adoption file passes 5/5 without weakening ancestry proof. A clean full rerun from the corrected tree is still required.
- A schema-only audit of 500 signed-in local Claude transcripts found no UUID-bearing records missing `parentUuid` or `sessionId`, and no conflicting duplicate UUID ancestry. Three of 298 latest transcript markers referenced a UUID absent from the file, so those sessions correctly remain unqualified for automatic handoff rather than being silently adopted.
- `native-chat-incremental-rollout-preview.html` now shows the exact current first-click no-op beside the proposed active-chat result, the proposed “Open in agent terminal” placement, and the visible outcome after each potential landing slice. It remains an approval artifact only; renderer behavior and user-facing copy are unchanged pending explicit approval.
- The adversarial Sol follow-up found three additional lifecycle races and they are now corrected at their ownership boundaries: provider acquisition release returns explicit exit proof and the router retains routes on `false`; router-wide shutdown clears routes only after every adapter shutdown succeeds; and provider close is single-flight for concurrent callers while a later observed exit can heal an earlier unproven result. Claude finalization emits one handle/ended pair, and cleanup of an acquisition that was never committed no longer requires a transcript marker.
- Native suspension now reports a discriminated `live`, `stopped`, or `stopped-cleanup-failed` phase. A failure after provider exit is durably recorded as released/manual-recovery and can never roll a proven-dead process back to a live native claim. Focused lifecycle coverage passes 10 files and 163 tests; Node/web typechecks pass.
- Codex and Claude connection shutdown now share one narrowly scoped retryable process-exit proof primitive instead of duplicating close-promise reset logic. Concurrent callers share one proof attempt, a proven exit remains final, and a false or rejected proof permits a later verified retry. The supported-Node changed-code quality gate, Node/web typechecks, and the focused seven-file lifecycle sweep (67 tests) pass without max-lines suppression.
- Fresh orchestrated Grok `$electron` validation on the current uncommitted tree verified that ordinary New tab → Codex TUI activates and renders, a normal terminal activates, and structured Codex can answer after manual tab selection. The same run proved that direct structured creation leaves the prior TUI active, the structured-created chat exposes no native → TUI action, and Show terminal did not restore the TUI after a successful durable TUI → native handoff. These remain release blockers; the activation/control UI is still unchanged pending approval of `native-chat-incremental-rollout-preview.html`.
- The Sol/xhigh lifecycle follow-up found four fail-closed gaps: reverse handoff discarded a false acquisition-release proof, provider acquisition catches could drop an unproven child, close-all could lose a canceled acquisition before proof, and `void task.finally(...)` created a second ignored rejecting promise. The report is `~/orca-qa/native-chat-restructure-lifecycle-correction-followup-2026-08-25.md`.
- Those four gaps are corrected at shared/provider lifecycle boundaries. Failed post-acquire cleanup now throws a typed exit-unproven result; reverse handoff persists `manual-recovery` without abandoning the observed process; Codex and Claude registries retain failed or superseded acquisition attempts until `close()` returns `true`; and flow tracking uses a two-branch settlement handler rather than an ignored `finally` promise.
- New fail-first coverage proves both providers keep `closeAll()` blocked after three false exit proofs, later cleanup can heal, and reverse TUI → native cleanup failure retains the reserved native process in durable manual recovery. The focused acquisition/handoff checks and supported-Node quality gate pass. The same Sol/xhigh worker is re-reviewing the exact correction, and a fresh Grok worker is rerunning the real `$electron` cycle.
- The clean bounded repository-wide Vitest rerun passed: 6,268 files passed, 42 skipped; 58,744 tests passed, 247 skipped; exit code 0. This includes the corrected processless-reservation fixture and leaves no full-suite test failure on the exact current uncommitted tree.
- The second full-suite attempt was intentionally stopped after these review-driven source changes made its result obsolete. Before cancellation it exposed the proven-dead retry test's one-second polling dependency under parallel load; that test now awaits the coordinator's deterministic drain barrier and passes with the 224-case live-shell file in isolation (207 passed, 18 skipped). A final uninterrupted full sweep remains required.
- No new ad-hoc build is approved yet. Remaining gates include the adversarial review, broader/full test rerun, real signed-in Claude and Codex cycles, visible Grok `$electron` validation, packaging/install proof, and honest Windows/Linux/WSL/SSH qualification.

## Latest lifecycle re-review and correction (2026-08-25)

- The Sol/xhigh correction re-review applied this full ledger and found one surviving ownership race in both providers: `closeAll()` could cancel while an acquisition had not yet published its connection, then delete the acquisition after the late connection's cleanup returned `false`. That could make shutdown observe an empty registry while a child remained unproven.
- Cancellation now uses one shared process-acquisition primitive. It closes any already-visible connection, waits for acquisition settlement, honors cleanup proof recorded by the acquisition path, and separately closes a connection that appeared during the cancellation window. Registry deletion remains conditional on explicit exit proof.
- Added fail-first Codex and Claude regressions for the exact late-connection interleaving. The two acquisition files pass 6/6 tests; the provider/router/handoff matrix passes 99/99 tests; Node typecheck passes. Web typecheck, changed-code quality, and a fresh adversarial review remain queued.
- The latest uninterrupted unconstrained Vitest run ended nonzero with widespread unrelated zero-test collection failures and resource-starvation symptoms. It is not being represented as a green full-suite result; representative failures and the native-chat matrix must be rerun in isolation or under a stable bounded harness.
- The Grok worker remains active under an explicit `$electron` prompt and the no-computer-use/no-accessibility/no-OS-input rule. Its result must be treated as source-specific evidence only; a final exact-tree Grok validation is still required after all corrections.

## Markerless-close and handshake correction verification (2026-08-25)

- The converged Sol/Fable findings were corrected at provider lifecycle boundaries rather than by weakening handoff proof. Eviction and application shutdown now use a provider disposal path that always attempts process close; handoff close retains the stronger future-resume cursor requirement.
- Markerless Claude acquisitions can be disposed without manufacturing a transcript cursor, and registry-wide shutdown continues closing sibling processes after an individual rejection. Claude launch resolution now reports the same typed pre-spawn failure class used by Codex.
- Codex handshake failure now exposes explicit cleanup ownership when child exit is not proven; the adapter retains the connection for later cleanup instead of discarding a false close result before registry publication. Child `close` is accepted as process-exit proof alongside `exit`.
- The post-correction lifecycle matrix passes 12 files with one credential-gated file skipped: 133 tests passed and two skipped. Node and web typechecks pass, `git diff --check` passes, formatting passes, and the Node 24 changed-code quality gate reports zero new findings across the branch diff.
- Fresh review-only Sol 5.6/xhigh and Claude Fable/xhigh workers are dispatched on the exact post-correction tree. Both were explicitly instructed to invoke `$ref-oss`, read this complete ledger, audit Codex and Claude equally, discuss findings with one another, and report only proven current issues. No post-correction Grok Electron result is claimed yet.

## Real-provider and full-suite evidence after lifecycle correction (2026-08-25)

- The real Codex structured-to-TUI integration passed against `codex-cli 0.149.1`: Orca created an isolated app-server thread, materialized its rollout, stopped the structured process, resumed the exact thread in the official TUI, and proved that the TUI used the same rollout path.
- The signed-in Claude 2.1.237 adapter test failed twice before first publication even though a direct stream-json `initialize` request succeeded in roughly 700 ms with the same account and unchanged `user,project,local` setting sources. The adapter additionally waits for `system/init` or a SessionStart hook event; the selected account currently has no SessionStart hook configured, and the test does not install one.
- This does not justify silently dropping user setting sources. The current unresolved question is whether production proves an acquisition-scoped SessionStart signal in the pinned `CLAUDE_CONFIG_DIR`; the optional global agent-status hook cannot be assumed, and it targets the default home rather than every pinned account root. Claude remains unqualified until that proof boundary is corrected or a different empirical proof contract is established and tested.
- The latest bounded repository-wide Vitest sweep passed 6,268 files and 58,752 tests, skipped 42 files and 247 tests, and had one failure: a large orchestration runtime test observed seven provider-buffer serialization calls instead of six. The exact failing test passed immediately in isolation under one worker. This is recorded as suite-load flakiness, not represented as a clean full-suite result; a final uninterrupted clean sweep is still required after the remaining source changes.

## Final post-correction Sol/Fable convergence (2026-08-25)

- Sol 5.6/xhigh and Claude Fable/xhigh both invoked `$ref-oss`, read the complete complaint ledger, audited the exact post-correction tree, exchanged findings, and converged. Fable's report is `~/orca-qa/native-chat-final-fable-rereview-2026-08-25.md`.
- Both reviewers marked the five targeted lifecycle corrections GO: disposal versus handoff close is a principled caller-intent boundary; markerless Claude disposal always attempts process close and continues siblings; Codex handshake failure retains explicit cleanup ownership; process exit proof still requires child exit/close or the existing PID/start-time-safe host proof; and Claude pre-spawn failures have Codex parity.
- Both reviewers marked the Claude lane NO-GO because production does not establish the pre-turn provider-session identity proof it requires in the pinned `CLAUDE_CONFIG_DIR`. Unit tests inject a synthetic SessionStart event, while the credential-backed test and default account establish no launch-owned hook. A bare `initialize` response is not an acceptable replacement because it does not bind the provider session id.
- Both reviewers converged on a second P1: startup transcript proof reads strict JSONL once inside its outer poll, so a transient torn final line escapes the poll instead of retrying until complete. Persistent malformed data must still fail closed with preserved diagnostics.
- Both reviewers converged on a P2 ownership-reconciliation defect: after forward native-to-TUI handoff removes the router owner, stale host `hasProviderChild` state can keep later close/eviction latched even though the router reports no owner.
- A test-only Sol 5.6/xhigh worker is adding deterministic failing-first coverage for exactly these three seams. Production fixes and any visible behavior remain pending the required HTML approval.

## Final convergence blocker repair (2026-08-25)

- The test-only Sol worker completed and was released after adding failing-first coverage for all three converged seams. Its failures matched production: no launch-owned Claude SessionStart source, no retry for a torn final transcript line, and stale host provider-child ownership after forward handoff.
- Claude structured launch now adds an invocation-scoped SessionStart hook through `--settings` while retaining the existing `user,project,local` setting sources and pinned `CLAUDE_CONFIG_DIR`. The hook emits no context and exists only to make the pre-turn provider session id observable from the exact launched process.
- The credential-backed Claude 2.1.237 test now passes both cases against the real CLI with the production 10-second initialization contract: a signed-in pre-minted session emits the expected launch proof, and an isolated unsigned account returns sign-in guidance.
- Transcript proof distinguishes a partially written final JSONL record from durable malformed content. Only the torn tail is retried; a persistent torn tail fails closed at the deadline with its original diagnostic, while completed malformed, sibling, missing, conflicting, or cyclic state still fails immediately with its specific proof error.
- Forward handoff clears host provider-child ownership only after explicit provider exit proof. Eviction now consults that ownership fact, so a TUI-owned session can close without demanding a second provider stop while an unproven native child remains protected.
- The focused blocker matrix passes five files and 49 tests. No approval-gated renderer behavior was changed; direct activation, the native-to-TUI control, and Show terminal remain pending Brennan's HTML approval.

## Exact-tree Electron validation and repair (2026-08-25)

- A fresh orchestrated Grok worker launched and positively identified the finback Electron instance, used `$electron`/Playwright CDP only, and captured 36 screenshots. Ordinary terminal creation and ordinary Codex and Claude TUI creation all worked on the first click.
- Structured Codex created a durable chat and answered a prompt, but did not activate its published tab. That activation behavior and the missing structured-created native-to-TUI control remain approval-gated by `native-chat-incremental-rollout-preview.html`; production UI has not been changed.
- A Codex TUI with a real rollout successfully moved to native chat, but Show terminal failed at `new-owner-proving` because the resumed process did not produce the expected readiness proof. Durable recovery correctly restored the native owner. A provider-qualified process proof and regression are in progress.
- Structured Claude create and prompted Claude TUI-to-native were visible silent no-ops even though the same Claude account launched and answered in the ordinary TUI. Provider launch/adoption diagnosis and regressions are in progress.
- Closing a structured-created native chat removed the tab but left the durable native owner and lease live. The close path now sends the canonical host tab close followed by capability-gated, idempotent `agentSession.close`; focused renderer, host, cross-version, typecheck, lint, and max-lines checks pass.
- The correctly configured Node 24 repository-wide Vitest run is green: 6,269 files passed, 42 skipped; 58,766 tests passed, 247 skipped.
- Windows high-spec is reachable but its installed Orca host does not advertise structured-session capabilities. OpenClaw's paired runtime is currently unreachable; its SSH project setup is still registered. No remote platform proof is claimed yet.

## Current continuation (2026-08-25)

- The requested fresh Grok `$electron` validation is running on the exact current finback worktree through Orca orchestration. The worker was explicitly instructed to invoke `$electron` and to use Playwright CDP only; no computer-use, accessibility automation, or OS-level input is permitted.
- Windows addon evidence confirmed that the shipped `@vscode/windows-process-tree@0.8.0` exposes only `None`, `Memory`, and `CommandLine`; it does not expose `CreationTime` or `creationTimeMs`. Orca now refuses structured ownership on Windows when that native field is absent instead of treating fabricated test rows as PID-reuse proof. Added a regression that checks the capability seam.
- Structured-create focus cleanup is now identity-scoped: a failed older create can no longer clear a newer create's focus intent. Added a concurrency regression; renderer focus and snapshot matrices remain green.
- Current focused verification after these changes: 26 renderer/process-capability tests pass; Node and web typechecks pass.
- Fable has been asked to confirm or rebut Sol's remaining challenges: adopted-terminal disposal failure dropping the retry surface, unknown-provider Codex fallback, and the Windows native seam. The review run remains active and its messages must be acknowledged before release claims are made.
- No second developer toggle has been added. The existing experimental opt-in plus provider/host capability negotiation remains the proposed gate; the HTML preview is still the approval artifact for any visible activation, fallback, or copy changes.

## Codex handoff-control stabilization (2026-08-25)

- The structured-created Codex surface now exposes a tested “Show terminal” control. The helper proves the current fence, requests the durable handoff, requires the host-published terminal tab/leaf identity, and activates that exact host surface.
- The helper now receives the runtime target from the pane instead of hardcoding local, with paired-runtime coverage proving structured RPC and terminal activation stay on the selected SSH/environment target.
- The first implementation is explicitly idle-only: the control is hidden while a structured turn is working and the request uses `mode: now` rather than queuing an after-turn transfer. This closes the renderer false-timeout/hidden-queued-owner risk identified by Fable without pretending to support durable queued handoff UI.
- New focused coverage passes 8/8 for the handoff helper and structured-session button, alongside the Codex/handoff matrix (97/97), Node/web typechecks, formatting, and the production Electron build.
- Fresh Fable re-review downgraded unknown-provider handling to P2 verification: current sites no longer default to Codex, but missing-provider persistence coverage and any legacy session-id prefix migration story should be decided before broad rollout. Claude process-proof parity remains a separate deferred lane.
- The settings UX proposal is now a nested “Use updated structured native chat” switch beneath the existing Native chat master switch in `native-chat-incremental-rollout-preview.html`; implementation remains approval-gated and is not included in this stabilization pass.

## Current continuation after approval (2026-08-25)

- Brennan approved the nested settings proposal. `experimentalStructuredNativeChat` is now a persisted, default-off child switch under the existing Native chat master switch. Off keeps the PTY-backed native-chat route; on gates only the structured Codex/Claude route after the existing host capability checks. Electron CDP visibly rendered the child switch off, and clicking it persisted `true`.
- Manual-recovery latching now follows one record-derived proof rule: a live TUI owner clears the failed operation id so restart/manual recovery remains retryable; reserved proof attempts and native/manual records retain the operation id for idempotent continuation. The focused handoff/restart/failure matrix passes 46/46.
- A second-cycle renderer gap was corrected so a structured session's durable `agentSessionAgent` identity remains eligible for the Show chat control after returning from TUI before hooks republish foreground status.
- Node/web typechecks and diff checks pass after the toggle and recovery changes. The real remaining Codex blocker is structured-created native → TUI rollout proof in the Electron cycle; adopted TUI → native → TUI passed, but the structured-created TUI did not prove its pinned rollout. No ad-hoc release is claimed until that exact path is fixed and rerun through Grok `$electron`.
