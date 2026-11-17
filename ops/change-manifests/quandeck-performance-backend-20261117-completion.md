# Backend performance task

task_id: quandeck-performance-backend-20261117
status: TESTED

### git status --short --branch
```text
## codex/quandeck-performance-backend-20261117
```

### git branch --show-current
```text
codex/quandeck-performance-backend-20261117
```

### git rev-parse HEAD
```text
94f0cc7ca433c89a0450544c712655a03d2dcc02
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
HEAD 94f0cc7ca433c89a0450544c712655a03d2dcc02
branch refs/heads/codex/quandeck-flow-diagrams-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-frozen-attachment-preview-20261117
HEAD a42065d2d39ac3c5eadc6ffc3ceb307d50081b82
branch refs/heads/codex/quandeck-frozen-attachment-preview-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-global-agent-setup-20261117
HEAD 94f0cc7ca433c89a0450544c712655a03d2dcc02
branch refs/heads/codex/quandeck-global-agent-setup-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-installer-checks-20261117
HEAD b583e80ac0e601410e08a56f11aae8b6ecb94419
branch refs/heads/codex/quandeck-installer-checks-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-manual-acceptance-20261117
HEAD 8c78d2471b4f61dfae05c99913d5d015aaa9238e
branch refs/heads/codex/quandeck-manual-acceptance-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-performance-backend-20261117
HEAD 94f0cc7ca433c89a0450544c712655a03d2dcc02
branch refs/heads/codex/quandeck-performance-backend-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-performance-setup-flow-20261117
HEAD 94f0cc7ca433c89a0450544c712655a03d2dcc02
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

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-v014-release-gate-20261117
HEAD 522a7c85adf7e0cfe817559ce1da0fa7329c3950
branch refs/heads/codex/quandeck-v014-release-gate-20261117

```

## Change scope

- `src/data/repository.ts`: preserve unrelated project references through commits and source events, reconcile only projects with cross-project reads, refresh only changed cached engines. Cross-project fixed-point invalidation remains transactional.
- `desktop/app/local-store.mjs`: after a successful transaction, memoize serialized immutable facts and project content; fence the cache with document revision and SQLite `data_version`; skip exact same-value writes and unchanged-project indexing/projection hashes. Immutable SQL history and global execution-source uniqueness remain enforced.
- `desktop/local-store.test.mjs`: regression coverage for same-value persistence, changed-only projection, tampering/removal rejection, failed-transaction cache isolation, external-writer invalidation, and global source-binding uniqueness.
- `docs/validation/backend-persistence-performance-20261117.json`: aggregate benchmark evidence only. No business content, identifiers, attachments, source data or DB was committed.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: passed all TypeScript domain suites and 311/311 Node tests; local fixture network tests ran with sandbox permission. No configured Agent calls.
- `pnpm build`: passed, 838 ms; existing >500 kB bundle warning remains.
- Real database opened with `mode=ro` and `query_only=ON` only. Benchmarks operated on fresh temporary SQLite databases or in-memory localStorage.
- Timing samples are recorded in the JSON evidence; they are isolated persistence measurements, not a claim of end-to-end App latency.

## Delivery and boundaries

commit SHA: pending local commit; exact commit is supplied in task completion to the parent.
GitHub remote/ref/SHA: not executed by this subtask; parent owns integration and release.
server_before: not applicable, desktop source changes only.
server_after: not applicable, no application or server deployed.
health_check: TypeScript, full regression suite and production build passed.
functional_check: immutable history, rollback, cross-project expiry/revocation, source ownership and changed-only persistence regression passed; native UI verification belongs to parent.
rollback_point: baseline `94f0cc7ca433c89a0450544c712655a03d2dcc02`; revert this patch, no schema migration or real data changes.
remaining_risks: full-library serialization remains; memoization increases retained memory for the current persisted snapshot; cross-project read reconciliation intentionally stays conservative; native UI and packaged binary verification is pending parent integration.
