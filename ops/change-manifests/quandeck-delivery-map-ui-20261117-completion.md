# v0.11 delivery map UI completion

task_id: quandeck-delivery-map-ui-20261117
status: COMMITTED
branch: codex/quandeck-delivery-map-ui-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-map-ui-20261117
head/local_commit: 5c131d2320de0259d4d61ea72a1e7e410d10f7d8
remote_sha: 未执行；本子任务仅提交供主任务整合，无 push。
server_before: 不适用；桌面产品 UI 子任务，无服务器部署。
server_after: 不适用；仅隔离本地预览。
health_check: TypeScript 检查与 Vite build 通过。
functional_check: 全部 domain suites 与 249/249 Node tests；隔离 Chrome 320/768/1024/1440/1920、任务子树直达、空槽、状态、历史、键盘、纯读取、真实回弹与减少动态效果通过。
rollback_point: 5c131d2320de0259d4d61ea72a1e7e410d10f7d8 的父提交 5185ee573682955dc07396799beeb59d35da4b46；主任务可 revert 本 UI 提交。

## Goal and changes

Use the saved goal delivery map and existing blackboard/ledger artifact references as the only source of delivered chapters. Slots retain blanks, exact candidate/accepted/returned/stale quality, their task/subtask origin, and real files. Project and task/subtask views share the pure display projection. No synthetic completion or manual assembly truth is created.

- Project results become a chapter index and full-width reader; task/subtask results are the same projection narrowed to that task branch.
- Remove execution-interstitial navigation, recent-results rail fragments, and permanent result bodies in WorkDetail. Keep source audit logs collapsed and original files readable.
- Keep historical manually composed documents read-only through the existing IntegrationReader and export; remove manual merge authoring controls from the primary results flow.
- Preserve sandboxed immersive HTML/media/file preview behavior. Empty project map links to project direction via root-provided openProjectDirection.

Changed files:
- `src/components/deck/ExecutionRail.tsx`
- `src/components/results/DeliveryMap.tsx`
- `src/components/results/ResultDocument.tsx`
- `src/components/results/ResultsBoard.tsx`
- `src/components/results/ResultsGallery.tsx`
- `src/components/results/ResultsIntegration.tsx`
- `src/components/results/delivery-map.css`
- `src/components/work/WorkDetail.tsx`
- `src/data/deliveryPresentation.ts`
- `tests/delivery-map.browser.mjs`
- `tests/delivery-map.fixture.ts`
- `tests/delivery-presentation.test.ts`
- `tests/result-presentation.test.ts`

## Verification

- `pnpm exec tsc --noEmit`: PASS (`output/delivery-map/typecheck-final.log`).
- `pnpm build`: PASS (`output/delivery-map/build-final.log`); existing bundle-size advisory remains.
- `pnpm test`: PASS, domain suites plus 249/249 Node tests (`output/delivery-map/tests-final-domain.log`). Initial sandbox-only attempt failed three loopback tests with EPERM; rerun with loopback access passed.
- `tests/delivery-presentation.test.ts`: actual command-created fixtures cover partial, accepted, candidate, empty, returned and stale results; exact artifact body; task/child/project scope; no broader scope for invalid child; no output/history duplication; orphan history remains readable; no snapshot mutation.
- `tests/delivery-map.browser.mjs`: PASS at 320, 768, 1024, 1440, 1920; no horizontal overflow or page error; keyboard chapter selection; direct task result scope; empty slot contains no invented document; returned original retained; no manual merge action; unchanged project storage after reads; actual expansion animation observed, suppressed under reduced motion. All five screenshots plus child 320 screenshot visually inspected.
- Existing native historical smoke selectors remain: `.qd-gallery`, button beginning `完整成果`, `.qd-integration-document` etc. Native installer smoke is owned by the main integration task, not rerun here.
- Stable native chapter selector: `.qd-map-index button[data-delivery-slot][data-state]`; selected body: `.qd-map-reader[data-delivery-slot][data-state]`. Slot IDs are persisted hashed IDs from the ledger, not title-derived guesses.

## Dependency validation and independent audit

