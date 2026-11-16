# QuanDeck 项目流程与沉浸成果交付

- task_id: quandeck-project-flow-20261117
- status: TESTED（本文件提交时；GitHub及安装包回执随后追加至交付记录）
- branch: codex/quandeck-project-flow-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-project-flow-20261117
- base/head_before: 9437658bb445e422d76d4b9d40bc0fabc2490d40
- commit: 本文件所在提交；最终构建SHA见发布清单
- remote: origin / https://github.com/Johnie198946/QuanDeck.git
- remote_before: refs/heads/main = 3cb9e8c8a8eb0856d65db2c4df7ad1000ad6bfce（git ls-remote核对）
- remote_after: 尚未推送，不以本地commit冒充远端

## 开工盘点与隔离

原任务分支 codex/quandeck-visual-travel-20261116、HEAD 9437658bb445e422d76d4b9d40bc0fabc2490d40；有122个本任务前序改动。新建上述独立分支和工作树，仅移入经核对的122个文件，保留原工作树与其他任务改动。新工作树最初状态为122个对应modified/untracked文件，已固化到01e24ee。无共享stash，无main开发，无清理外部工作树。

完整盘点由 git status --short --branch、git branch --show-current、git rev-parse HEAD、git remote -v、git worktree list --porcelain 获取，工作记录在 output/project-flow/git-before.txt、new-worktree-before.txt、inherited-files.json。并行实现使用独立console/domain/results/stop-ack/business-lists工作树，按提交合并；各自manifest记录具体HEAD和校验。

## 目标与变更

1. 明确讨论与执行，普通任务创建不要求聊天，任务标题直接打开详情，手动补充与Agent入口保留。
2. 用户确认带版本方案后，任务图校验并导入；新拆分回复不重复确认方向。台帐是事实源，黑板可重建。父任务必须等待必要子成果验收并固定全部子成果上下文。
3. 旧窗口禁止采用新会话结论，未知源停止回执禁止新执行；删除说明具体阻塞并提供停止/归档入口。
4. 显示真实活动、耗时、阶段，未知总量不伪造百分比。去除QuanDeck token限额，保留用量记录。
5. 精简回复、直接结论详情、正确Agent图标、图片/视频/PDF/Excel/Word附件预览，安全HTML沉浸阅读、按需地图、宽窄适配与回弹。
6. 排除历史synthetic planning记录的业务任务统计和选择，保留原始历史。
7. 更新Figma PRD 0:5：6.8/6.9/6.10、19.6、20.4/20.6及新21章，写后回读验证成功。代码说明 docs/project-workflow-v0.9.md。
8. 版本0.9.0；仅Apple Silicon Mac与Windows x64。

主要变更：src/data/projectWorkflow.ts、ideaEngine.ts、repository.ts、collaboration.ts、runtimeDataSource.ts、deletion.ts、businessTasks.ts；desktop/app/run-workflow.mjs、main.mjs、attachment-preview.mjs；RuntimeConsole/PlanActions/TaskDirectView/ResultsBoard/OutputPreview/HtmlPreview及对应样式；driver、discussion-style、测试与打包配置。完整文件集以本分支相对base的git diff --name-only为准。

## 验证

- pnpm exec tsc --noEmit：通过。
- pnpm test：全部领域测试通过，244/244 Node测试通过（真实本地回环与子进程fixture，非源模型质量验收）。
- pnpm build：通过；现有bundle体积提示保留。
- 发布校验脚本30/30测试通过。
- runtime-ui.browser：1440/1024/768/320宽度，确认/已存草稿/失败保留/源端跳转/Word与Excel预览通过。
- workspace-ui.browser：手动任务、要求持久化、四种宽度通过，无console errors。
- immersive-results.browser：320/768/1024/1440/1920宽度、被动HTML、零预加载外网请求、Escape与焦点恢复通过；宽屏正文>1000px及标题无遮挡通过。
- 真实泰国HTML攻略的10张内嵌照片验证成功；不冒充新一次旅行资料检索。
- 原生安装与GitHub构建：本文件提交时尚未执行本版，待发布回执。

## 部署、风险与回滚

- server_before: 不适用，本次为桌面应用，无服务器部署。
- server_after: 不适用。
- health_check: 本地类型检查、构建及浏览器无错误；服务器健康检查不适用。
- functional_check: 上述自动化与浏览器校验；平台安装回执待补。
- rollback_point: 远端main 3cb9e8c8a8eb0856d65db2c4df7ad1000ad6bfce / v0.8.0；本机现有0.8.3应用与用户数据库在替换前备份。
- remaining_risks: 被动HTML不执行脚本、不自动读相对本地资源；外部恢复会话缺少停止证据时保留阻塞并提示回源核对；真实Agent网络/能力由源端决定，测试不声称全部模型质量通过。
- 新增后续请求：讨论中的图文交互画布、轮盘时间事实、总览树和折叠图片输入，将在本版收尾后独立任务继续，不伪称已经包含。

回滚通过安装上一版桌面包与已保留数据备份；不得对用户工作树执行reset或覆盖新产生的数据。仓库回滚应新增revert提交保留历史。

## 主线合并与跨平台追加验证

- f8704ef30767bc8da5b1cb944585812c7f980142 已合并远端独立设置布局修复3cb9e8c，并推送main/任务分支；git ls-remote两者均为该SHA。
- GitHub构建43916645424：Mac完整测试、DMG构建、安装/启动/维护/卸载通过；Windows发现测试工具对CRLF换行不兼容（退出生命周期fixture未去除import），没有跳过测试。现修正并增加LF/CRLF双组回归，4/4通过；后续提交重新跑两平台安装流水线。
- 本机0.9.0已替换并经CUA打开真实项目与HTML攻略，照片、沉浸阅读和Escape退出正常。回滚应用 /Applications/QuanDeck-before-090.app 及 /private/tmp/quandeck-before-090.app；数据备份 /private/tmp/quandeck-before-090-workspace.sqlite。
