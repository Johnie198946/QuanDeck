# QuanDeck 0.12 协作闭环源码验收快照

- task_id: quandeck-permissions-spec-flow-20261117
- status: COMMITTED（已集成本地提交；本文件是发布前源码验收快照，最终发布回执见 Release verification.json）
- branch: codex/quandeck-permissions-spec-flow-20261117
- worktree: <task-worktree>（独立工作树；完整本机盘点保留在私有验收目录）
- baseline / rollback_point: 70c74ae114b70ecb1061f594196b19a6177334ac（v0.11.1）；保留更新前应用与一致性 SQLite 备份
- commit SHA: 具体构建提交由 v0.12.0 的 verification.json 固定，不在文件内伪造自引用 SHA
- remote: origin / https://github.com/Johnie198946/QuanDeck.git
- remote/ref/SHA: 发布流程尚未在本快照中宣告完成；最终以 git ls-remote 与 Release verification.json 核对
- server_before: 不适用，无服务器部署；本机基线 0.11.1
- server_after: 不适用，无服务器部署；本机候选 0.12.0 完成原生验收
- health_check: 类型检查、领域与协议回归、生产构建、38项发布门禁通过；最终组合测试数量见审计文档与同提交 CI
- functional_check: 真实安装版完成项目创建、方向讨论、三主四子拆分、子任务讨论、依赖自动执行、五个输出槽自动归位、七项顺序验收、规范附件全文发布及新任务固定版本复用

## 开工 Git 盘点

源工作树分支 codex/quandeck-live-repair-20261117，HEAD 70c74ae114b70ecb1061f594196b19a6177334ac。status 存在两个未跟踪的桥接脚本副本，未覆盖、暂存或提交。remote fetch/push 均为上述 origin。git worktree list --porcelain 已记录，为本任务新建独立分支及工作树，初始 status clean。原始 status、branch、HEAD、remote 与 worktree 输出保存在本机私有盘点文件。

## 变更文件与目标

- desktop/app/agent-bridge.mjs 及相关协议测试：源权限选项、账户查询与执行受理边界、恢复与回执。
- src/data/、src/domain/、src/services/ 及对应测试：任务范围、方向版本、依赖调度、候选投影、项目规范来源与上下文继承。
- src/components/ 及样式：可见进展、方向正文阅读与抽屉、候选直接核对、附件预览稳定性、规范全文导入与发布。
- package.json、desktop/package.json、desktop/app/package.json 及锁文件：0.12.0。
- docs/permissions-spec-flow-audit.md、desktop/README.md、本轮子任务 manifests：实现边界、实机验收与发布说明。
- Figma PRD 第25节：同步真实验收、权限边界和规范真源约定。

## 实机证据

五份实际输出文件存在，合并 HTML 与 Markdown 正文逐项一致，示例中的未完成交付与验收单元格保持空白。成果自动归位不依赖手工汇总。最终成果先于前置验收时被正确拒绝；按依赖核对后显示5/5已认可。预览在连续快照更新中保持打开。

规范发布固定两章正文、原件 SHA-256、导入回执与来源任务。新普通任务直接执行，实际源请求和交付引用同一规范版本与指纹；黑板指向该台帐版本。未改写旧上下文或历史记录。

## 发布和回滚

用户已授权完整 GitHub 发布；最终须合入 main，核对分支/标签/远端 SHA，由该提交构建 Mac arm64 和 Windows x64，双平台原生安装检查通过后发布。发布事实及下载见 https://github.com/Johnie198946/QuanDeck/releases/tag/v0.12.0；此链接不代表本源码快照已完成发布。

回滚使用 v0.11.1 安装包或保留的旧应用。数据库只在停机和核对新增记录后使用一致性备份恢复，不能覆盖升级后的用户记录。其他任务工作树与真实项目保留。

## 已知边界

源会话授权不自动覆盖未来新会话；仅展示源端实际支持的选项。规范全文导入支持 UTF-8 .md/.txt，普通 PDF/Word 预览不等于正文导入。候选、验收与规范发布分别记录。macOS 未 Apple 公证，Windows 未代码签名。私有数据、源请求、数据库和安装包不进入 Git。
