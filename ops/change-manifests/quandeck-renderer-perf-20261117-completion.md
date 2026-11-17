# QuanDeck renderer performance

task_id: quandeck-renderer-perf-20261117
status: COMMITTED
branch: codex/quandeck-renderer-perf-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-renderer-perf-20261117
base/head_before: 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
commit: e5266ee3baf05bcb2384988a57f55b9dcaeb2946

## Scope and findings

- Native snapshot push previously sent an entire active project on every background project update. For the local read-only seven-project fixture, the active snapshot serialized to 1,190,851 bytes; the new invalidation is 66 bytes. This compares push payloads only; changed project snapshots still travel on demand.
- Every native window copied the whole browser project archive during bootstrap; importing App also eagerly constructed a browser-local repository before native bootstrap. Native mode now dynamically avoids importing that repository, and removes the legacy browser project key only after successful backend migration. Parent integration must return `quandeck.projects.v1: null` after durable migration and broadcast `snapshot-invalidated` with `activeProjectId`.
- The native consumer coalesces invalidations into the existing delta reader and uses the same returned catalog for its active view. Native windows no longer subscribe to full snapshot pushes. Older HTTP/browser sources retain compatible full-push behavior.
- Markdown parsing is memoized by text/run ID so layout, unrelated progress, and selection changes do not reparse unchanged prose or reset attachment dialogs.
- Overview derives only changed immutable project models with a view-scoped WeakMap selector; mutable backend drafts do not use the cache.
- Actual read-only fixture overview model: full recalculation median 1.020 ms / p95 2.995 ms; unchanged selector median 0.000959 ms / p95 0.001417 ms. Task presentation median <=0.34 ms per project. These model timings do not substantiate multi-second native UI lag by themselves; full IPC/store serialization is the higher-priority root cause being integrated by parent.

## Files

desktop/app/preload.cjs; src/App.tsx; src/main.tsx; src/integration/desktop.ts; src/data/desktopRepository.ts; src/data/repository.ts (optional subscription interface only); src/data/projectUpdates.ts; src/state/WorkdeckContext.tsx; src/data/overviewTree.ts; src/components/results/Dashboard.tsx; src/components/runtime/RichMessage.tsx; tests/project-updates.test.ts; tests/overview-tree.test.ts.

## Initial inventory

Initial source worktree was clean on codex/quandeck-shared-config-memory-perf-20261117, HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1. New worktree created from that exact HEAD; initial new branch clean, no inherited modifications.
Remote: origin https://github.com/Johnie198946/QuanDeck.git (fetch/push).

