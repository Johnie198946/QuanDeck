# QuanDeck delivery contracts and output assembly

- task_id: `quandeck-delivery-contract-20261117`
- status: `COMMITTED` (release validation still in progress)
- branch: `codex/quandeck-delivery-contract-20261117`
- worktree: `/Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-contract-20261117`
- rollback_point: source/release `v0.13.0`, `4f858d4f60ad898287390f08738630b8e8372bcc`; application and SQLite/attachments copied before upgrade.

## Authorized scope and design

User authorized implementation, native end-to-end operation, PRD update and complete GitHub release. See `docs/delivery-contract-v0.14.md` for the complete workflow and authority model. Separate project-final and task-contribution contracts/maps; backend file verification and per-item receipts; backend-created assembly responsibilities; versioned changes; manual acceptance and immutable publication; automatic Spec draft maintenance with explicit publication. AI supplies content; code writes facts and checks transitions.

## Initial inventory

### git status --short --branch

```text
## codex/quandeck-delivery-contract-20261117
```

### git branch --show-current

```text
codex/quandeck-delivery-contract-20261117
```

### git rev-parse HEAD

```text
4f858d4f60ad898287390f08738630b8e8372bcc
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

worktree /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-delivery-contract-20261117
HEAD 4f858d4f60ad898287390f08738630b8e8372bcc
branch refs/heads/codex/quandeck-delivery-contract-20261117
```

The previous worktree contained an unrelated untracked `desktop/app/agent-bridge 2.mjs`; it was not staged, restored, removed or committed. This task began from a clean private worktree/bare repository.

## Changed areas

`src/data`: delivery contract, changes, review, publication, assembly, Spec maintenance/lineage, handoff and repository commands.
`src/components`: project/task maps, contract editing, per-item review, publication/history, direction contract presentation.
`desktop/app`: trusted file verifier, immutable attachments, installer smoke.
`tests`: domain and race tests, UI scope and responsive checks, installer fixture regression.
`docs/delivery-contract-v0.14.md`, version metadata and this manifest.

### Integrated changed files

```text
.github/scripts/publish-installers.py
.github/scripts/test_publish_installers.py
desktop/README.md
desktop/app/attachment-preview.mjs
desktop/app/delivery-file-verifier.mjs
desktop/app/local-store.mjs
desktop/app/main.mjs
desktop/app/package-lock.json
desktop/app/package.json
desktop/app/preload.cjs
desktop/app/smoke-goal-delivery.mjs
desktop/app/task-attachments.mjs
desktop/attachment-preview.test.mjs
desktop/check-windows-install.ps1
desktop/delivery-file-verifier.test.mjs
desktop/package-lock.json
desktop/package.json
desktop/task-attachments.test.mjs
docs/delivery-contract-v0.14.md
ops/change-manifests/quandeck-installer-checks-20261117-completion.md
ops/change-manifests/quandeck-v014-release-gate-20261117-completion.md
package.json
scripts/test.mjs
src/components/outputs/OutputDeliveryFields.tsx
src/components/outputs/OutputDialog.tsx
src/components/outputs/outputs.css
src/components/outputs/reviewChecklist.ts
src/components/results/DeliveryChangeDialog.tsx
src/components/results/DeliveryMap.tsx
src/components/results/DeliveryPublication.tsx
src/components/results/DeliveryPublicationReader.tsx
src/components/results/DeliveryReview.tsx
src/components/results/OutputPreview.tsx
src/components/results/ResultDocument.tsx
src/components/results/ResultsBoard.tsx
src/components/results/ResultsGallery.tsx
src/components/results/SpecLineagePanel.tsx
src/components/results/delivery-map.css
src/components/results/deliveryNavigation.ts
src/components/workspace/PlanDeliverables.tsx
src/data/collaboration.ts
src/data/commands.ts
src/data/deliveryChanges.ts
src/data/deliveryContract.ts
src/data/deliveryPresentation.ts
src/data/deliveryPublication.ts
src/data/desktopCore.ts
src/data/directionDeliverables.ts
src/data/discussionContext.ts
src/data/discussionPresentation.ts
src/data/goalDelivery.ts
src/data/httpRepository.ts
src/data/projectAssembly.ts
src/data/projectWorkflow.ts
src/data/repository.ts
src/data/resultIntegration.ts
src/data/runtimeContracts.ts
src/data/runtimeDataSource.ts
src/data/runtimeSubmission.ts
src/data/specLineage.ts
src/data/specMaintenance.ts
src/data/types.ts
src/integration/desktop.ts
tests/deletion.test.ts
tests/delivery-contract-ui.browser.mjs
tests/delivery-contract-ui.preview.html
tests/delivery-contract-ui.preview.tsx
tests/delivery-contract.test.ts
tests/delivery-map.browser.mjs
tests/delivery-map.fixture.ts
tests/delivery-presentation.test.ts
tests/delivery-publication.test.ts
tests/delivery-review.test.ts
tests/direction-deliverables.test.ts
tests/direction-deliveries.browser.mjs
tests/direction-deliveries.fixture.tsx
tests/discussion-handoff-context.test.ts
tests/discussion-scope.test.ts
tests/goal-delivery.test.ts
tests/installer-goal-delivery.test.ts
tests/leaf-auto-execution.test.ts
tests/manual-acceptance.fixture.ts
tests/manual-output-acceptance.test.ts
tests/output-contract.browser.mjs
tests/output-contract.fixture.tsx
tests/project-assembly.test.ts
tests/project-workflow.test.ts
tests/projects.test.ts
tests/runtime-collaboration.test.ts
tests/runtime-data.test.ts
tests/single-delivery-review.browser.mjs
tests/single-delivery-review.fixture.tsx
tests/spec-attachments.browser.mjs
tests/spec-initial-baseline.test.ts
tests/spec-lineage.browser.mjs
```

