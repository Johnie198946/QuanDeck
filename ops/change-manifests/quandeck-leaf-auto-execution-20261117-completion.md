# Leaf direction automatic execution

- task_id: `quandeck-leaf-auto-execution-20261117`
- status: `COMMITTED`
- branch: `codex/quandeck-leaf-auto-execution-20261117`
- worktree: `.worktrees/quandeck-leaf-auto-execution-20261117`
- code_commit: `54a0e7f` (`fix: execute approved leaf directions without replanning`)
- remote/ref/SHA: not pushed by this subtask; parent task owns integrated release and remote verification.

## Problem and implementation

An approved task direction with no decomposition drafts had no goal-plan graph. Enabling automatic execution therefore opened another discussion, even for a concrete leaf subtask. The repaired service materializes a single binding to the existing task key and spec revision when explicit automation is enabled. A subtask retains its workItemId. No business task or required delivery slot is added, and the project output map remains immutable.

Project-level empty directions still request decomposition. Existing graphs remain protected. Parent tasks with live descendants cannot use this leaf path. Candidate submission closes a direct plan without inventing acceptance. When a previously direct task is later split, its existing node stays as parent. Approved legacy automation can recover the missing graph, while unknown/reserved source admission and unknown stop receipts continue to fence execution.

Changed files:

- `src/data/directTaskPlan.ts`
- `src/data/repository.ts`
- `src/data/runtimeDataSource.ts`
- `src/data/projectWorkflow.ts`
- `src/data/goalDelivery.ts`
- `tests/leaf-auto-execution.test.ts`
- `tests/project-workflow.test.ts`
- `scripts/test.mjs`
- `docs/goal-delivery-v0.11.md`

## Initial Git inventory

All five required inventory commands were run before editing. Full local output is retained at `/tmp/quandeck-leaf-auto-execution-20261117-inventory.txt`.

```text
git status --short --branch
## codex/quandeck-leaf-auto-execution-20261117
(no changes)

git branch --show-current
codex/quandeck-leaf-auto-execution-20261117

git rev-parse HEAD
a84f93b3105f4a0c7a719a04d54d3bb957419126

git remote -v
origin https://github.com/Johnie198946/QuanDeck.git (fetch)
origin https://github.com/Johnie198946/QuanDeck.git (push)

git worktree list --porcelain (current worktree entry)
worktree …/AI Lab/.worktrees/quandeck-leaf-auto-execution-20261117
HEAD a84f93b3105f4a0c7a719a04d54d3bb957419126
branch refs/heads/codex/quandeck-leaf-auto-execution-20261117
```

Other worktrees were inspected only through the inventory. No other worktree, real database, installed application, stash, or main working directory was changed. Ignored dependency symlinks reuse installed packages; no dependency or lockfile change.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed; existing large-chunk advisory remains.
- `pnpm test`: passed, all domain scripts and 298/298 runtime/desktop/bridge subtests.
- Full test log: `/tmp/quandeck-leaf-auto-test-complete.log`.
- `git diff --check`: passed.
- Regression covers exact leaf execution scope, no duplicate discussion/task/slot, immutable project map, duplicate activation, real candidate submission, no invented review, same-key direction revision, later decomposition preserving its parent, authorized legacy restore, and uncertain legacy admission remaining paused.
- Initial full-suite runs were blocked by missing desktop package links and sandbox-denied loopback test ports; dependencies were linked from the existing installation and the isolated local test suite was rerun with permitted loopback servers. The final suite passed without changing product behavior to accommodate tests.

## Delivery boundaries

- server_before: not applicable; no deployment in this subtask.
- server_after: not applicable; no deployment in this subtask.
- health_check: type check, build, and isolated service/runtime regression passed; no production health claim.
- functional_check: fixture E2E passed from approved project decomposition through leaf direction, scoped execution, submission and original-map fill. Real App check belongs to parent task.
- rollback_point: base `a84f93b3105f4a0c7a719a04d54d3bb957419126`; revert the isolated fix commit if needed; historical ledger records are retained.
- remaining_risks: real App smoke and integrated GitHub/installer release remain with the parent; this subtask does not claim PUSHED, DEPLOYED, or VERIFIED.
