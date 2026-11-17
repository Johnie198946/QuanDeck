# Startup performance

task_id: quandeck-startup-performance-20261117
status: TESTED

### git status --short --branch
```text
## codex/quandeck-startup-performance-20261117
```

### git branch --show-current
```text
codex/quandeck-startup-performance-20261117
```

### git rev-parse HEAD
```text
71c4cc18468a18f3711daa5f8c3206cb8d1ec965
```

### git remote -v
```text
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)
```

### git worktree list --porcelain
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
HEAD 71c4cc18468a18f3711daa5f8c3206cb8d1ec965
branch refs/heads/codex/quandeck-performance-setup-flow-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-results-business-scope-20261117
HEAD f75a82a632dc08f961c2baf5a3730f973911adca
branch refs/heads/codex/quandeck-results-business-scope-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-single-delivery-review-20261117
HEAD 52b431015e8370a4f1829a0b2a806739e7a62344
branch refs/heads/codex/quandeck-single-delivery-review-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-spec-baseline-20261117
HEAD fcdf0e333930721bf845870f2ef4eb71eda2153a
branch refs/heads/codex/quandeck-spec-baseline-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-startup-performance-20261117
HEAD 71c4cc18468a18f3711daa5f8c3206cb8d1ec965
branch refs/heads/codex/quandeck-startup-performance-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-v014-release-gate-20261117
HEAD 522a7c85adf7e0cfe817559ce1da0fa7329c3950
branch refs/heads/codex/quandeck-v014-release-gate-20261117

```

## Changes and evidence

- `src/data/runtimeDataSource.ts`: skip events at or below the persisted source cursor before session lookup; retain identity, cursor and commit fences in `receive` for new events. Persist stop acknowledgements only when changed. After replay, reconcile final paused status against the current session.
- `tests/runtime-data.test.ts`: startup history of 300 events, terminal session no-op, new-event progress recovery, final stop-proof precedence and repeated sync idempotency.
- `docs/validation/startup-replay-performance-20261117.json`: content-free counts and timings. No project data, runtime records, credentials or raw database included.
- Same private snapshot benchmark: recovery 79,383.7 ms → 71.0 ms; structuredClone 16,560 → 13; listProjects 2,312 → 1; local writes 97 → 1. This isolates recovery, not overall App startup.

## Checks and delivery

- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: all TypeScript domain suites and 317/317 Node tests passed.
- `pnpm build`: passed in 790 ms; existing large-bundle warning remains.
- Live database: SELECT only using SQLite `mode=ro`, `PRAGMA query_only=ON`.
- Benchmarks: in-memory copy only, zero network/model/control calls; real App untouched.

commit SHA: pending local commit; exact SHA reported to parent for cherry-pick.
GitHub remote/ref/SHA: not executed; parent owns integration/release.
server_before: not applicable, no deployment.
server_after: not applicable, no deployment.
health_check: compiler, full test suite and production build passed.
functional_check: persisted cursor skips historical events; newer progress and stop/pause reconciliation still recover.
rollback_point: 71c4cc1; revert code patch, no schema/data migration.
remaining_risks: projection drain and first paint need parent native verification; one rejected-admission repair write remains intentionally; this change does not disable synchronization or background automation.