This UI depends on the coordinated backend goalDelivery contract and root WorkdeckContext `openProjectDirection`. These files were copied read-only into this isolated worktree for combined validation and were **not staged or committed**. Source copies remain only as local validation dependencies. Their exact SHA-256 hashes at validation time:
- `src/data/runtimeSubmission.ts`: `5ca90ced759b140064ca5a56a8a0b9c0f28b863e3fe11dc81a9dc4b4eee5b684`
- `src/data/projectWorkflow.ts`: `b89d79e9dd4446076a41b5c6607c718dfcc8f5ed9241b1427b1963d4ff29747b`
- `src/data/repository.ts`: `928de9e475a377b56e61139d6e9a880a1945c40d693019ac5ab4696c943f1326`
- `src/data/goalDelivery.ts`: `925a688760be740ae70b1f94eca767938930dd58613bd70e6902224db7da61b7`
- `src/data/collaboration.ts`: `0a194e81d95950c9f29561fd7292a3c0f199af1df27735971f8705e4dd6f5c0d`
- `src/data/discussionPresentation.ts`: `d62fed675ed4279c5b2a1e27db0450b2427437461db0373261a49a9e7cc7735f`
- `src/data/types.ts`: `bae696f7cea0b1ee5ec7f964b66ab29178f9f947e66d4ab408825c781e5d1b8e`
- `src/data/contextEvidence.ts`: `4c1e4f6fe75b6ad8bbfc773935eae00832b3081e9828d60ae482e2c8269409ae`
- `src/data/runtimeDataSource.ts`: `fc98e1e70fef50d6b212b67fd905193fcb76b88ce5841cb67ec933ab60541914`
- `src/state/WorkdeckContext.tsx`: `75270824d45a8a6c1e83f8d7d057ea2508bd1370e7f683ba1d40eed8197e5e6b`
- `src/integration/desktop.ts`: `7529c20241e9d7f95dca0c5a327bd7b232ec17334f5195beb48546d36ca1f165`
- `tests/project-workflow.test.ts`: `41ebf848af471fdfec7c15fe1ef2879e0771d05fa3e7c5e6fbddb9574643ace6`
- `tests/goal-delivery.test.ts`: `a0ab5f0d2e65b5cda79906d0f4158be2f7cfcfd42b7eedd5f9e110e2695bcde0`
- `scripts/test.mjs`: `f2c9146b2bf5afd66116ea4f0306ba11d2e2fcf021bdc849aedde7ceebf81f09`

Independent read-only audit reproduced two backend defects and sent exact reproductions to the backend owner and main integrator:
1. Manual artifact with absent run ID incorrectly linked an unrelated legacy session via undefined equality. Fixed by requiring a real run and exact project/task/work-item binding. Same actual-command reproduction now returns no unrelated source.
2. Task-plan revision changed the old specification in place, then saved an obsolete binding revision. Fixed to preserve revision 1, append revision 2 and bind the current revision. Same reproduction now keeps the old destination in historical spec and leaves the new chapter empty, not accepted or permanently stale.

Latest full test and UI reruns include those fixes. A transient strict TypeScript narrowing error in the borrowed backend mapping was reported to its owner and fixed before the final passing tsc/test/build run. Restart review verifies completed, unknown-admission and reserved-before-crash receipts are not automatically replayed; multi-slot artifacts require explicit slot IDs; latest-version projection does not use old accepted results as current delivery. No backend files changed by this UI task.

## Integration and remaining limits

- Main App listens for `quandeck:show-results` to close workspace and select project results. This UI emits the event; App is outside this commit.
- Main task owns the final backend/Context commits, native smoke, package build, PRD and GitHub release. This subtask does not claim a pushed or released state.
- No user project files, real workspaces, provider connections or conversations were mutated. Browser checks used a new headless Chrome profile and isolated fixture storage.
- No new fake travel images, map distances, progress percentages or acceptances were added. Existing HTML/map/media previews remain bound to actual stored artifacts.

## Git inventory before changes

```text
$ git status --short --branch
## codex/quandeck-delivery-map-ui-20261117


$ git branch --show-current
codex/quandeck-delivery-map-ui-20261117


$ git rev-parse HEAD
5185ee573682955dc07396799beeb59d35da4b46


$ git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)


$ git worktree list --porcelain
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

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-map-ui-20261117
HEAD 5185ee573682955dc07396799beeb59d35da4b46
branch refs/heads/codex/quandeck-delivery-map-ui-20261117

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
