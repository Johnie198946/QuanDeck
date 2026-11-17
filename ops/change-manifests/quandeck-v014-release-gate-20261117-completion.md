# QuanDeck v0.14 release gate completion

- task_id: quandeck-v014-release-gate-20261117
- status: COMMITTED
- branch: codex/quandeck-v014-release-gate-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-v014-release-gate-20261117
- local_commit: ff1f82214acde002a86cb100207f68cb22534d32
- objective: Version the installer publication checks so new strict delivery smoke evidence is required from v0.14 onward, while preserving the historical v0.11–v0.13 contract.

## Initial Git inventory

- New isolated worktree was created from parent HEAD `c62d1f9ae6a76c7ce8c2a92dbc9d68c0288580ae`.
- `git status --short --branch`: `## codex/quandeck-v014-release-gate-20261117` (clean).
- `git branch --show-current`: `codex/quandeck-v014-release-gate-20261117`.
- `git rev-parse HEAD`: `c62d1f9ae6a76c7ce8c2a92dbc9d68c0288580ae`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain`: inspected existing independent worktrees before creating this task; new worktree path and branch above are dedicated to this fix. No existing task branch/worktree was reused.
- Bare repository: `/Users/dengzhaoyu/Documents/AI Lab/.repositories/quandeck-delivery-contract-20261117.git`.
- Parent's uncommitted `docs/delivery-contract-v0.14.md` was left untouched. The AI Lab parent checkout and historical projects were not modified.

## Changes

- `.github/scripts/publish-installers.py`: v0.11–v0.13 still require `noSyntheticTask=true`. v0.14+ instead require `strictContract=true`, `partialAcceptanceRejected=true`, exactly two integer contribution tasks and three integer assembly responsibilities. Existing slot-count, empty/partial delivery, candidate-not-accepted, renderer and other platform validation remain mandatory. Version prereleases follow their base version's contract.
- `.github/scripts/test_publish_installers.py`: positive v0.14 case deliberately omits the obsolete flag; both-platform negative tests cover omitted, false, truthy and wrong-typed proof; exact task/output counts; v0.13 compatibility; v0.14 RC; future-version downgrade rejection. All rejection cases occur before upload/publication.

## Validation

- `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`: 46 tests passed; GitHub mocked, no network or release writes.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed (existing chunk-size advisory only). Evidence `/private/tmp/quandeck-v014-release-gate-build.log`.
- `pnpm test`: every TypeScript suite and 310 Node cases passed, 0 failed. Existing HTTP tests were allowed isolated localhost binding. Evidence `/private/tmp/quandeck-v014-release-gate-tests.log`.
- `git diff --check`: passed.

## Operations and risks

- GitHub remote/ref/SHA: not pushed by this subtask. Parent owns merge, push and release; no remote SHA verification is claimed here.
- server_before: not applicable; no deployment.
- server_after: not applicable; no deployment.
- health_check: local type/build and all test gates passed; server health not applicable.
- functional_check: old/new publication contract tests and fail-before-write assertions passed; actual installer release remains parent responsibility.
- rollback_point: base `c62d1f9ae6a76c7ce8c2a92dbc9d68c0288580ae`; revert code commit if necessary. No data migration or user data writes.
- remaining_risks: publication workflow must run from the integrated commit containing this script. Do not substitute a fabricated `noSyntheticTask` field into v0.14 smoke evidence.
