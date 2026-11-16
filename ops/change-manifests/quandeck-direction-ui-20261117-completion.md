# Direction UI and goal decomposition handoff

task_id: quandeck-direction-ui-20261117
status: COMMITTED
branch: codex/quandeck-direction-ui-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-direction-ui-20261117
implementation_commit: 0415c487a1906aaa7dc7d63cd03a754053c8635e
verification_commit: the commit containing this final verification update; use git log -1 -- this manifest to resolve.

## Scope

Readable project/task direction page: outline navigation, persisted manual Markdown body editing, inline source-linked discussion visuals, expected delivery list, revision-aware one-click approval/automation and independent approval-only option. Goal overview shows the persisted project/task/subtask hierarchy and ledger dependencies; result excerpts are replaced with a delivery-map entry. Project direction has no fabricated business task.

Changed files: src/components/workspace/{Workspace,PlanDocView,PlanActions,PlanOutlineEditor,PlanDiscussionBody,PlanDeliverables,GoalAutomationControl,DiscussionSummary,DiscussionDialogs,DraftPreview}.tsx; direction-document.css; src/components/results/{Dashboard,OverviewDetails,OverviewTree}.tsx; overviewDependencies.ts; overview-tree.css; tests/direction-ui.{browser.mjs,fixture.ts}.

## Checks

- pnpm exec tsc --noEmit: PASS against borrowed backend/navigation contracts.
- pnpm build: PASS.
- Existing overview-tree.browser.mjs: PASS (320/768/1024/1440/1920; keyboard disclosure, modal focus, truthful progress).
- New direction-ui.browser.mjs: PASS after backend goalPlan revision fix. Covers visible outline/body, source-labelled fixture photo, delivery list, no task/session created by entry or manual edit, persisted edit, approval-only creates graph without executing, explicit automation/pause, no repeat approval, Escape focus restoration, reload persistence, revised-direction combined action bound to the exact approval receipt version, no overflow at 320/768/1024/1440/1920; zero browser errors. Evidence: output/direction-ui/checks.json (ignored local output).
- pnpm test: PASS after borrowing the corresponding project-workflow.test.ts for the updated parent/child dependency contract. Domain chain passed, 249 runtime/desktop tests passed with zero failures. Repeated after the backend revision fix; log /private/tmp/quandeck-direction-ui-tests-final.log. Final tsc and build also PASS; build log /private/tmp/quandeck-direction-ui-build-final.log. The borrowed test is excluded from this commit.
- git diff --check: PASS.
- Screenshots manually inspected at 320 and 1920; removed old 760px direction width cap. Resize assertions wait for the existing finite rebound animation.
- Isolated browser uses local fixture library, a mocked SVG explicitly labelled test material, and a fake connection without runtime driver. No live model invocation, actual project writes, external media claims, push or deployment.

## Isolation

