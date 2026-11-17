# Fixed discussion return boundary audit and correction

- task_id: quandeck-enforcement-audit-20261117
- status: COMMITTED
- branch: codex/quandeck-enforcement-audit-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-enforcement-audit-20261117
- implementation_commit: b5ad52c9c0e68a696d568f09cb9f5b8d6e33d289

## Finding and correction

The initial read-only audit of `e40eb6de98f7f924d3b46b26f1a7eec557c21818` found that task planning pinned the business Spec and mandatory handoff at dispatch, but the reply handler did not revalidate those pins. A task Spec revision during an independent planning run did not fence the planning ledger task. An obsolete reply could therefore enter current conclusions and, after earlier direction approval, automatically materialize a task graph.

After the parent authorized correction:

- `src/data/discussionContext.ts` checks run/context identity, prompt hash, current project Spec, exact business task Spec/goal/criteria, user conditions, fixed source bodies and current provenance, handoff hashes, and mandatory predecessor membership.
- `src/data/runtimeDataSource.ts` applies this check before any conclusion, outline, visual, draft or automatic task import. Invalid replies remain in source conversation history and produce a visible `DISCUSSION_CONTEXT_STALE` issue.
- `tests/discussion-stale-return.test.ts` exercises actual stub-driver replies for valid and invalid contexts.

Live task version/status changes and unrelated project-memory watermarks are deliberately not compared. An unchanged candidate source becoming accepted does not invalidate its content. No historical context, source reply, Spec or handoff is rewritten.

## Other audited boundaries

- Runtime submission allowlists and bindings restrict Agent output to candidate content. Human review remains outside the Agent command set.
- Submission and review validation are performed on a private snapshot and commit only after success. Handoff construction is within the same submission transaction.
- Existing-target transfer uses current target version, stable idempotency fingerprints, started-task guards and fixed source review/artifact/handoff pins.
- Published Spec versions and registered collaboration facts are protected by the durable immutable-facts store.
- A separately delegated source audit identified imported live-session rebinding as a second issue. Its fix belongs to the independent source-receipt subtask and is not claimed by this commit.
- The authenticated raw adapter API is a trusted-client boundary; it is not presented as equivalent to the managed application orchestration gate. No model prompt exposure of the paired adapter token was found in this review.

## Initial Git inventory

- `git status --short --branch`: clean, `## codex/quandeck-enforcement-audit-20261117`.
- `git branch --show-current`: `codex/quandeck-enforcement-audit-20261117`.
- `git rev-parse HEAD`: `e40eb6de98f7f924d3b46b26f1a7eec557c21818`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain`: verified the dedicated worktree above. Parent integration and all other task worktrees were not modified.
- Existing dependencies used by node_modules symlink; no dependency/lockfile changes.

## Verification

- `pnpm exec tsc --noEmit`: passed.
- Selected TypeScript tests compiled into `/tmp/quandeck-enforcement-audit-tests-20261117`.
- `discussion-stale-return`: valid automatic decomposition; target Spec, source version, user-condition and draft-version changes blocked; raw reply retained; prompt-hash integrity and unchanged progress accepted.
- `project-workflow`: passed.
- `discussion-scope`: passed.
- `goal-delivery`: passed.
- `discussion-handoff-context`: passed.
- `git diff --check`: passed.

Only isolated fixture data and a stub RuntimeDriver were used. No real database, app operation or provider call was performed.

## Delivery boundaries

- GitHub remote/ref/SHA: no push by this subtask; parent integration pending.
- `git ls-remote`: not executed here; no PUSHED claim.
- server_before: not applicable; no server/app installation.
- server_after: not applicable; no server/app installation.
- health_check: local type verification passed; server health not applicable.
- functional_check: five affected domain/runtime-event suites passed; parent owns real app verification.
- rollback_point: `e40eb6de98f7f924d3b46b26f1a7eec557c21818`; revert implementation commit to roll back without rewriting data.
- remaining_risks: parent must register the new test file, integrate the imported-session fix, complete unified checks and real end-to-end verification, update PRD and perform the authorized release workflow.
