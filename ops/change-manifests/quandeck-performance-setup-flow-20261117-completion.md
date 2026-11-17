# QuanDeck performance, persistent Agent configuration and programmatic flow diagrams

- task_id: quandeck-performance-setup-flow-20261117
- status: PUSHED
- Objective: reproduce actual UI slowness, fix measured causes, reuse application Agent configuration across projects, add validated programmatic flow diagrams.

## Initial Git inventory

### git status --short --branch

```text
## codex/quandeck-performance-setup-flow-20261117
```

### git branch --show-current

```text
codex/quandeck-performance-setup-flow-20261117
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

## Delivery and validation

- changes: startup recovery skips already-applied event prefixes; no-op persistence removed; incremental project/tray updates preserve final refresh; background projection batches yield and drain trailing updates; persistent application Agent profiles, per-project directory setup and explicit guarded connection repair; controlled programmatic flow diagrams.
- implementation PRD: `docs/performance-setup-flow-v0.15.md`; Figma PRD section 28 updated and read back.
- tests: TypeScript and production build passed; complete domain regression and 320/320 Node tests passed; 46/46 release validation tests passed. Initial sandbox run failed only loopback listeners (EPERM), rerun with local listen permitted passed. Added projection helper required updating the isolated quit test dependency; final complete run passed.
- commit/source: ef66df98c21eebb5d974fbf97bb74756a3b71049
- remote/ref: origin / refs/heads/codex/quandeck-performance-setup-flow-20261117
- remote_sha: ef66df98c21eebb5d974fbf97bb74756a3b71049 (git ls-remote verified)
- main merge / installers: fast-forwarded main to ef66df98c21eebb5d974fbf97bb74756a3b71049; main, task branch and v0.15.0 tag verified with git ls-remote. Build 44069601234 and publish 44070373323 succeeded; public prerelease includes Mac arm64 DMG, Windows x64 EXE, SHA256SUMS.txt and verification.json. Asset sizes/digests match verified clean source and both native installation checks.
- server_before: not applicable, local desktop application; original installed version 0.14.0.
- server_after: not applicable, no server; installed application 0.15.0. Current packaged source a1c675c8c2af8bd0222b8ede860ef858fd012de9; ef66df9 changes only the quit test harness, no packaged code.
- health_check: codesign --verify --deep --strict passed; two real-data cold starts opened the populated project overview on the first observation and subsequent project navigation succeeded. Previously startup had two AX timeouts and ~90 seconds of main-thread blocking. CUA launch/observation took ~9.7 seconds after the fix, which is an upper observation window, not a precise paint benchmark.
- functional_check: application default saved through native settings; new project created with name/directory only, Codex and Hermes bound, zero tasks and sessions; configuration retained after restart. Real 5-node/4-edge task graph rendered; expand, Escape, text alternative and node-to-task navigation passed. Explicit project repair succeeded in native UI and retained other project bindings.
- data preservation: old 7 projects and 6,624 immutable facts retained; zero missing or changed hashes; every old project connection remains identical, SQLite quick_check = ok. One new configuration acceptance project contains zero tasks/sessions. Actual database never edited by diagnostic scripts.
- rollback_point: source b25daea3322eae94629a1e7b30ff27252fa82fba (v0.14.0); application `/Applications/QuanDeck-before-0150-performance.app`; database and attachments `/private/tmp/quandeck-performance-setup-flow-20261117/rollback-before-015/`. Close app before restoring; preserve current workspace before rolling back so new records are not discarded.
- performance evidence: `docs/validation/backend-persistence-performance-20261117.json` and `docs/validation/startup-replay-performance-20261117.json`. Same-copy recovery 79,383.7 ms → 71.0 ms is a recovery-chain benchmark, not total app startup. Full project transfer preparation median 66.972 ms → 0.004 ms unchanged / 6.274 ms one changed project. No general claim about every workload.
- local evidence: `/private/tmp/quandeck-performance-setup-flow-20261117/` (test/build logs, baseline and after samples, data hash comparison); private raw project copies remain local and are not uploaded.
- flow layout: 320/768/1024/1440 widths, branch/merge/return, Chinese labels, zoom/keyboard/text equivalent checked. At most 40 nodes and 80 edges; large graphs are browsed locally. Existing prose is not guessed into registered executable dependencies.
- risks / unfinished: native sources retain their own login lifetime and permission prompts. Installers are not Apple-notarized / Windows-code-signed. No server deployment.

## Release evidence

- Release: https://github.com/Johnie198946/QuanDeck/releases/tag/v0.15.0
- Build: https://github.com/Johnie198946/QuanDeck/actions/runs/44069601234
- Publish: https://github.com/Johnie198946/QuanDeck/actions/runs/44070373323
- Mac arm64: 128,578,495 bytes; SHA-256 90e14d56a17914fa87c9257d02aa707e11c4b03fe3796c51c6eafffaed408416.
- Windows x64: 129,041,644 bytes; SHA-256 24bc9537b68b6e13a9e0a63171c8336e861f2f40da9c2167fd3939427cf0ba84.
- Release is public and prerelease; exact clean source ef66df98c21eebb5d974fbf97bb74756a3b71049.
- Figma native Spec 0:5 updated through figma-use + figma-spec and read back: V0.15 header, section 28, 320 tests, explicit repair and release links verified.
- This manifest is a documentation-only follow-up to the package source. Its containing Git commit identifies final documentation state; it does not change installer provenance.