Borrowed src/data/*, src/App.tsx, src/state/WorkdeckContext.tsx, src/integration/desktop.ts and tests/project-workflow.test.ts only for compilation/integration. They are NOT staged or included in this change. Root agent owns merge, release and native integration.

## Release and recovery

GitHub remote/ref/SHA: not pushed by this subtask; no ls-remote claim. Parent has user authorization for full release.
server_before: not applicable — frontend subtask, no server deployment.
server_after: not applicable — no deployment.
health_check: local Vite/build checks only.
functional_check: isolated Chrome direction and overview suites PASS; revised-direction combination PASS. Representative expanded hierarchy screenshot: output/direction-ui/overview/project-goal-decomposition-1920.png. Shows project goal → task → nested subtasks plus real dependency labels; no result excerpts.
rollback_point: base 5185ee573682955dc07396799beeb59d35da4b46; revert this subtask commit only after parent integration. No data migration or real-data mutations in this subtask.
remaining_risks: Requires parent WorkdeckContext/App navigation and backend project direction/automation contracts, including the goalPlan revision-refresh fix. All were borrowed for validation but remain owned by their integration commits. Source Agent execution and installer verification belong to parent integration, not this browser fixture.

## Initial Git inventory

### git status --short --branch

```text
## codex/quandeck-direction-ui-20261117
```

### git branch --show-current

```text
codex/quandeck-direction-ui-20261117
```

### git rev-parse HEAD

```text
5185ee573682955dc07396799beeb59d35da4b46
```

### git remote -v

```text
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)
```

### git worktree list --porcelain

```text
worktree /Users/dengzhaoyu/Documents/AI Lab/.repositories/QuanDeck.git
bare

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-agent-dock-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-agent-dock-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-agent-health-20261116
HEAD 1061cd1ced7053a7e64762c3b3a63501ed64ec83
branch refs/heads/codex/quandeck-agent-health-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-business-lists-20261117
HEAD 6a9509fd705920b82329e73fdd2fbce7e2721ac1
branch refs/heads/codex/quandeck-business-lists-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-codex-hermes-qa
HEAD 1061cd1ced7053a7e64762c3b3a63501ed64ec83
branch refs/heads/codex/quandeck-codex-hermes-qa

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-codex-probe-20261116
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
branch refs/heads/codex/quandeck-codex-probe-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-collaboration-design-20261116
HEAD e8cb0ab68eb1c30b3efd121dd33680f49e1ace5c
branch refs/heads/codex/quandeck-collaboration-design-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-collaboration-runtime-20261116
HEAD 71011b014b81accd24960d4aaa3b4fe5c1953386
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-complete-20261116
HEAD 3cb9e8c8a8eb0856d65db2c4df7ad1000ad6bfce
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-complete-context-20261116
HEAD 0f7b382a47a2272828507d7167ff37b3c2fa92de
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-complete-policy-20261116
HEAD 7019ad925b5c1f599a71fa48df4a0db8a1756367
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-complete-storage-20261116
HEAD d125003e354bc496ce1a048e9897701f1622335a
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-connection-defaults-20261116
HEAD f47c1c54d7161fd28632b04d3e798dbbb3a50fdb
branch refs/heads/codex/quandeck-connection-defaults-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-desktop-layout-20261116
HEAD 51b66a9c7ab9560243dbec1c838124d62579f5cb
branch refs/heads/codex/quandeck-desktop-layout-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-desktop-results
HEAD 22f60d1d74b97b1c32709f0db0da7406c842ae87
branch refs/heads/codex/quandeck-desktop-results

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-direction-ui-20261117
HEAD 5185ee573682955dc07396799beeb59d35da4b46
branch refs/heads/codex/quandeck-direction-ui-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-discussion-canvas-20261117
HEAD a2774977fea79965c3c81a835ab933859126874c
branch refs/heads/codex/quandeck-discussion-canvas-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-discussion-status-20261116
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
branch refs/heads/codex/quandeck-discussion-status-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-discussion-ui-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-discussion-ui-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-dsh-profile-reuse-20261116
HEAD 6d3e942bba2b48f5d2b638854121c701e4852cb2
branch refs/heads/codex/quandeck-dsh-profile-reuse-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-dsh-schedule-20261116
HEAD f47c1c54d7161fd28632b04d3e798dbbb3a50fdb
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-console-20261117
HEAD af22b7315b7917f3ef435437402d2f6bd7464544
branch refs/heads/codex/quandeck-flow-console-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-domain-20261117
HEAD 3a4230186968ae3682e7702573781ce532164ad8
branch refs/heads/codex/quandeck-flow-domain-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-results-20261117
HEAD 765310bffd44a461f1c120718d65a88b57af3b8e
branch refs/heads/codex/quandeck-flow-results-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-functional-read-20261116
HEAD 51b66a9c7ab9560243dbec1c838124d62579f5cb
branch refs/heads/codex/quandeck-functional-read-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-goal-delivery-map-20261117
HEAD 5185ee573682955dc07396799beeb59d35da4b46
branch refs/heads/codex/quandeck-goal-delivery-map-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-goal-domain-20261117
HEAD 5185ee573682955dc07396799beeb59d35da4b46
branch refs/heads/codex/quandeck-goal-domain-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-intake-save-20261116
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
branch refs/heads/codex/quandeck-intake-save-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-interactive-planning-20261117
HEAD 5185ee573682955dc07396799beeb59d35da4b46
branch refs/heads/codex/quandeck-interactive-planning-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-local-runtime-20261116
HEAD e8cb0ab68eb1c30b3efd121dd33680f49e1ace5c
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-native-smoke-20261117
HEAD d7b6189d77c05c3d7807c3b5a3346260002dc38d
branch refs/heads/codex/quandeck-native-smoke-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-no-limits-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-no-limits-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-overview-tree-20261117
HEAD 12978bbb65b0459d677c02788988ccb3ad72efa2
branch refs/heads/codex/quandeck-overview-tree-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-plan-audit-20261116
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-project-flow-20261117
HEAD fe7e530ef21cbcd3366990ff5fce6f2de50e7fbc
branch refs/heads/codex/quandeck-project-flow-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-projects-clean-20261116
HEAD b7cee08af571d0acde8d247754f6b2f5abc981c8
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-real-progress-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-real-progress-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-release-0.7.4-20261116
HEAD cd74e61f671fda2b159d7d8153a93782c5182121
branch refs/heads/codex/quandeck-release-0.7.4-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-release-074
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
branch refs/heads/codex/quandeck-release-074

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-release-076-20261116
HEAD 2076c9c2917f317e6ca7f96b9da54b9596ef02f8
branch refs/heads/codex/quandeck-release-076-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-request-status-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-request-status-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-results-focus-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-results-focus-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-results-merge-20261116
HEAD d8f0e0de5642b9fafc21a8283e54f552980b0db8
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-rich-preview-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-rich-preview-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-schedule-history-20261117
HEAD 34ee50b10063af832717aaa0f82bd514e9e52ab8
branch refs/heads/codex/quandeck-schedule-history-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-source-release-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-source-release-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-stop-ack-20261117
HEAD 6f43149d091d80036cb47a66087b4820adcefa58
branch refs/heads/codex/quandeck-stop-ack-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-tadami-e2e
HEAD 1f965fc67adf745951d5bd92e3fa15e5f123fd3f
branch refs/heads/codex/quandeck-tadami-e2e

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-task-composer-20261117
HEAD bdfa56c33de0c342e11dafbf4a3f75a67ac40681
branch refs/heads/codex/quandeck-task-composer-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-task-icons-20261116
HEAD 2c3e0d1e64b2fb18b0d2ceb0d447cd66255f1279
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-task-input-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-task-input-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-task-map-release-20261116
HEAD b80cc430a9f80d57f8523baf1716ce8c50e0bb1b
detached

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-task-progress-scope-20261117
HEAD 4e431a2a5b391a94d05fa7df0e1b3f93011bff5f
branch refs/heads/codex/quandeck-task-progress-scope-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-visual-branding-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-visual-branding-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-visual-travel-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-visual-travel-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-workbench-polish-20261116
HEAD 51b66a9c7ab9560243dbec1c838124d62579f5cb
branch refs/heads/codex/quandeck-workbench-polish-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-workbuddy-20261116
HEAD 9b5498bbdd6e5bfe3b20eca4fbab0da73afe21ea
branch refs/heads/codex/quandeck-workbuddy-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-workspace-refresh-20261116
HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40
branch refs/heads/codex/quandeck-workspace-refresh-20261116

```
