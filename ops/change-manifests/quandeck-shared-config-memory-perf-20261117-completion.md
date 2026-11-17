# QuanDeck global config, project memory and performance

task_id: quandeck-shared-config-memory-perf-20261117
status: PUSHED

## Initial inventory

```text
$ git status --short --branch
## codex/quandeck-shared-config-memory-perf-20261117


$ git branch --show-current
codex/quandeck-shared-config-memory-perf-20261117


$ git rev-parse HEAD
40dc863e583e2c405d0a6f16aaa0f6323257d0a1


$ git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)


$ git worktree list --porcelain
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

## Scope
Application-wide Agent configuration; project-scoped memory persistence; reproduce and fix native lag.

## Validation

- All domain suites and 329 Node tests passed; TypeScript and production build passed. Python release validators: 46 passed. git diff --check passed.
- Reports: docs/validation/project-storage-performance-20261117.json, project-memory-partitions-20261117.json, shared-config-memory-native-v016.json.
- Native 0.15.0 was confirmed running before update; 0.16.0 (c3b10bb implementation; final compatible-label follow-up fully regression-tested) installed and operated. Settings version confirmed; project settings repair removed; avatar and project Agent manager share editor; Codex/Hermes app profiles present. Existing completed project 2/2 accepted outputs and published Spec v1 preserved.
- Native database schema3; quick_check=ok; all eight projects and 6,812 baseline immutable facts preserved with exact hashes. Migration itself preserved 6,904→6,904; 92 extra events/receipts preceded migration. No user project deleted, no manual database update, no new model business dispatch in this native acceptance.
- Same-copy commit median 112.314→15.052ms; single-project read 48.956→4.393ms; runtime lookup median35.57→0.974ms. Native main physical footprint observed1.1GB→565.6MB (different process lifetimes, not a controlled memory benchmark).

## Files and implementation

See docs/shared-config-project-memory-v0.16.md and commit diff from40dc863. Changes cover application-profile resolution, project-scoped SQLite persistence, runtime and summary scoped reads, renderer delta subscriptions, lightweight IPC, managed transcript discovery, settings UI, tests and validation documentation.

server_before: not applicable (desktop); local app0.15.0
server_after: not applicable (desktop); local app0.16.0
health_check: TypeScript/build/tests passed; native codesign verification and SQLite quick_check passed
functional_check: native avatar/project shared editor, no project repair, project/task/results navigation and prior accepted maps passed; restart preserves shared Codex and Hermes; installed 670 application resources match e65a51b build with zero mismatch. Release candidate differs only in test and manifest, no application source changes.
rollback_point: /Applications/QuanDeck-before-0160-20261117.app and /private/tmp/quandeck-shared-config-memory-perf-20261117/rollback-before-016/workspace
commit_sha: release candidate 5c1c1a9e15d65ceedb138b48f5d346f537d698e7; local app build e65a51b2180021bf8b6f90f5beb4264bf21e014a (identical app source)
remote_sha: 5c1c1a9e15d65ceedb138b48f5d346f537d698e7, verified by git ls-remote for origin refs/heads/main and refs/heads/codex/quandeck-shared-config-memory-perf-20261117
release: v0.16.0 public prerelease; dual-platform build44082772148 and publication gate44083666831 success
remaining_risks: cold startup still hydrates project histories; individual large histories remain a scaling limit. Agent source login/permissions are not made permanent. Current running sessions retain old transport; next new execution uses current app profile. Rollback requires old app and matching schema2 workspace.

## Authorization

User has explicitly authorized GitHub push and complete QuanDeck release workflow throughout this task, native app operation/update, and preservation of real project data. Release platforms per repository AGENTS.md: macOS arm64 and Windows x64 only.

## Windows gate correction

First main CI run44081177513 passed macOS build/native checks but Windows failed the new schema2 restore test because the fixture kept the previous SQLite handle open while simulating a restart. Product main.mjs already closes storage before relaunch. Commit5c1c1a9 corrects only the fixture lifecycle; the same assertions and release gate remain. Local37 storage checks and full329 tests passed. Retest main run44082772148 passed on both mac arm64 and win x64, including native install/launch/uninstall.

## Remote evidence

```text
5c1c1a9e15d65ceedb138b48f5d346f537d698e7 refs/heads/main
5c1c1a9e15d65ceedb138b48f5d346f537d698e7 refs/heads/codex/quandeck-shared-config-memory-perf-20261117
```

Figma PRD node0:5 section29 now contains the current contract and explicitly supersedes v0.15 project-repair behavior. Release links and verified publication are recorded below.

## Final native state

Readonly post-restart counts: eight projects, 38 tasks and 51 sessions (unchanged from baseline). Schema3 and quick_check=ok. Native app0.16.0 restarted and shared Codex/Hermes settings persisted. No project-by-project repair or new paid diagnostic model request was required.

Installed-source evidence: docs/validation/shared-config-memory-installed-v016.json; 670 resources compared with zero mismatches. Local build e65a51b and release5c1c1a9 have identical application sources; the latter only fixes the Windows test lifecycle and adds its manifest.

## Verified GitHub delivery

- Tagv0.16.0 and installer source:5c1c1a9e15d65ceedb138b48f5d346f537d698e7, verified via git ls-remote.
- Build: https://github.com/Johnie198946/QuanDeck/actions/runs/44082772148 (both platforms success).
- Publish: https://github.com/Johnie198946/QuanDeck/actions/runs/44083666831 (success).
- Release: https://github.com/Johnie198946/QuanDeck/releases/tag/v0.16.0 (isDraft=false,isPrerelease=true).
- Mac arm64 DMG128561920bytes SHA256c1d80477ad0f6d11f25d678b1270bc452cff390fad6a65c20b8c5616524ee81f.
- Windows x64 EXE129053831bytes SHA25667ccca3e3c702f9ec604bdb0e40cb1e56f30839ef5c1ed3b825af3d6b4eb08dc.
- SHA256SUMS.txt and verification.json downloaded and checked: sourceCommit/tag match, installer sizes/hashes match, sourceDirty=false, both native launch checks pass. The publication gate also validates the uploaded GitHub asset hashes.
- No server deployment; local app0.16.0 verified. This document-only archival commit does not change the release source or installed application.
- Remaining distribution limitation: Mac not Apple-notarized, Windows not code-signed.
