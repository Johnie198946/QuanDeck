# QuanDeck 目标到自动交付完成记录

- task_id: quandeck-goal-delivery-map-20261117
- status: TESTED
- branch: codex/quandeck-goal-delivery-map-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-goal-delivery-map-20261117
- base_commit: 5185ee573682955dc07396799beeb59d35da4b46
- commit: 本文与代码一同提交；准确构建 SHA 由 Release verification.json 记录
- remote/ref: origin / refs/heads/main
- remote_sha: 未推送本轮改动

## 目标与分工

项目方向与任务方向一级入口；真实大纲与正文；目标层级/依赖视图；版本化自动拆解、按依赖执行；预定义多交付槽自动拼接；项目、任务与子任务成果地图集中阅读。保留图文讨论、来源核对、真实进度、附件和时间轮盘。

独立工作树分别实现后端自动流程、方向与总览、成果地图；本任务负责导航、跨进程命令、集成、原生验收、PRD及发布。不覆盖其他任务改动。

## 开工前 Git 盘点

```text
$ git status --short --branch
## codex/quandeck-goal-delivery-map-20261117

$ git branch --show-current
codex/quandeck-goal-delivery-map-20261117

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

## 校验

- Native workflow 12 项测试通过（合并前局部验证）。
- 发布校验 Python 32 项通过（含 0.11 必需的交付地图验收门禁）。
- 完整类型、领域、构建、界面及两平台原生验证：待完成。

## 授权及发布

用户本轮明确要求完成后推送 GitHub、更新 PRD；按项目约定包含 main 合并、远端 SHA 核对、Apple Silicon 与 Windows x64 安装包 Release。未授权新增服务器部署。

Figma PRD 0:5 已新增第 23 章“V0.11 目标拆解与自动交付（实现与验收中）”，未将尚未通过的检查写成完成。

## 服务器与回滚

- server_before: 不适用，桌面应用；无服务器部署。
- server_after: 不适用，桌面应用；无服务器部署。
- health_check: 待完整原生启动检查。
- functional_check: 待完整功能检查。
- rollback_point: v0.10.0 / 5185ee573682955dc07396799beeb59d35da4b46；更新本机前另备份当前数据与应用。
- 风险/未完成: 当前仍在实现与合并验证，未提交或发布。候选结果不能冒充人工验收；外部权限等待必须保留。

## 最终本地组合验收（2026-11-17）

- TypeScript：`pnpm exec tsc --noEmit` PASS。
- 完整领域回归（含 goal-delivery、delivery-presentation）及 Node runtime/desktop：254/254 PASS。初次沙箱运行有三个本地端口监听 EPERM；允许本地端口后完整重跑通过。
- 发行门禁：32/32 Python tests PASS。
- `pnpm build` PASS；`git diff --check` PASS。
- direction-ui.browser：大纲、正文、图文、编辑、仅确认、自动执行/暂停、改版确认、无重复确认；320/768/1024/1440/1920，0页面错误。
- delivery-map.browser：候选/认可/留白/退回、历史、子任务范围、键盘、回弹、减少动态效果；同五档窗口，0页面错误，阅读不改变台帐。
- Mac 原生预检：0.11.0 arm64，隔离临时资料；新项目方向不造业务任务、方向正文落盘、真实双槽/部分交付、候选不等于人工认可全部 PASS。其余 SQLite、附件上传与保留、旧版整合、维护接口、认证检查全部 PASS。
- 原生测试只登记隔离离线身份；不伪装实际模型运行，也未调用用户 Agent。自动依赖链由协议驱动的领域回归验证；实际源 Agent 的访问权限仍由源端负责。

## 变更边界

- 数据：goalDelivery/projectWorkflow/collaboration/runtimeDataSource/repository/types/contextEvidence/runtimeSubmission/discussionPresentation。
- 前端：方向大纲正文与版本操作、总览目标图、任务行直接入口、集中成果地图与图文阅读；跨项目导航一致性。
- 桌面：确认回执版本绑定、退出时停止并等待自动派发、交付地图历史不可改写、隔离原生验收。
- 交付：0.11.0版本、Mac arm64/Windows x64验收门禁、设计说明与Figma PRD第23章。
- 所有分支文件以本任务相对 v0.10.0 的 Git diff 为准；其他任务工作树均保留。

## 发布与回滚

- 当前阶段：本地 TESTED，准备提交及推送；不得把此条当作已经发包。实际 GitHub SHA/安装包验收以 Release 的 verification.json 和最终完成回执为准。
- server_before / server_after / health_check：不适用，本次为桌面程序，无服务器部署。
- functional_check：上述本地组合检查通过；两个平台的最终安装/启动/卸载验证由相同构建提交的 GitHub CI执行。
- rollback_point：v0.10.0 / 5185ee573682955dc07396799beeb59d35da4b46；安装前另备份现有应用和SQLite。
- remaining_risks：Mac ad-hoc签名未公证，Windows未代码签名；权限等待/失败/受理不明不会被自动绕过。
- PRD：https://www.figma.com/spec/bydWIwQXe6uqTgH0AWHhgg/QuanDeck?node-id=0-1 。
