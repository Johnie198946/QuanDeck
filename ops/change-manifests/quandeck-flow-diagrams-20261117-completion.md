# Programmatic direction flow diagrams

task_id: quandeck-flow-diagrams-20261117
status: COMMITTED
branch: codex/quandeck-flow-diagrams-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-flow-diagrams-20261117
commit_sha: The commit containing this manifest; resolve with `git log -1 --format=%H -- ops/change-manifests/quandeck-flow-diagrams-20261117-completion.md`.

## Scope and implementation

Direction pages now render actual ledger task, dependency and child-to-parent merge facts without requiring another Agent turn. Clicking a task node opens that task. Current status is written as text; it is not inferred from colors or invented percentages. Historical adopted document snapshots do not embed the live task graph.

An optional `visualBlocks` flow v1 contract lets an Agent supply only node identities, plain-text labels/details, node kinds and directed labeled edges. The existing main-process runtime conclusion parser calls the strict shared parser before recording the conclusion and its ledger visual receipt. It rejects unknown fields (including model layout, links, executable attributes and approvals), invalid references, duplicate identities, oversized graphs and invalid labels. Invalid diagrams produce an explicit error while the original reply remains preserved. Parsing a visual does not write execution dependencies or grant consent.

The program computes bounded deterministic layout, including branches, return/self-loop edges and long forward connections, and React renders declarative SVG. No diagram libraries, model HTML/SVG, external rendering service or new dependency is used. Wide diagrams scroll; the entry node starts fully visible on small windows. An accessible equivalent text view, modal expansion, Escape close, focus restoration and keyboard task-node activation are included. A small projection key memoizes task layout across observation-only snapshot updates; more than 40 tasks keeps only a count instead of serializing the whole graph.

Changed files:

- `src/data/flowDiagram.ts`: pure structured contract, validation, deterministic layout.
- `src/data/directionFlow.ts`: read-only ledger projection and task-target map.
- `src/data/discussionVisual.ts`, `src/data/discussionPresentation.ts`: intake/protocol integration.
- `src/components/discussion/FlowDiagram.tsx`, `flow-diagram.css`: rendering, text view and expansion.
- `src/components/discussion/DiscussionCanvas.tsx`: valid/error method diagram presentation.
- `src/components/workspace/PlanFlow.tsx`, `PlanDocView.tsx`: direction-page navigation and actual-task flow.
- `tests/flow-diagram.test.ts`, `tests/discussion-visual.test.ts`, `scripts/test.mjs`: ingestion, ledger persistence and graph regressions.
- `tests/flow-diagram.preview.html`, `tests/flow-diagram.fixture.tsx`, `tests/flow-diagram.fixture.css`, `tests/flow-diagram.browser.mjs`: isolated responsive/keyboard/security browser acceptance harness.

## Validation evidence

- `pnpm exec tsc --noEmit`: exit 0.
- `pnpm test`: exit 0; all domain tests and 310 Node tests pass. Log: `/private/tmp/quandeck-flow-suite-final.log`.
- `pnpm build`: exit 0. Log: `/private/tmp/quandeck-flow-build-final.log`. Existing large chunk advisory remains.
- `git diff --check`: exit 0.
- `QUANDECK_PLAYWRIGHT_MODULE=/private/tmp/quandeck-desktop-layout-qa/node_modules/playwright/index.mjs node tests/flow-diagram.browser.mjs`: exit 0. Local isolated preview only; no real project, DB or Agent call.
- Browser evidence: `/private/tmp/quandeck-flow-diagram-ui/checks.json` and `flow-320.png`, `flow-768.png`, `flow-1024.png`, `flow-1440.png`, `flow-expanded.png`. Visually inspected narrow/expanded results. No document horizontal overflow, script execution or external diagram requests; entry node visible, keyboard selection and dialog focus restored.
- First local attempts encountered unavailable existing desktop dependencies and sandbox loopback restrictions; linked the already-installed dependencies and reran the complete suite with the localhost test permission. No production change was made to suppress failures.

## Delivery and remaining boundaries

remote/ref/SHA: not pushed by this subtask; parent integrates and publishes.
git_ls_remote: not executed; no PUSHED claim.
server_before: not applicable, local feature development only.
server_after: not applicable, no deployment performed.
health_check: type check, build and isolated browser pass; installed application check delegated to parent.
functional_check: graph contract, persistence, ledger projection, bounded cycles, responsive layouts and keyboard checks passed; parent owns native installation/end-to-end acceptance.
rollback_point: 94f0cc7ca433c89a0450544c712655a03d2dcc02; revert this feature commit without touching user data.

Limits: each diagram has at most 40 nodes / 80 edges; larger scopes direct the user into an individual task. Existing prose is not silently guessed into a diagram. Draft method diagrams remain discussion evidence, not the source of execution dependencies. Parent is responsible for the combined PRD update, native verification, versioning and release. No version files, Agent setup, runtime credentials, actual projects or actual DB were changed here.

## Initial inventory

### git status --short --branch
```
## codex/quandeck-flow-diagrams-20261117
```

### git branch --show-current
```
codex/quandeck-flow-diagrams-20261117
```

### git rev-parse HEAD
```
94f0cc7ca433c89a0450544c712655a03d2dcc02
```

### git remote -v
```
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)
```

### git worktree list --porcelain
```
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
