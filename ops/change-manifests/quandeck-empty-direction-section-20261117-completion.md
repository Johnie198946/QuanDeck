# Empty generated direction section correction

- task_id: quandeck-empty-direction-section-20261117
- status: COMMITTED
- branch: codex/quandeck-empty-direction-section-20261117
- worktree: WORKSPACE/.worktrees/quandeck-empty-direction-section-20261117
- implementation_commit: 2a9104ffaa4cd57d0d2060318974d7d258ea7da7

## Objective and changed files

Direction approval with only structured outline content must not create an empty “已确认方向” group, which incorrectly appears as unfinished work.

- `src/data/projectWorkflow.ts`: create the generated section only when an actual new approved line needs it; an existing duplicate proposal also does not produce an empty section.
- `src/data/discussionAuthority.ts`: read-only projection excludes only the exact known empty generated group. Renamed sections, nonempty groups and other real empty sections remain visible.
- `src/components/workspace/PlanDocView.tsx`: use the projection consistently for the outline and reading body. Raw documents and editor remain unchanged.
- `tests/discussion-authority.test.ts`: regression coverage for outline-only approval, duplicate proposal, historical projection, unchanged snapshots and genuine sections.

## Initial Git inventory

Local directory prefixes are normalized to `WORKSPACE` in this public copy; branch, commit, remote and status evidence is unchanged.

- `git status --short --branch`: clean, `## codex/quandeck-empty-direction-section-20261117`.
- `git branch --show-current`: `codex/quandeck-empty-direction-section-20261117`.
- `git rev-parse HEAD`: `e7a34dbec5ff3e76855c9c3b6f5bd4f4cf52c456`.
- `git remote -v`: origin fetch/push `https://github.com/Johnie198946/QuanDeck.git`.
- `git worktree list --porcelain`: inspected and confirmed a new dedicated worktree at the path above. The parent integration worktree and other task worktrees were not modified.
- Existing dependency tree used through a node_modules symlink; no dependency or lockfile modifications.

## Verification

- `pnpm exec tsc --noEmit`: passed.
- Selected test compilation with TypeScript into `/tmp/quandeck-empty-direction-tests-20261117`: passed.
- `discussion-authority.test.js`: passed.
- `project-workflow.test.js`: passed.
- `git diff --check`: passed.
- No real database, source model or app interaction performed by this subtask. Parent performs integrated app verification and publication.

## Delivery boundaries

- GitHub remote/ref/SHA: no push by this subtask; parent integration pending.
- `git ls-remote`: not executed by this subtask; no PUSHED claim.
- server_before: not applicable; local code change only.
- server_after: not applicable; no deployment or app installation.
- health_check: not applicable; local type validation passed.
- functional_check: isolated regression and workflow tests passed; parent owns real app verification.
- rollback_point: `e7a34dbec5ff3e76855c9c3b6f5bd4f4cf52c456`; revert the implementation commit if necessary. No database migration or history rewrite.
- remaining_risks: integrated build, PRD and release verification remain with parent. The editor intentionally retains original historical sections.
