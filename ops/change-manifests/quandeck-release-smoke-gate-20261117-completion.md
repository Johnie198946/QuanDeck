# QuanDeck versioned native release gate

- task_id: quandeck-release-smoke-gate-20261117
- status: COMMITTED
- branch: codex/quandeck-release-smoke-gate-20261117
- worktree: .worktrees/quandeck-release-smoke-gate-20261117
- implementation commit: 6cdc9ef65bace28e8dbfbe143b893844d73ba9da
- base / rollback_point: a820af45a3e545072f016a56d653a490a5323844

## Objective and change

The native goal-delivery smoke now checks three declared output slots, explicit empty submissions, and incomplete tasks with only part of their required output. The publisher still required the historical two-slot receipt, so it rejected current successful native builds.

Only `.github/scripts/publish-installers.py` and `.github/scripts/test_publish_installers.py` changed, plus this manifest. Version 0.11.0 retains its two-slot contract. Version 0.11.1 and later require exactly three integer slots and strict boolean `explicitEmptyPreserved` / `partialTaskIncomplete` evidence. All previous checks, including candidate-not-accepted, remain mandatory. Missing, false or truthy non-boolean evidence on either platform rejects before any upload. Current releases cannot downgrade to the old evidence format.

## Pre-change Git inventory

The integration worktree was inspected read-only:

```text
git status --short --branch
## codex/quandeck-live-repair-20261117
?? "desktop/app/agent-bridge 2.mjs"
git branch --show-current
codex/quandeck-live-repair-20261117
git rev-parse HEAD
a820af45a3e545072f016a56d653a490a5323844
git remote -v
origin https://github.com/Johnie198946/QuanDeck.git (fetch)
origin https://github.com/Johnie198946/QuanDeck.git (push)
```

`git worktree list --porcelain` was captured privately before changes. A new task worktree and branch were then created from the exact base above; the new worktree started clean. Other worktrees and the unrelated untracked bridge file were not modified or staged. The full unrelated worktree inventory is intentionally excluded from this public document.

## Tests and checks

- `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`: 38 tests passed. All GitHub operations mocked; rejection tests assert zero upload/publication calls.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: all domain checks and 267/267 Node tests passed. Local fixture listeners required test-only permission; no actual Agent/model call or real project mutation occurred.
- `pnpm build`: passed; existing bundle-size warning remains.
- `git diff --check`: passed.

## Delivery boundaries

- GitHub remote/ref/SHA and `git ls-remote`: not executed by this subtask; parent task owns release integration and remote verification.
- server_before: not applicable; no deployment.
- server_after: not applicable; no deployment.
- health_check: local publication regression, TypeScript and build checks passed.
- functional_check: historical/current/future version contracts; both platform receipts; exact slot count; missing/false/non-boolean safety evidence; rejection before external writes.
- rollback_point: a820af45a3e545072f016a56d653a490a5323844. Revert the implementation commit; no data migration.
- remaining_risks: remote publication has not been rerun by this subtask. Parent must build from the final integrated source and rerun the unchanged native and publication checks. No bypass or relaxed safety condition was added.
