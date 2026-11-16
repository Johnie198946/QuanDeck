# quandeck-candidate-attention-20261117

- task_id: quandeck-candidate-attention-20261117
- status: COMMITTED
- branch: codex/quandeck-candidate-attention-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-candidate-attention-20261117
- base/rollback_point: 272fb517465d0db31d5c788c7b0f6b18df169ff9
- commit: 4b5a48a028975e1528f23d6005661b421e3e036d (implementation; this manifest is a separate documentation commit)
- remote_sha: 未执行；由根任务负责合并、推送和远端 SHA 验证

## Problem and change

A successfully stored complete candidate left its source in `waiting_reply`. The execution rail counted it as needing user input, while the domain correctly rejected ordinary replies to an `in_review` task. The console allowed input that could never succeed.

`sessionDelivery.ts` now derives exact-session delivery from the latest task submission, run binding, specification and current delivery plan. Activity projection excludes only idle, complete submitted sources without real pending requests or submission errors. Source lifecycle and all immutable facts stay unchanged. Partial delivery, source questions/permissions and rejected submissions remain visible.

The desktop host exposes the same derived delivery to RuntimeConsole. The console displays candidate/accepted delivery, replaces the invalid text composer with “查看成果” and “修改任务要求”, and hides the misleading waiting progress for idle delivered sources. Original draft text/files remain stored. Navigation opens the original project/task/subtask, even when another project is active. Opening revision direction does not reopen, resume or approve an execution; subsequent changes use existing task version/claim controls.

Changed files: `src/data/sessionDelivery.ts`, `src/data/projectActivity.ts`, `src/data/runtimeDataSource.ts`, `desktop/app/run-workflow.mjs`, `src/integration/desktop.ts`, `src/state/WorkdeckContext.tsx`, `src/components/runtime/RuntimeConsole.tsx`, `tests/partial-delivery.test.ts`, `desktop/run-workflow.test.mjs`, this manifest.

## Verification

- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: passed all domain regressions and 260 Node subtests (0 failures).
- `pnpm build`: passed; existing large bundle warning remains.
- Focused partial-delivery and execution-progress regressions passed; desktop run workflow 16/16 passed.
- Added checks: complete candidate is quiet without source mutation; partial remains actionable; actual question/permission/error still visible; other run cannot inherit completion; accepted output label; console blocks ordinary reply/resume; original project and leaf navigation; navigation does not dispatch or reopen; stale metadata rejected.
- `git diff --check`: passed.
- Test log: /private/tmp/quandeck-live-repair-20261117/candidate-attention-tests.log (local validation output, not committed).

## Delivery boundary

- server_before: 不适用；未部署服务器。
- server_after: 不适用；未部署服务器。
- health_check: 本地类型检查、领域/桌面协议回归和构建通过；真实原生应用由根任务验收。
- functional_check: 上述针对真实故障形态的回归通过；未修改真实数据库或运行进程。
- rollback_point: 272fb517465d0db31d5c788c7b0f6b18df169ff9；集成时可 revert 本提交，不涉及数据迁移。
- remaining_risks: 原生视觉与导航验证由根任务在集成安装包执行；完整候选并不代表人工验收；外部 Agent 生命周期继续保留其真实状态。
- GitHub/Release/PRD: 由根任务统一完成，本子任务未 push 或发包。

## Git inventory before edits

```text
$ git status --short --branch
## codex/quandeck-candidate-attention-20261117

$ git branch --show-current
codex/quandeck-candidate-attention-20261117

$ git rev-parse HEAD
272fb517465d0db31d5c788c7b0f6b18df169ff9

$ git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)

$ git worktree list --porcelain
Full multi-worktree inventory retained in local audit evidence; unrelated task details omitted from this public copy.
```
