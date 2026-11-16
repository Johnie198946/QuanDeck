# QuanDeck 实际使用界面修复

- task_id: quandeck-live-ui-repair-20261117
- status: COMMITTED
- branch: codex/quandeck-live-ui-repair-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-live-ui-repair-20261117
- implementation_commit: 97b5cb7bf9f60aa71e31ca2dd63ab048e4e332ef
- remote_sha: 未执行 push，由主任务集成后发布
- server_before: 不适用，桌面客户端子任务
- server_after: 不适用，未安装到用户应用
- health_check: TypeScript 与 Vite 构建通过
- functional_check: domain suite + 254 Node tests 通过；隔离浏览器两套回归通过
- rollback_point: f2fba51341addc507e74e56d60424f3b8a226015

## 实际问题与修复

1. 用户截图中大窗口方向页仅占左侧约 380 CSS px、标题一字一行。旧 workbench-display 大屏双列规则覆盖了新版单列规则；时间线已经变成 fixed drawer，工作区却仍排在旧第一列。修复非专注模式的选择器优先级，并加容器适配。已有回归只验 focus 模式，新增普通/专注模式双路径验收。
2. 顶部创建任务 Composer 没有 paste handler，只有任务补充 TaskInput 支持图片。统一接入剪贴板 File、文件拖入、缩略图、纯附件创建，多行输入保留 Shift+Enter；缩略图 URL 释放。
3. 默认手工创建没有调用标题归纳服务。先原子保存真实需求和附件，再异步调用现有标题服务；失败不阻塞创建，不制造 AI 成功。标题编辑前置，首次和反复手动改名都保留原始需求，空标题拒绝。AI 服务仍负责版本校验，迟到结果不得覆盖人工标题。
4. 长需求在方向页以可读标题与完整需求展开区显示，讨论侧栏重复全文收拢。
5. 未匹配 Agent ID 不再作为“未配置 Agent”建议展示；未执行任务不伪造负责人。
6. 父任务标题、任务进度和子节点使用真实当前请求的等待授权/回复/异常数量，避免粗粒度暂停状态遮住问题。真实数据投影补丁由主任务另一子任务负责合并。

## 变更文件

```
src/components/journal/Composer.tsx
src/components/journal/OrchestrationBlock.tsx
src/components/journal/TaskProgress.tsx
src/components/journal/TaskRow.tsx
src/components/journal/composer-input.css
src/components/layout/workspace-refresh.css
src/components/workspace/DiscussionSummary.tsx
src/components/workspace/PlanDocView.tsx
src/components/workspace/direction-document.css
src/data/orchestration.ts
src/data/repository.ts
src/data/taskExecutionPresentation.ts
tests/execution-progress.test.ts
tests/live-ui-repair.browser.mjs
tests/task-identity.test.ts
```

## 开工前 Git 盘点

- status: clean（`## codex/quandeck-live-ui-repair-20261117`）
- branch: codex/quandeck-live-ui-repair-20261117
- HEAD: f2fba51341addc507e74e56d60424f3b8a226015
- remote: origin https://github.com/Johnie198946/QuanDeck.git (fetch/push)
- worktree: 独立新增工作树，无共享 main，无共享 stash；完整 `git worktree list --porcelain` 与其余四项命令记录在 `/private/tmp/quandeck-live-repair-20261117/ui-git-before.txt`。

## 校验

- `pnpm exec tsc --noEmit`: PASS
- `pnpm build`: PASS，已有 bundle size 提示
- `pnpm test`: PASS，domain 测试及 254 Node tests；首轮因新 worktree 缺 desktop/app/node_modules 失败，连接现有锁定依赖后重跑全部通过。
- `tests/live-ui-repair.browser.mjs`: PASS，浏览器 ClipboardEvent 截图夹具、缩略图、附件持久化、离线创建不阻塞、手动改名原文保留、文件拖入/纯附件、长需求方向页普通/专注窗口。
- 窗口宽度: 320 / 768 / 1024 / 1440 / 1920 / 2560；页面无水平溢出，大窗正文列宽可读。
- `tests/direction-ui.browser.mjs`: PASS，方向大纲、正文、图文讨论、版本确认、自动执行开关、键盘焦点、响应式保留。
- 浏览器错误: 0。图片和页面证据保留在本 worktree `output/live-ui-repair/`、`output/direction-ui/`，不提交用户数据。
- `git diff --check`: PASS

## 风险与未完成项

- 本子任务没有连接真实模型，也未操作真实用户数据库；真实桌面安装和端到端执行由主任务完成后再通报。
- 自动标题使用已有真实服务；服务不可用时保留原文、允许手工改名和重试，不声称已自动精简。
- 依赖等待的运行态投影需要与并行修复共同验收。
- 未单独推送或发布；应由主任务统一推送、更新 PRD 和安装包。
- 回滚：撤销实现 commit，用户的任务与附件不被删除。