## Validation evidence

- TypeScript and complete domain suites pass; 310 native/protocol/storage tests pass.
- Clean production build passes. Build is performed from a tracked-file archive outside the cloud-synced Documents folder to avoid unrelated duplicate output bundles.
- Packaged arm64 application isolated smoke passes: strictContract=true, contributionTasks=2, assemblyTasks=3, partialAcceptanceRejected=true, rendered=true; no user-data profile or live Agent used.
- Real native project `交付合并验收 · 0.14`: project discussion, task discussion, one automatic-execution start, five independent execution nodes, two final files (Markdown and HTML), per-item review, task publication v1, project publication v1, automatic Spec draft then Spec publication v1.
- Actual final HTML rendered in native immersive and published-history views. Visible body including diagram text is 266 characters with no external assets.
- Human quality checks and formal publications were performed by the test operator; execution and final candidate assembly were automatic. This is not a claim of unattended human approval.
- Preservation audit: all six old projects and 5,864 pre-existing immutable facts retained; missing=0, payload/hash changes=0. Existing background activity may append new facts.
- Five execution nodes use five distinct source session IDs. Four frozen-file receipts and one text receipt match actual bytes/hashes.
- Native test discovered first-Spec publication incorrectly invalidating an already accepted same-batch downstream output. The backend repair passes targeted regression and read-only real-snapshot reconstruction (2/2, immutable hashes unchanged, no redispatch). Installed UI verification is pending at this checkpoint.
- Local evidence is under `/private/tmp/quandeck-delivery-contract-20261117`; business data and generated artifacts are not committed.

## Release and installation

- head/local_commit: pending final delivery commit; all implementation, first-Spec baseline, duplicate-review and versioned-release-gate fixes integrated.
- remote/ref/SHA: task branch previously verified at `c7353d2f31aad1877361ce18bd6a20ceadb116cf`; newer changes not yet pushed.
- GitHub Release: not yet published; failed earlier installer run `44051780393` was blocked by obsolete smoke expectations and is not used for release.
- server_before: not applicable (desktop product; no server deployment).
- server_after: not applicable (desktop product; no server deployment).
- health_check: local build, package startup, bridge auth 200/401 and isolated smoke passed; final installed revision pending.
- functional_check: native generation, acceptance and immutable history passed; first-Spec installed restoration verification pending.
- rollback_point: `/Applications/QuanDeck-before-0140-delivery.app`, v0.13.0; pre-upgrade SQLite and attachments in evidence `rollback-before-014`.
- release platforms: Apple Silicon arm64 DMG and Windows x64 EXE, per repository AGENTS; no Intel package requested by current product release policy.

## Limitations

No changes grant model text authority to accept or publish. Semantic quality still requires review. Existing projects are not silently migrated to strict contracts or auto-dispatched. Mac notarization and Windows code signing are not configured. Formal release, remote main/tag proof and final native baseline check remain pending here.