```text
worktree /Users/dengzhaoyu/Documents/AI Lab/.repositories/quandeck-delivery-contract-20261117.git
bare

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-assembly-orchestration-20261117
HEAD 8985664b1af04328716c5583c2d84b55a4e4c974
branch refs/heads/codex/quandeck-assembly-orchestration-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-contribution-revision-20261117
HEAD 5515cf75470fd690215417a4389f59e6adcdea69
branch refs/heads/codex/quandeck-contribution-revision-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-contract-20261117
HEAD 94f0cc7ca433c89a0450544c712655a03d2dcc02
branch refs/heads/codex/quandeck-delivery-contract-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-domain-20261117
HEAD 6e22a56bca8f1aaba9a5a5b723f1c78c9b929107
branch refs/heads/codex/quandeck-delivery-domain-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-domain-review-fixes-20261117
HEAD 012d5f69a76bc2c2dcf7117e2269d83e8aec0d62
branch refs/heads/codex/quandeck-delivery-domain-review-fixes-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-maps-ui-20261117
HEAD af3efb15b3d952592ffc879f7ff6b6b7e24a15c2
branch refs/heads/codex/quandeck-delivery-maps-ui-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-replay-fix-20261117
HEAD 6fef69e6ecdf520e7244c4460494bce7b5be644e
branch refs/heads/codex/quandeck-delivery-replay-fix-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-direction-deliveries-20261117
HEAD 9678dc582cf6deb3ec3383b9f221211dc46c16f9
branch refs/heads/codex/quandeck-direction-deliveries-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-diagrams-20261117
HEAD 1a497584c4c25752ff0b27e4676929e2d9657de1
branch refs/heads/codex/quandeck-flow-diagrams-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-frozen-attachment-preview-20261117
HEAD a42065d2d39ac3c5eadc6ffc3ceb307d50081b82
branch refs/heads/codex/quandeck-frozen-attachment-preview-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-global-agent-setup-20261117
HEAD d7f62564229a92a6274bd6a70f79b44c344cca2e
branch refs/heads/codex/quandeck-global-agent-setup-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-global-profile-live-20261117
HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
branch refs/heads/codex/quandeck-global-profile-live-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-installer-checks-20261117
HEAD b583e80ac0e601410e08a56f11aae8b6ecb94419
branch refs/heads/codex/quandeck-installer-checks-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-manual-acceptance-20261117
HEAD 8c78d2471b4f61dfae05c99913d5d015aaa9238e
branch refs/heads/codex/quandeck-manual-acceptance-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-performance-backend-20261117
HEAD dfb2e538b227eb9051d3769f630b70ffc3f7eb62
branch refs/heads/codex/quandeck-performance-backend-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-performance-setup-flow-20261117
HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
branch refs/heads/codex/quandeck-performance-setup-flow-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-project-agent-repair-20261117
HEAD c3ab670397c65abb9ac6dbbe5f1870299005302f
branch refs/heads/codex/quandeck-project-agent-repair-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-project-memory-storage-20261117
HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
branch refs/heads/codex/quandeck-project-memory-storage-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-renderer-perf-20261117
HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
branch refs/heads/codex/quandeck-renderer-perf-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-results-business-scope-20261117
HEAD f75a82a632dc08f961c2baf5a3730f973911adca
branch refs/heads/codex/quandeck-results-business-scope-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-shared-config-memory-perf-20261117
HEAD 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
branch refs/heads/codex/quandeck-shared-config-memory-perf-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-single-delivery-review-20261117
HEAD 52b431015e8370a4f1829a0b2a806739e7a62344
branch refs/heads/codex/quandeck-single-delivery-review-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-spec-baseline-20261117
HEAD fcdf0e333930721bf845870f2ef4eb71eda2153a
branch refs/heads/codex/quandeck-spec-baseline-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-startup-performance-20261117
HEAD 79fc07ef3cbfedcd40c77993a2c9aff942365bc0
branch refs/heads/codex/quandeck-startup-performance-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-v014-release-gate-20261117
HEAD 522a7c85adf7e0cfe817559ce1da0fa7329c3950
branch refs/heads/codex/quandeck-v014-release-gate-20261117

```

## Validation

- `pnpm exec tsc --noEmit`: pass.
- `pnpm build`: pass; browser repository emitted as separate dynamic chunk. Existing main bundle size warning remains.
- `pnpm test`: pass, full domain suite and 320 Node tests. Initial sandbox attempt could not bind loopback and lacked local desktop dependency symlinks; linked existing dependencies and reran with local-loopback permission, no code change needed.
- Focused project-updates/dashboard tests rerun after adding empty-native-workspace coverage: pass.
- Tests cover 40-event coalescing, trailing reconciliation, switched project versus late initial load, unchanged active identity for other-project events, switch with zero snapshot delta, disposal, empty workspace, legacy full pushes, per-project overview invalidation/deletion.
- `git diff --check`: pass.
- Read-only benchmark/evidence: /private/tmp/quandeck-renderer-perf-20261117 (contains no committed user data).
- Native UI profiling and installer acceptance delegated to parent integration; no UI automation performed in this subtask.

remote_sha: 未执行；父任务负责整合推送
server_before: 不适用，本子任务未部署
server_after: 不适用，本子任务未部署
health_check: 本地 TypeScript/build/full regression pass
functional_check: 本地上述增量同步回归通过；最终实机验收由父任务执行
rollback_point: 40dc863e583e2c405d0a6f16aaa0f6323257d0a1
remaining_risks: 必须与主进程新 invalidation/bootstrap 合约一同集成；仍需整合后真实端复测，不能用模型基准声称整页响应时间
rollback: revert 此任务提交；不涉及用户业务数据写入或删除
