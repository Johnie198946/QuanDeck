# QuanDeck installer checks completion

- task_id: quandeck-installer-checks-20261117
- status: COMMITTED
- branch: codex/quandeck-installer-checks-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-installer-checks-20261117
- local_commit: 1f949799c6d006032173049444c234fa58835773
- objective: Diagnose CI run 44051780393 macOS arm64 and Windows x64 installer launch failures, repair the obsolete smoke fixture, and guard the shipped fixture before packaging.

## Initial Git inventory

The task began in a newly created worktree and branch from root's explicitly supplied HEAD. The root worktree contained an unrelated modification to docs/delivery-contract-v0.14.md; it was not copied, staged, or modified.

- `git status --short --branch`: `## codex/quandeck-installer-checks-20261117` (clean).
- `git branch --show-current`: `codex/quandeck-installer-checks-20261117`.
- `git rev-parse HEAD`: `4b478cb69cfacb0f0c5219c7e070e2b29fd19a6f`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain` confirmed the new dedicated worktree at the path above, branch `refs/heads/codex/quandeck-installer-checks-20261117`, starting HEAD `4b478cb69cfacb0f0c5219c7e070e2b29fd19a6f`; the parent integration and existing task worktrees remained unchanged.
- Bare repository: `/Users/dengzhaoyu/Documents/AI Lab/.repositories/quandeck-delivery-contract-20261117.git`.

## Diagnosis and files

CI log was read with the existing credential-safe GitHub helper. macOS reached and failed `Goal delivery smoke: two real tasks and three declared slots`; Windows exited from the same application smoke stage with code 1. Installer builds, macOS disk verification, copy/signature checks and process startup had already passed. The old fixture assumed project slots belonged directly to two business tasks. Strict contracts now create two contribution tasks plus three separate final assembly responsibilities, and require per-item receipts.

- `desktop/app/smoke-goal-delivery.mjs`: shared data scenario now verifies strict contracts, system-created responsibilities, separate contribution/final slots, empty and partial submissions, rejected incomplete acceptance, explicit item checks, manual final candidates with accepted source version, persisted receipts and missing hotel contribution. It does not invent an Agent run or publish candidates. Renderer smoke checks the current final map and per-item body.
- `tests/installer-goal-delivery.test.ts`: runs the exact shipped data scenario through production repository commands before packaging and verifies persisted 2/3 final map with zero accepted final outputs after restart.
- `scripts/test.mjs`: includes the installer data scenario in the normal test gate.
- `desktop/check-windows-install.ps1`: prints the isolated application's smoke error on nonzero GUI-process exit rather than losing it behind only an exit code.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed, existing large-chunk advisory only.
- `node --check desktop/app/smoke-goal-delivery.mjs`: passed.
- `git diff --check`: passed.
- Exact new fixture through TypeScript compilation and Node execution: passed.
- Initial complete test attempt in the restricted sandbox encountered 3 existing HTTP listener `EPERM` failures. After linking the existing desktop dependencies and allowing isolated localhost listeners, `pnpm test` passed every TypeScript suite and all 310 Node test cases, 0 failed. Evidence: `/private/tmp/quandeck-installer-tests-unrestricted.log`.
- CI failure log evidence: `/private/tmp/quandeck-install-ci-failed.log`.
- Native renderer/installer rerun: delegated to parent after integration. No live QuanDeck UI or real project database was operated or mutated by this subtask.

## Delivery and operations

- GitHub remote/ref/SHA: not pushed by this subtask; parent owns merge, push and release. No remote verification is claimed.
- server_before: not applicable; no server deployment.
- server_after: not applicable; no server deployment.
- health_check: local type/build/tests passed; server health not applicable.
- functional_check: shipped strict smoke data scenario and persistence passed; actual packaged smoke remains parent validation.
- rollback_point: source base `4b478cb69cfacb0f0c5219c7e070e2b29fd19a6f`; revert local code commit if needed, no data migration.
- remaining_risks: Windows PowerShell and packaged renderer checks require the parent's fresh installer/CI run. Existing runtime auto-dispatch is covered by project-assembly tests, while installer fixture intentionally uses manual registration to avoid external Agent calls.
