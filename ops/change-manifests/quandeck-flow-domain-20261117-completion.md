# QuanDeck project flow domain completion

- task_id: quandeck-flow-domain-20261117
- status: COMMITTED
- branch: codex/quandeck-flow-domain-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-domain-20261117
- head/local_commit: 7f510d2b84cecc18c59c54017e8773013d0a5dd7 (implementation; this manifest follows in a documentation commit)
- remote_sha: 未执行；交由主任务统一合并和推送
- server_before: 不适用；本任务不部署服务器
- server_after: 不适用；本任务不部署服务器
- health_check: 不适用；没有服务器变更
- functional_check: TypeScript、完整 domain suite、232 Node tests、Vite build 全部通过
- rollback_point: 01e24ee09deaa5e9ddf804e572b23b0a2313c185

## 开工盘点

- status: clean (`## codex/quandeck-flow-domain-20261117`)
- branch: codex/quandeck-flow-domain-20261117
- HEAD: 01e24ee09deaa5e9ddf804e572b23b0a2313c185
- remote: origin https://github.com/Johnie198946/QuanDeck.git (fetch/push)
- worktree: 独立工作树，从主任务整理的 0.8.3 改动基线建立，未编辑其他任务工作树。
- 完整 `git worktree list --porcelain` 与盘点命令输出: 本地 `output/flow-domain/git-before.txt`。

## 结果与接口

- `approvePlan(planId, conclusionId?, projectId?, expectedDraftVersion?)`: 单次方向确认，版本检查、幂等创建已校验任务树；旧会话无结构化任务时只确认方向，不伪造任务。
- `recordPlanConfirmation(planId, conclusionId, confirmed, projectId?)`: 将用户明确确认/补充的信息写成既有台帐的人工作出的决定。重复输入不追加决定；补充已确认信息不重新打开方向审批。
- `startDiscussion(planId, agentId?, scope?, projectId?)`: 独立、显式的讨论；方向已确认后只进行拆解，确认版本未变化时将合法拆解直接导入，不二次确认方向。
- `dispatchProjectTask(projectId, taskId, agentId, itemId?)`: 不切换当前项目的执行入口。
- `controlSession(..., 'reply', {prompt, confirmedInformation?, conclusionId?})`: 先持久化确认，再发送简明补充及既有确认上下文；不把确认 metadata 传给外部驱动。
- 结论的 `tasks` 字段支持任意层级的 parentKey、跨分支依赖和交付标准；验证重复键、悬空引用、层级循环及父子依赖死锁。
- 普通讨论段落/偏好/问题不自动变成执行任务；合成 `planning:` 执行保留在台帐和会话历史，不新增业务任务行。`isBusinessTask` 供业务计数过滤。
- 父任务 claim 与 runtime dispatch 都在子任务完成有效验收前拒绝执行；汇总上下文强制固定完整的已验收直接子成果，不因检索关键词或可选资料截断丢失。
- 没有增加 Token 限制，也没有自动改变源 Agent 权限或确认第三方操作。

## 校验

- `pnpm exec tsc --noEmit`: PASS
- `pnpm test`: PASS；新增 project-workflow suite + 全部既有 domain suite + 232/232 Node tests
- `pnpm build`: PASS；已有主包 >500 kB 提示保留
- `git diff --check`: PASS
- 初次受限环境测试仅三个 localhost 服务因 `listen EPERM` 失败；获准以本机测试权限重跑全部通过。
- 本地日志: `output/flow-domain/test-final.log`, `output/flow-domain/build.log`。

## 变更文件

```text
scripts/runtime/discussion-style.mjs
scripts/test.mjs
src/data/collaboration.ts
src/data/commands.ts
src/data/discussionPresentation.ts
src/data/httpRepository.ts
src/data/ideaEngine.ts
src/data/projectWorkflow.ts
src/data/repository.ts
src/data/runtimeContracts.ts
src/data/runtimeDataSource.ts
src/data/runtimeSubmission.ts
src/data/types.ts
tests/project-workflow.test.ts
tests/results.test.ts
tests/runtime-data.test.ts
tests/task-attachments.test.ts
```

## 风险与未完成项

- 本分支只交付后端和测试；主任务负责桌面控制台按钮、业务计数过滤、视觉验收、合并推送及安装包发布。
- 历史讨论没有结构化任务时，确认后需要一次显式拆解请求；不会把旧纯文字建议猜测成任务。
- 历史源记录与项目成果未迁移或删除。
- 回滚: revert implementation commit，保留已落盘历史；新增可选任务/结论字段向后兼容。
