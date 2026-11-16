# Completed leaf activity correction

- task_id: quandeck-leaf-delivery-activity-20261117
- status: COMMITTED
- branch: codex/quandeck-leaf-delivery-activity-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-leaf-delivery-activity-20261117
- implementation_commit: f507b06388683e550cebe8d9713161c6379fff6e
- base/rollback_point: d92da6af15323a2496ab989cc20d13c2ce897bdc

## Problem and change

A native completed candidate displayed the right parent status but its leaf still fell back to the last attempt's shell command as the current stage. TaskScope now uses the shared read-only work-item activity projection. Complete candidates show awaiting review; partial candidates show their missing work; real current requests take precedence. Historical tool commands stay in execution details rather than becoming current-stage text. Running tools receive the existing readable stage label. TaskTree and TaskMap use the same display label, and delivered map nodes omit obsolete source-step progress.

The activity projection also retains an open source failure incident when its coarse source status is paused. Current permission/question requests still take priority; archived sources remain historical. No task state, source lifecycle, submission, artifact or real database was rewritten.

Changed files: src/components/deck/TaskScope.tsx; src/components/journal/TaskProgress.tsx; src/components/results/TaskMap.tsx; src/components/results/TaskTree.tsx; src/data/orchestration.ts; src/data/projectActivity.ts; src/data/workItemPresentation.ts; tests/execution-progress.test.ts; tests/partial-delivery.test.ts.

## Before-work Git inventory

- `git status --short --branch`: clean, codex/quandeck-leaf-delivery-activity-20261117.
- `git branch --show-current`: codex/quandeck-leaf-delivery-activity-20261117.
- `git rev-parse HEAD`: d92da6af15323a2496ab989cc20d13c2ce897bdc.
- `git remote -v`: origin https://github.com/Johnie198946/QuanDeck.git (fetch and push).
- `git worktree list --porcelain`: independent new task worktree on the branch above, based on the root integration commit; other worktrees were read-only and untouched. Complete raw inventory is retained locally at `/private/tmp/quandeck-live-repair-20261117/leaf-delivery-activity-git-before.txt`. The public record omits the local username and unrelated worktree inventory.

## Verification

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed; existing bundle size advisory only.
- `pnpm test`: all domain scripts and 262 Node tests passed, zero failures.
- `git diff --check`: passed.
- Regression: completed exact-source candidates in idle/stopped states never reuse the previous shell command as activity; actual pending permission text wins; paused source with an unresolved failure remains actionable; meaningful non-command step text remains readable.
- Local test evidence: `/private/tmp/quandeck-live-repair-20261117/leaf-delivery-tests.log` and `leaf-delivery-build.log`.

## Delivery boundary

- remote_sha / ref verification: not executed by this subtask; root owns authorized squash publication and remote verification.
- server_before: not applicable; local desktop source task.
- server_after: not applicable; no installation or server deployment by this subtask.
- health_check: type, full test and production build checks passed.
- functional_check: deterministic presentation tests passed; root integrated browser and native checks are recorded separately.
- rollback_point: base d92da6af15323a2496ab989cc20d13c2ce897bdc; reverting the implementation has no data migration.
- remaining_risks: final packaged native confirmation remains root-owned. This fix does not claim completion or acceptance of the user's business tasks.

## Integrated isolated browser check

Root integrated the implementation as a988214. The existing loopback renderer was tested with a sanitized read-only backup of the actual paused complete candidate. Its TaskScope leaf now shows awaiting review and the saved-candidate message, with no historical shell command or misleading current-stage text. Browser-only variants verified an open failure on the same paused source and a permission request taking priority; the corresponding detail exposes the exact request action. All assertions passed with zero page errors. Screenshots were captured after layout transitions completed and visually inspected. No user database, actual source process or native app was touched.

Local evidence: `/private/tmp/quandeck-live-repair-20261117/leaf-delivery-activity/checks.json`, `actual-complete-leaf.png`, `paused-leaf-open-failure.png`, `paused-leaf-permission-priority.png`. These user-data screenshots remain outside Git. Precise source IDs and original commands are deliberately absent from the public manifest.
