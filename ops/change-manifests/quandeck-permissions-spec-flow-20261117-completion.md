# QuanDeck 权限、真实进展、规范与完整流程

- task_id: quandeck-permissions-spec-flow-20261117
- status: LOCAL_ONLY（集成中；此前子任务已有本地提交）
- branch: codex/quandeck-permissions-spec-flow-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-permissions-spec-flow-20261117
- baseline / rollback_point: 70c74ae114b70ecb1061f594196b19a6177334ac（v0.11.1）；真实数据库另有本机一致性备份
- remote: origin / https://github.com/Johnie198946/QuanDeck.git
- remote_sha: 本轮尚未推送，未声称远端完成
- server_before: 不适用，桌面应用；本机版本0.11.1
- server_after: 尚未更新
- health_check: 第一轮集成TypeScript和281项协议测试及领域测试通过，新增修复仍在继续
- functional_check: 原生创建项目、项目讨论、确认后生成3主任务4子任务5输出槽已观察；剩余流程进行中

## 开工盘点

源工作树 codex/quandeck-live-repair-20261117，HEAD 70c74ae114b70ecb1061f594196b19a6177334ac，存在未跟踪的 desktop/app/agent-bridge 2.mjs 与 3.mjs，未覆盖、暂存或提交。git remote -v 为上述origin（fetch/push）；git worktree list --porcelain已记录并为本任务新建独立工作树。新工作树初始clean。完整原始盘点在本机私有验收目录，业务数据不进入公开仓库。

## 范围

源Agent授权选项与响应协议、已采纳方向的等待投影、讨论交接窗口、可见进展轨迹、项目规范来源与版本、任务范围讨论及空拆分草稿、真实页面交互整合；同步PRD并发布安装包。

## 验收证据与未完成项

当前没有以单元测试或隔离浏览器替代真实完整流程。验收过程中发现的JSON原文回退、重复拆分、旧等待提醒与附件正文继承缺口纳入修复；未完成部分不标通过。候选不等于验收；原型文件存在不等于正式产品集成。

## 回滚

使用v0.11.1安装包及更新前应用副本恢复应用；数据库只使用停机前一致性备份恢复，不能覆盖更新后新增的用户记录。保留全部真实项目、运行、成果和不可变历史。
