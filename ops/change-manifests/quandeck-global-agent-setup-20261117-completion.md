# Global Agent setup

- task_id: quandeck-global-agent-setup-20261117
- status: COMMITTED
- branch: codex/quandeck-global-agent-setup-20261117
- worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-global-agent-setup-20261117

## Initial inventory

### git status --short --branch

```text
## codex/quandeck-global-agent-setup-20261117
```

### git branch --show-current

```text
codex/quandeck-global-agent-setup-20261117
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


## Implementation and validation

- Goal: persist one application default per Agent identity; new desktop projects select a file folder and reuse independently verified project connections.
- Legacy overrides stay unchanged. Identical old settings can be reused; conflicting variants require choosing an application default. No credentials or runtime authorization policies are copied into profile preferences.
- Directory canonicalization/collision checks, fresh native handshake receipts, failed-connection issue persistence, same-project retry and concurrent-directory guards are enforced by backend code. Creation does not dispatch tasks or open discussions.
- Application DSH model replacement/restore uses durable preference CAS and never replaces existing project bindings. Discussion selection excludes application validation receipts and prefers the current project's binding.
- Project settings expose the fixed workspace and recovery issues. Configuration changes increment affected snapshot versions for incremental readers.

### Changed files

```text
desktop/app/main.mjs
desktop/app/preload.cjs
desktop/app/project-workspace.mjs
desktop/project-workspace.test.mjs
scripts/agent-configuration.test.mjs
scripts/test.mjs
src/components/deck/AgentConnectionSetup.tsx
src/components/deck/panels/AgentsPanel.tsx
src/components/projects/ProjectDialog.tsx
src/components/projects/projects.css
src/components/settings/SettingsPage.tsx
src/components/workspace/DiscussionDialogs.tsx
src/data/desktopCore.ts
src/data/projectStorage.ts
src/data/repository.ts
src/data/types.ts
src/integration/agentConnectionReplacement.ts
src/integration/agentProfiles.ts
src/integration/configuredAgents.ts
src/integration/desktop.ts
tests/global-agent-setup.test.ts
```

### Checks

- `pnpm exec tsc --noEmit`: passed after final source changes.
- `pnpm test`: domain suites and 316 Node subtests passed. Initial attempt lacked desktop dependency links and sandbox localhost permission; reused the baseline dependency directory and ran the local-only fixture suite with localhost access. No real provider request or user DB mutation.
- Additional final `tests/global-agent-setup.test.ts` compile/run: passed, including application receipt exclusion, fixed binding selection, concurrent creation and directory selection.
- `node --test desktop/project-workspace.test.mjs scripts/agent-configuration.test.mjs`: 21/21 passed.
- `pnpm build`: passed after final changes; existing large-chunk warning remains.
- `node --check desktop/app/main.mjs`, `node --check desktop/app/project-workspace.mjs`, `git diff --check`: passed.
- Native visual/app acceptance is delegated to parent integration task; not claimed here.

## Delivery

- implementation_commit: 62c1da3f199e5eacdd38d9fa866dd4a0af8402e9
- GitHub remote/ref/SHA: not executed in this delegated task; parent owns authorized push/release.
- server_before: not applicable; desktop-only source change.
- server_after: not applicable; no deployment.
- health_check: TypeScript, production build and local test suite passed.
- functional_check: deterministic global/profile/native workspace fixtures passed; real app verification pending parent integration.
- rollback_point: baseline 94f0cc7ca433c89a0450544c712655a03d2dcc02; revert implementation commit without removing existing preferences or project files.
- remaining_risks: source-tool login expiry or changed executable/model source still requires repair; old projects keep their pinned settings deliberately; real Mac installer/UI acceptance and Windows installer build are parent-owned.
- Integration notes: small repository changes affect constructor/createProject/updateProject/syncAgentConfiguration and refreshAgentConfiguration(version); performance agent owns commit/reconcile/onPersist. `main.mjs` adds one trusted preparer injection plus an app-owned validation-directory IPC. No version changes.
