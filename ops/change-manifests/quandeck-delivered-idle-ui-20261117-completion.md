# Completed delivery and fresh-context UI correction

- task_id: quandeck-delivered-idle-ui-20261117
- status: COMMITTED
- branch: codex/quandeck-delivered-idle-ui-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-delivered-idle-ui-20261117
- code commit: 420952831860a9688a9b8cad9b23e0608380298d
- base: 9bd83e5204419c1f7147e51bf2474fe1a4b4c148

## Goal and changes

Correct actual native restart evidence: an exact complete candidate remained in the ledger but its paused source was displayed as live paused execution and actionable pending work. A second archived source was resurrected by its historical SCHEMA_INVALID receipt.

Read-only delivery projection now recognizes idle/stopped source states and exact current ledger delivery. Work item/overview/task projections and RuntimeConsole preserve awaiting review, remove stale execution bars, and route review to the existing delivery map. Current requests and explicit failure/submission-error states take precedence; open incidents prevent quieting the console. Archived source receipts stay historical. No actual task, ledger, source lifecycle or database was rewritten.

RuntimeConsole also consumes the host contextRestart descriptor, displays its reason, and exposes the explicit `restart_fresh_context` action. A stale source no longer advertises ordinary resume/reply; real request cards remain available. The domain/host contract is implemented by the coordinated runtime agent and must be integrated before release.

Changed files: src/data/sessionDelivery.ts, projectActivity.ts, workItemPresentation.ts, taskExecutionPresentation.ts, overviewTree.ts, runtimePresentation.ts; src/components/results/OverviewDetails.tsx; src/components/runtime/RuntimeConsole.tsx; src/integration/desktop.ts; tests/partial-delivery.test.ts, runtime-presentation.test.ts, execution-progress.test.ts.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed; existing large-chunk warning remains.
- `pnpm test`: passed all domain scripts and 261 Node subtests, zero failures.
- `git diff --check`: passed.
- Regression cases: complete exact source paused/waiting/archived/cancelled remains awaiting review with no live progress; paused source with actual permission/question or a current submission error remains actionable; wrong run cannot inherit another candidate; partial remains incomplete; archived legacy failed receipt never re-enters current attention.
- Full log: /private/tmp/quandeck-live-repair-20261117/delivered-idle-tests.log
- Browser integration: passed against root integrated source on existing port 4253; native app remains parent-owned. No native app operation by this subtask.

## Remote and deployment

- remote/ref: origin / no push by this subtask; parent owns authorized release.
- remote_sha / git ls-remote: not executed; no PUSHED claim.
- server_before: not applicable, local desktop UI source.
- server_after: not applicable, installation handled by parent.
- health_check: local type/build/test checks above; no deployment claim.
- functional_check: domain/runtime regression and integrated isolated browser checks passed; native installation remains parent-owned.
- rollback_point: base 9bd83e5204419c1f7147e51bf2474fe1a4b4c148; revert this isolated change if needed, no user-data migration.
- remaining_risks: runtime context restart requires companion host/domain change; original physical native reproduction remains parent-owned.

## Before-work inventory

```text
$ git status --short --branch
## codex/quandeck-delivered-idle-ui-20261117


$ git branch --show-current
codex/quandeck-delivered-idle-ui-20261117


$ git rev-parse HEAD
9bd83e5204419c1f7147e51bf2474fe1a4b4c148


$ git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)


$ git worktree list --porcelain
Full multi-worktree inventory retained in local audit evidence; unrelated task details omitted from this public copy.
```

## Integrated browser verification

- Root integrated the code and subsequent schedule-drawer fix (reported root 8378c43); tested existing 4253 dev server with an isolated fresh browser, blocking external network except local server and data/blob assets.
- Actual source: read-only workspace-before-upgrade-3.sqlite copied and sanitized into isolated browser storage. An exact complete candidate has a paused source; precise identity mapping remains only in local evidence. Overview leaf/selected detail show 待验收, no paused execution bar and no fake 处理待办; existing delivery-map entry remains available.
- A separate actual archived source with historical SCHEMA_INVALID receipt stays out of current activity. A browser-only pending permission added to the completed source takes precedence, without altering user data.
- RuntimeConsole isolated host fixture: paused complete candidate header is 候选成果已提交, no stale progress/continue/composer; an actual unresolved permission card remains visible; contextRestart descriptor emits only restart_fresh_context when enabled, blocks the button when unconfirmed, and suppresses ordinary resume/reply.
- Artifacts: /private/tmp/quandeck-live-repair-20261117/delivered-idle-final/checks.json; actual-complete-paused-overview.png; paused-complete-console.png; paused-complete-current-request.png; fresh-context-restart-ui.png. Screenshots visually checked for overview and completed console.
- Root updated tests/live-ui-repair.browser.mjs passed: screenshot paste/thumbnail, creation without Agent, manual title preserving original demand, attachment-only/PDF drop, normal/focus layouts at 2560/1920/1440/1024/768/320, focus-mode 日程 drawer actually visible above scrim and closes successfully. Zero page errors. Artifacts: /private/tmp/quandeck-live-repair-20261117/final-focus-drawer/checks.json and direction-normal-*.png.
- Fresh-context domain/host end-to-end is explicitly not claimed by this UI fixture. Companion runtime agent owns its guarded new-attempt validation; parent owns final native verification.

## Fresh-context host/UI integration

After root integrated the companion runtime change, `/private/tmp/quandeck-live-repair-20261117/fresh-context-host-ui.browser.mjs` connected the actual root `desktop/app/run-workflow.mjs` handler to the actual renderer through an isolated fake domain source. Passed: host read descriptor is rendered; unavailable restart shows its reason and disabled button; the concurrent permission card still sends requestId/decision to the exact original session; ordinary continue/composer are absent; enabled restart invokes the production host action and opens the new session's run receipt. Zero browser page errors. Evidence: `/private/tmp/quandeck-live-repair-20261117/fresh-context-host-ui/checks.json` and `fresh-host-action.png`. This validates the host/UI contract without launching a real Agent or mutating the user's database; guarded domain behavior is covered by the companion agent's runtime tests.
