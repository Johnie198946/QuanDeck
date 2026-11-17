# Task source ownership and fixed handoff context

- task_id: quandeck-source-ownership-20261117
- status: COMMITTED
- branch: codex/quandeck-source-ownership-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-source-ownership-20261117
- implementation_commit: 31e42d6df02c7db5ffcc3d4d334fd5edf60400b0; the commit containing this manifest additionally propagates parent transfers into child contexts.
- delegated scope: enforce source conversation ownership, assemble project memory and source handoffs before dispatch, and dispatch transferred tasks without duplicate admissions. No real user database, native UI, or model calls were used by this subtask.

## Initial Git inventory

- Starting root worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-enforced-handoff-20261117
- Starting branch: codex/quandeck-enforced-handoff-20261117
- Starting HEAD: ea5f5fe5874671ac55078fd540ce1a733d7b73de
- Initial status: clean (`## codex/quandeck-enforced-handoff-20261117`).
- Remote: origin, https://github.com/Johnie198946/QuanDeck.git (fetch and push).
- `git worktree list --porcelain` reviewed before edits: bare common repository at /Users/dengzhaoyu/Documents/AI Lab/.repositories/QuanDeck.git, root worktree and independent sibling task worktrees. No main worktree or sibling files were modified.
- Independent task worktree created with `git worktree add .../quandeck-source-ownership-20261117 -b codex/quandeck-source-ownership-20261117 ea5f5fe5874671ac55078fd540ce1a733d7b73de`; clean status, branch and HEAD verified there before edits.
- Integration dependencies cherry-picked locally: root 9cb3701 and e8445bf (local 0800d5c / d2612b3), backend handoff contract c5572c6 (local e62b76f). Only 31e42d6 is this subtask's implementation commit.

## Changes

- `scripts/runtime/driver.mjs`: fresh admission rejects caller-supplied old source IDs; duplicate/unknown/un-stopped task admission cannot be bypassed with another dispatch ID; provider source ownership is checked before sending task content. Adoption may return the existing run only for its owning task. Source identity remains the tool + connection + source-session tuple; independent connections may legitimately use the same opaque source ID.
- `src/data/runtimeDataSource.ts`: validate admission receipt ownership and reject source reuse across managed records; serialize receipt binding; prepare adopted direction in the same transaction as its claim; execute fixed handoff transfers idempotently and preserve unknown admission without replay.
- `src/data/collaboration.ts`: fixed project memory includes every unarchived task, source sequence, checksum, task status and summary provenance. Summaries over 500 characters are explicitly marked as excerpts. Required dependencies include the full structured handoff and immutable pins. Transferred source versions cannot silently change after target creation. Parent-level transfers are mandatory fixed sources for each child run, including the same freshness/version checks.
- `src/data/runtimeSubmission.ts`: accept content-only structured handoff fields; reject forged identity or review fields; backend recording remains mandatory when the model omits the optional narrative.
- Tests: `scripts/runtime/driver.test.mjs`, `scripts/runtime/health.test.mjs`, `scripts/runtime/fixtures/protocol-peer.mjs`, `tests/runtime-binding.test.ts`, `tests/runtime-collaboration.test.ts`, `tests/handoff-context.test.ts`.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- During the child-context follow-up, an unrelated untracked `src/data/collaboration 2.ts` appeared in this worktree. It was preserved, not staged or deleted; a later whole-worktree TypeScript invocation includes that old duplicate and fails on its obsolete types. Explicit affected-domain compilation still passes. Parent integration must run its full checks in its own clean worktree.
- `node --test scripts/runtime/driver.test.mjs scripts/runtime/health.test.mjs`: 68 passed, 0 failed. Local output: /tmp/quandeck-source-ownership-driver-tests.log.
- TypeScript compile and execution of affected domain suites: handoff-context, runtime-binding, runtime-collaboration, task-handoff, task-handoff-transfer, fresh-context-restart and goal-delivery passed. Local generated test output: /tmp/quandeck-source-ownership-tests-20261117.
- Negative coverage includes forged handoff identity/status, altered memory hashes, source replacement, cross-project memory, duplicate source receipts, new dispatch with an existing source ID, concurrent task admission, and unknown admission replay.
- Positive coverage includes same-run continuation, same-dispatch idempotence, legacy read-only memory projection, different connection source-ID scope, fresh source for new task, and explicit 21E → 14D context handoff.
- `git diff --check`: passed.
- Full `pnpm test`, build, native E2E, PRD, GitHub push and release are performed by the parent integration task, not claimed as this subtask's validation.

## Delivery and operational evidence

- GitHub remote/ref/SHA: not pushed by this subtask; parent task owns authorized publication. No `git ls-remote` claim is made here.
- server_before: not applicable, local desktop source subtask.
- server_after: not applicable, no server deployment.
- health_check: not applicable to a running server; affected protocol/domain tests passed locally.
- functional_check: deterministic protocol and domain tests listed above; real desktop/model E2E delegated to parent.
- rollback_point: ea5f5fe5874671ac55078fd540ce1a733d7b73de before integration; revert this subtask's implementation commit to remove its changes without changing user data.
- remaining_risks: these gates prove what context is fixed and delivered to the source request; they do not claim the model understood it. A user-approved stopped-run restart remains an explicit new run and conversation with historical provenance. Full application validation remains with the parent task.
