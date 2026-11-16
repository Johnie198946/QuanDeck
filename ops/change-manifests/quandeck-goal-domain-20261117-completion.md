# Completion manifest: quandeck-goal-domain-20261117

task_id: quandeck-goal-domain-20261117
status: COMMITTED
branch: codex/quandeck-goal-domain-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-goal-domain-20261117
head/local_commit: 7d0d0fb4c55d9fd3fe1eafefde5950745fec870e
remote_sha: 未执行；根任务负责集成、push 与版本发布，本子任务不进行外部写入。

## 目标与实现

将项目方向、任务图与交付结构保存到现有项目台帐，从台帐推导黑板与成果地图。项目方向没有虚构的可执行业务根任务；真实独立任务可有多层子任务与跨根依赖。方向正文可编辑、版本确认可幂等重放，方向改版保留真实任务身份与旧要求/计划事实。

显式确认方向并开启自动执行后，空方向仅请求一次结构化拆解；任务按依赖推进，父层使用子交付后再汇总。授权绑定计划/方向/任务要求版本。未知受理或恢复中的预留派发不会盲目重试；权限、失败或用户回复等待保持可见。退出前可 stopGoalAutomation() 停止本进程派发并 drain，不撤销保存的用户授权。

地图仅引用实际 submitted artifact。候选、用户已验收、退回、过期、未填槽分别显示；同任务多槽需要明确 deliverySlotIds，不能用一份泛化回复填满全部空位。自动推进不执行人工验收、不自动批准权限或购买外联。人工成果没有 runId 时不会关联其他任务的历史会话。

## 变更文件

```
scripts/test.mjs
src/data/collaboration.ts
src/data/contextEvidence.ts
src/data/discussionFeedback.ts
src/data/discussionPresentation.ts
src/data/goalDelivery.ts
src/data/projectWorkflow.ts
src/data/repository.ts
src/data/runtimeDataSource.ts
src/data/runtimeSubmission.ts
src/data/types.ts
tests/discussion-visual.test.ts
tests/goal-delivery.test.ts
tests/project-workflow.test.ts
```

## 开工前 Git 盘点

任务使用独立分支和独立工作树。初始工作树 clean，未覆盖其他任务/用户文件；仅显式暂存上列文件。依赖使用已有 node_modules 的目录链接，没有提交依赖目录。

```
$ git status --short --branch
## codex/quandeck-goal-domain-20261117

$ git branch --show-current
codex/quandeck-goal-domain-20261117

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

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-desktop-layout-20261116
HEAD 51b66a9c7ab9560243dbec1c838124d62579f5cb
branch refs/heads/codex/quandeck-desktop-layout-20261116

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-desktop-results
HEAD 22f60d1d74b97b1c32709f0db0da7406c842ae87
branch refs/heads/codex/quandeck-desktop-results

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

## 测试与校验

- `pnpm exec tsc --noEmit`：通过。
- `pnpm test`：完整领域测试与 249 个 Node 测试通过，0 failed。证据 `output/goal-domain/test-final.log`。
- `pnpm build`：通过。证据 `output/goal-domain/build-final.log`。保留已有 minified chunk >500KB 非阻塞提醒。
- 新增 `goal-delivery.test.ts`：空方向→一次拆解→多层独立任务图→候选依赖链→多槽交付；方向确认不隐式执行；权限等待；切项目隔离；完整链重启不重派；unknown 受理与 reserved 崩溃恢复不重派；任务要求变化失效；新方向保留 task key、旧 immutable facts、绑定最新 spec；子任务局部方向正确父级；停止 scheduler 后不继续派发；人工结果不冒认源会话。通过。
- task-scope 同 key 目标更新新增回归在完整测试后补充，单独编译并运行 `goal-delivery.test.js` 再次通过；旧 spec 未改写，新绑定匹配当前要求。
- `discussion-visual.test.ts` 新增 project scope 空 taskId 卡片反馈回归：通过，仍拒绝错误 task 绑定。
- `git diff --check`：通过。
- UI 协作验证（由 console_flow 执行并报告）：direction-ui.browser.mjs 通过，含手动改方向后的组合确认/启动，新授权版本等于采用版本，0 browser errors。
- 独立来源与修订审查（由 results_immersive 执行并报告）：manual artifact 不再链接 unrelated legacy source；task-scope 修订保存旧 spec，新 binding 与当前 spec 均为新 revision。

## API 与集成注意

- ensureProjectPlan(projectId?)、savePlanOutline(planId, sections, expectedDraftVersion, projectId?)、configureGoalAutomation(planId, {enabled, agentId?, expectedDraftVersion}, projectId?)。
- approvePlan 返回 approvedDraftVersion；组合确认执行必须使用该回执版本，不使用过时闭包或重新加载后的任意版本。
- runtime.stopGoalAutomation(): Promise<void> 应在关闭 driver/runtime 之前 await；它保留持久化授权。
- deriveDeliveryMap / deriveGoalAutomation 为只读投影；sourceSessionId 是 QuanDeck 本地 snapshot.sessions key。
- 若方向上一版仍有未确认停止/未知受理的源执行，采用新版会要求先核对原会话，避免重复执行。

## 外部写入、部署与回滚

GitHub remote/ref/SHA: origin https://github.com/Johnie198946/QuanDeck.git；本子任务没有 push，没有远端 SHA 证据，不声称 PUSHED。
server_before: 不适用；纯本地领域/runtime 实现。
server_after: 不适用；没有服务器部署。
health_check: 不适用；没有部署。编译/构建成功仅为本地校验。
functional_check: 上述合成隔离数据的状态链、幂等/恢复/版本/跨项目/来源回归通过；未操作用户真实项目数据或调用真实 Agent。
rollback_point: 基线 5185ee573682955dc07396799beeb59d35da4b46；根集成可 revert 此单独功能提交，保留存量数据备份，不能破坏旧台帐事实。

## 风险与未完成项

- 真正 Agent、权限弹窗、原生窗口和 GitHub 发布由根任务在集成后验证；本子任务不冒称已完成这些环节。
- Agent 必须按协议返回实际任务结构与真实成果。无效/缺少结构或交付槽会保留缺失状态，不凭空编造完成。
- 未确认的派发不自动重试；需先核对源会话，避免重复外部动作。
- 自动完成的是任务交付组装，用户验收记录仍需用户作出，accepted 数量不会随候选自动增加。
