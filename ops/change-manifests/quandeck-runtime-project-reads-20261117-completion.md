# Runtime project reads

task_id: quandeck-runtime-project-reads-20261117
status: COMMITTED
branch: codex/quandeck-runtime-project-reads-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-runtime-project-reads-20261117
head/local_commit: 82c78c22832aa7dd86bf169bab08b4ceb714335d

## Goal and changes

Route events and session controls by runtime ownership without copying the history of unrelated projects. Keep every existing receipt/claim/CAS/authorization fence, and keep all enabled automation projects eligible on every wake.

- `src/data/repository.ts`: trusted internal `findRuntimeSession` inspects session/run identities, rejects ambiguous ownership, then copies exactly one project. `readGoalAutomationProjects` filters enabled projects before copying.
- `src/data/runtimeDataSource.ts`: session/run lookups use the trusted lookup; automation uses only enabled projects and re-reads the current project directly between effects. No delta skip: unchanged enabled scopes still wake when another project releases shared resources.
- `tests/runtime-data.test.ts`: own-project copy, read result isolation, zero full-library reads during event receipt, selected-project stability, enabled/disabled filtering, unchanged enabled scopes revisited, duplicate session/run rejection.
- `tests/task-input-races.test.ts`: fault injection targets the new lookup entrypoint, preserving the assertion that lookup exceptions release the control lock.

## Initial inventory

Source worktree was clean on codex/quandeck-renderer-perf-20261117, HEAD 204dbf5cd854d9dfc8514c0947a61a88bd8606dd. This task created a new clean worktree/branch from that HEAD. Remote origin: https://github.com/Johnie198946/QuanDeck.git (fetch and push).

Dependency afbdbd6 (project-scoped persistence and getProjectSnapshot) cherry-picked as f398512 before this task's edits. Parent integration must apply that dependency first; only 82c78c2 and this documentation commit are new runtime work.

Worktree inventory captured at /private/tmp/quandeck-renderer-perf-20261117/runtime-worktrees-before.txt. This task's newly created worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-runtime-project-reads-20261117 on codex/quandeck-runtime-project-reads-20261117. No other worktree or user change was modified.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed; existing bundle size warning remains.
- Focused runtime-data, leaf-auto-execution, project-assembly and runtime-binding suites: passed.
- Full `pnpm test`: passed all domain suites and 325 Node tests. An initial run caught the old fault injection relying on listProjects; the failure assertion was preserved at the new lookup boundary, then the full suite passed.
- `git diff --check`: passed.
- Read-only seven-project fixture benchmark, 50 iterations: previous full-library session lookup median 35.570 ms / p95 48.405 ms; new scoped lookup median 0.974 ms / p95 2.045 ms. These are function timings, not UI frame/launch latency. Fixture contains four enabled automation projects, all still revisited per wake.
- Evidence: /private/tmp/quandeck-runtime-project-reads-20261117/benchmark.json and full-tests-final.log. Real user database was not modified.

remote_sha: 未执行；由父任务整合推送
server_before: 不适用；未部署
server_after: 不适用；未部署
health_check: TypeScript、构建及完整测试通过
functional_check: 项目归属、事件记录、自动推进与会话锁回归通过；实机集成由父任务验收
rollback_point: f398512（此任务代码修改前）
remaining_risks: 启动恢复仍保留一次全项目扫描；跨项目来源冲突的受理检查仍全局核对，不以性能优化削弱归属保护；整合后需重测真实端
rollback: revert 本任务代码提交，不涉及删除或改写历史事实
