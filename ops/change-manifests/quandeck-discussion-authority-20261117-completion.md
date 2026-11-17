# QuanDeck discussion authority and fixed planning context

- task_id: quandeck-discussion-authority-20261117
- status: COMMITTED
- branch: codex/quandeck-discussion-authority-20261117
- worktree: WORKSPACE/.worktrees/quandeck-discussion-authority-20261117
- implementation_commits:
  - c05d896e475b73eafa44791455a4254b10ea073d
  - 8ff9338ee06149836194343161cc952944fc6abf

## Objective and changes

Fix two backend context boundaries discovered during the parent task's real end-to-end validation.

1. Adopting direction previously copied the model's whole round summary into a fixed, user-edited plan line. The legacy plan bridge then recorded it as a confirmed human constraint. Temporary discussion statements such as “this round only plans” therefore became execution restrictions. Approval now adopts explicit proposals and structured outline only; the summary remains in discussion history.
2. Old generated summary lines are recognized by their exact generated line ID and unchanged recorded summary, unless that text is also an explicit proposal/confirmation. Context projection and later legacy reconciliation exclude only this generated provenance. No stored history is rewritten. Independent user decisions and actual edits remain authoritative. Explicit later user confirmation creates its own record instead of deduplicating against the old generated summary.
3. Planning had an independent ledger task, so the target task's transferred predecessor was only optionally recalled by keywords. The context builder now resolves the backend-generated planning identity against current plan/scope/revision, records the exact target task Spec, includes target user constraints, and pins all usable predecessor/child evidence and explicit transfer evidence in full. A stale transfer or changed planning scope is rejected before source dispatch. Unfinished ordinary prerequisites are not fabricated into accepted evidence and do not block legitimate advance planning.

Changed files:

- `src/data/discussionAuthority.ts`
- `src/data/projectWorkflow.ts`
- `src/data/collaboration.ts`
- `src/data/runtimeDataSource.ts`
- `src/data/repository.ts`
- `tests/discussion-authority.test.ts`
- `tests/discussion-handoff-context.test.ts`

## Initial Git inventory

Local directory prefixes are normalized to `WORKSPACE` in this public copy; branch, commit, remote and status evidence is unchanged.

The parent integration tree was read only. This task used a new isolated worktree and branch.

- initial `git status --short --branch`: `## codex/quandeck-discussion-authority-20261117` with no file changes.
- `git branch --show-current`: `codex/quandeck-discussion-authority-20261117`.
- initial `git rev-parse HEAD`: `5f5bf6968589855aa4d5c4022f655fe1935cdfb4`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain`: verified the dedicated worktree above and parent `WORKSPACE/.worktrees/quandeck-enforced-handoff-20261117`, both initially at the base SHA. Other listed worktrees were not edited, staged, reset, or stashed.
- Dependency access uses the existing read-only node_modules symlink; no dependency installation or lockfile change.

## Verification

Passed:

- `pnpm exec tsc --noEmit`.
- TypeScript compile for selected domain test entrypoints, with output only under `/tmp/quandeck-discussion-authority-tests-20261117`.
- `discussion-authority`: summary/proposal separation, unchanged legacy facts, real RuntimeDriver request content, explicit same-text confirmation, reconciliation and edited-line authority.
- `discussion-handoff-context`: target task Spec and condition pins, 12 distracting historical tasks, complete 7 KB predecessor body and handoff, pending ordinary prerequisite, no business execution during planning, source replacement refusal before dispatch, stale plan scope refusal.
- `project-workflow`.
- `discussion-scope`.
- `goal-delivery`.
- `plan-actions` (after the summary boundary change).
- `git diff --check`.

Tests use isolated in-memory/localStorage fixture data and a stub RuntimeDriver. This subtask did not access the real project database, operate the app, or call a model. The parent task owns the unified test harness registration, full build and real app verification.

## Publication and deployment

- GitHub remote/ref/SHA: not pushed by this subtask; parent integration/release pending.
- `git ls-remote` evidence: not executed here; no PUSHED claim.
- server_before: not applicable; no server deployment or app installation by this subtask.
- server_after: not applicable; no server deployment or app installation by this subtask.
- health_check: not applicable to this local code subtask; type and domain checks are recorded above.
- functional_check: passed isolated domain and runtime-request tests; real app end-to-end validation remains with parent.
- rollback_point: base commit `5f5bf6968589855aa4d5c4022f655fe1935cdfb4`; revert the two implementation commits in reverse order if required. No history rewrite or data migration is required.

## Risks and limits

- The backend guarantees which fixed facts enter a source request; it cannot prove the model semantically understood them.
- Legacy compatibility deliberately uses exact known generated provenance. It does not guess authority from phrases or strip user instructions by keywords.
- Old source conversations and stored context packages remain historical facts; only newly assembled contexts use this projection.
- Root must register both new test files, integrate commits, complete the real app run, update PRD and perform the separately authorized GitHub release workflow.
