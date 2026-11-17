# Windows restore regression fixture
task_id: quandeck-windows-restore-test-20261117
status: TESTED

## git status --short --branch
```text
## codex/quandeck-windows-restore-test-20261117
```

## git branch --show-current
```text
codex/quandeck-windows-restore-test-20261117
```

## git rev-parse HEAD
```text
e65a51b2180021bf8b6f90f5beb4264bf21e014a
```

## git remote -v
```text
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)
```

## git worktree list --porcelain
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
HEAD 08abf596b2715b81f5082177bc48d2040e19bb41
branch refs/heads/codex/quandeck-global-profile-live-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-installer-checks-20261117
HEAD b583e80ac0e601410e08a56f11aae8b6ecb94419
branch refs/heads/codex/quandeck-installer-checks-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-legacy-profile-label-20261117
HEAD aaaa14e3380b73b3653da30054ed334ace970dac
branch refs/heads/codex/quandeck-legacy-profile-label-20261117

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
HEAD e015aff156aa48a575e8fbab17247380d9fa421d
branch refs/heads/codex/quandeck-project-memory-storage-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-renderer-perf-20261117
HEAD 204dbf5cd854d9dfc8514c0947a61a88bd8606dd
branch refs/heads/codex/quandeck-renderer-perf-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-results-business-scope-20261117
HEAD f75a82a632dc08f961c2baf5a3730f973911adca
branch refs/heads/codex/quandeck-results-business-scope-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-runtime-project-reads-20261117
HEAD 2e7ca6bee84fe126af4dff08310bc201615793f3
branch refs/heads/codex/quandeck-runtime-project-reads-20261117

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-shared-config-memory-perf-20261117
HEAD e65a51b2180021bf8b6f90f5beb4264bf21e014a
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

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-windows-restore-test-20261117
HEAD e65a51b2180021bf8b6f90f5beb4264bf21e014a
branch refs/heads/codex/quandeck-windows-restore-test-20261117
```


## Cause and correction

Windows CI failed only the newly added schema-2 backup restore test at desktop/local-store.test.mjs:86. The fixture called prepareRestore and opened the replacement database before closing its first store. That store kept workspace.sqlite open when recoverWorkspaceMaintenance renamed the workspace directory. Windows rejects this rename with EPERM; macOS permits the rename and therefore did not expose the lifecycle mistake. The extra backup SQLite handle was already closed.

The real desktop restore handler (desktop/app/main.mjs:291 at baseline) closes the store, relaunches and exits before recovery opens it again. No evidence of a production restore-path defect was found. This correction only adds explicit tracked fixture close and uses it before simulating restart. It preserves real migration, recovery and immutable-history assertions; no test is skipped or weakened.

Files changed: desktop/local-store.test.mjs and this completion manifest.

## Validation

- `node --test desktop/local-store.test.mjs desktop/storage-maintenance.test.mjs`: PASS 37/37 on local macOS.
- `pnpm test`: PASS all TypeScript domain checks and 329/329 Node tests, using local loopback fixture permission.
- `pnpm exec tsc --noEmit`: PASS.
- `pnpm build`: PASS; existing bundle-size advisory only.
- `git diff --check`: PASS.
- Actual Windows CI rerun is required after parent integration; local results do not claim Windows verification.
- No live database/App/Agent actions were performed.

commit_sha: pending local implementation commit; subsequent manifest commit records exact SHA.
remote/ref/SHA: no push from this subtask; parent owns authorized integration/release.
git_ls_remote: not run because no push claimed.
server_before: not applicable, regression fixture only.
server_after: not deployed or installed.
health_check: typecheck, full regression and build passed.
functional_check: schema-2 restore/migration/history assertions pass after explicit close; Windows CI confirmation remains with parent.
rollback_point: e65a51b2180021bf8b6f90f5beb4264bf21e014a; reverting this test-only commit restores old fixture behavior, no data migration.
remaining_risks: Windows CI not available locally; require successful Windows job before publishing v0.16.0.
