# Stopped stale-context recovery

- task_id: quandeck-fresh-context-retry-20261117
- status: COMMITTED
- branch: codex/quandeck-fresh-context-retry-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-fresh-context-retry-20261117
- implementation_commit: a78e90308eb83c028161a0563243edf6edc6cfd8
- base/rollback_point: 9bd83e5204419c1f7147e51bf2474fe1a4b4c148
- remote/ref/SHA: origin; no push performed by this subtask. Parent task owns integrated publication and remote SHA verification.

## Problem and change

The actual design execution was paused with a confirmed stop but still pinned an earlier partial audit artifact. After the complete audit arrived, the immutable old context could not legally submit a dependent result. Ordinary resume would waste another turn and eventually receive SOURCE_STALE. Same-agent handoff was forbidden and retryDispatch did not accept this paused state.

Added an explicit `restart_fresh_context` host action, `inspectContextRestart` read projection and `restartFreshContext` command. The user action checks the old source's independent driver stop receipt, exact project/source/connection/run/claim/spec identity, current authorized plan and prerequisites, and absence of pending requests or uncertain external actions. It fences the old claim through the existing human reopen command and creates a new managed claim/context/source session using current valid sources. All prior contexts, submissions, artifacts, source identity and execution history are retained. A `task_context_restarted` ledger event binds the old and new records.

Ordinary resume/text cannot reuse stale fixed input. Exact pending source requests still use the existing permission/question protocol. Synchronous control locks, final preflight fingerprint checks, attachment preparation guards and persisted successor identity prevent duplicate clicks, late events and unknown admission from silently replaying execution. Only a deliberate user action enters this flow; the scheduler does not rewrite a running context or retry silently. UI implementation is owned by the separate UI task.

Changed files:

- src/data/runtimeContextRestart.ts
- src/data/runtimeContracts.ts
- src/data/runtimeDataSource.ts
- desktop/app/run-workflow.mjs
- desktop/run-workflow.test.mjs
- tests/fresh-context-restart.test.ts
- scripts/test.mjs

## Verification

- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: all domain programs passed; 262 Node tests passed, 0 failed. Evidence: /private/tmp/quandeck-live-repair-20261117/fresh-context-full-test.log.
- `pnpm build`: passed; only the existing large-chunk advisory. Evidence: /private/tmp/quandeck-live-repair-20261117/fresh-context-build.log.
- Final scoped-fingerprint adjustment was recompiled and its dedicated regression rerun successfully after the full suite.
- Dedicated regression reproduces an old partial fixed source followed by a new complete audit; verifies the new run pins only the latest audit, immutable old context and artifact preservation, exact claim fencing, source stop evidence, pending permission response, stale-plan/current-spec fences, unknown external action refusal, preflight and attachment races, cross-project routing, double-click and persisted successor dedupe, and late old-result rejection. Known rejection and unknown admission retain a new identity without replaying the original restart.
- Desktop workflow tests verify stale read projection and exact original-project receipt navigation.
- `git diff --check`: passed.

## Delivery and risks

- server_before: not applicable; no server deployment in this subtask.
- server_after: not applicable; no server deployment in this subtask.
- health_check: local type/build/test verification passed; parent owns packaged native checks.
- functional_check: deterministic core and desktop-host regression passed. Parent must verify the new entry on the actual stopped design source after integrating the UI commit and package.
- rollback_point: base 9bd83e5204419c1f7147e51bf2474fe1a4b4c148; revert this implementation commit before packaging if required. Do not rewrite real project records.
- remaining_risks: source/provider network availability remains external; an unknown stop or admission intentionally blocks duplicate execution. The feature is scoped to an unchanged managed execution with stale fixed input, not arbitrary reopening of completed tasks or permission transfer.
- Real DB, source processes and native app UI were not mutated by this subtask.

## Opening Git inventory

```text
$ git status --short --branch
## codex/quandeck-fresh-context-retry-20261117

$ git branch --show-current
codex/quandeck-fresh-context-retry-20261117

$ git rev-parse HEAD
9bd83e5204419c1f7147e51bf2474fe1a4b4c148

$ git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)

$ git worktree list --porcelain
Full multi-worktree inventory retained in local audit evidence; unrelated task details omitted from this public copy.
```
