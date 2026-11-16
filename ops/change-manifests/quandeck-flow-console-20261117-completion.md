# QuanDeck discussion and execution interface

- task_id: quandeck-flow-console-20261117
- status: COMMITTED
- branch: codex/quandeck-flow-console-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-console-20261117
- implementation_commit: c1126b320c63cabf2280be08b1d5be9e90931dcf

## Scope

Explicit direction-discussion / task-execution phases; a dedicated plan-approval command with revision guard; approval state projected from project metadata; real source progress, step counts and elapsed time; optional confirmation form hidden when empty/approved; credentials masked in visible raw context. Confirmed values are sent as structured user input for ledger persistence. Plan details open inside QuanDeck with Markdown and keyboard-accessible modal. Plain tasks retain manual input, direct dispatch and execution details without requiring a discussion.

Changed files: RuntimeConsole, RuntimeProgress, ConfirmationPanel, RichMessage, RuntimeRequests and runtime CSS; Workspace, PlanDocView, PlanActions, DiscussionSummary, TaskDirectView and plan CSS; RuntimeRunView.workflow contract; runtimePresentation projection and regression tests.

## Opening inventory

- status: clean, `## codex/quandeck-flow-console-20261117`
- branch: codex/quandeck-flow-console-20261117
- HEAD: 01e24ee09deaa5e9ddf804e572b23b0a2313c185
- remote: origin https://github.com/Johnie198946/QuanDeck.git (fetch/push)
- worktree: dedicated new worktree above, based on the parent's consolidated prior changes.
- Full status / branch / HEAD / remote / worktree inventory: `output/flow-console/git-before.txt` (local validation output; excluded from Git).

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed, existing large bundle warning remains.
- `pnpm test`: passed all domain suites and 232 Node tests with localhost access; the first sandboxed run failed only on three fixtures denied local port binding, then rerun with authorized loopback access passed.
- `tests/runtime-presentation.test.ts`: compiled with TypeScript to a temporary directory and passed. Covers credential redaction, explicit-user-only confirmation filtering, true step/elapsed projection, parent/child separation and pause behavior.
- `tests/runtime-ui.browser.mjs`: passed in isolated headless Chrome, no user profile/model request; 1440 / 1024 / 768 / 320 px, zero horizontal overflow and zero page errors. Covers draft recovery, failed send retention, edited confirmation metadata, source jump, Word/Excel previews, empty confirmation removal, source step progress, revision-guarded approval and post-approval task CTA.
- UI screenshots and logs: `output/flow-console/` (local only).
- `git diff --check`: passed.

## Delivery boundary

- remote/ref/SHA: not pushed by this subtask; parent performs authorized merged GitHub release.
- server_before: not applicable, desktop UI subtask.
- server_after: not applicable, no server deployment.
- health_check: typecheck/build and isolated renderer passed.
- functional_check: local automated checks above; parent must integrate domain approvePlan and host approve_plan/open_tasks/decompose_plan/execute_task contracts before native release verification.
- rollback_point: 01e24ee09deaa5e9ddf804e572b23b0a2313c185; revert implementation commit from merged task branch if needed.
- remaining_risks: backend/host integration is owned by parent/domain subtask; register runtime-presentation.test.ts in the shared test runner after merging. Equivalent rephrased suggestions are not guessed to be consent; approved workflow state suppresses repeated approval requirements. Native install/release validation remains with parent.
