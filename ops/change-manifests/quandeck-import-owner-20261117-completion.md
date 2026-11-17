# Imported source ownership guard

task_id: quandeck-import-owner-20261117
status: COMMITTED
branch: codex/quandeck-import-owner-20261117
worktree: /Users/dengzhaoyu/Documents/AI Lab/.worktrees/quandeck-import-owner-20261117
head/local_commit: 99889e4cafacef310d18751cb06131348a39725c

## Scope and evidence

The observed-source UI can read source tool records (`prepareSourceSession`) before associating a source with a business task. Previously that read adopted a source with a fixed runtime task owner, but `linkSession` and `createTaskFromSession` could subsequently change the business task while continuing the old source. This change enforces the owner in backend code rather than prompt text.

- `src/data/repository.ts`: both association commands reject a different task for a resumable imported runtime, including an unbound imported source. The asynchronous association path rechecks ownership before mutation. Existing managed collaboration restrictions remain intact. Archived imported history can still be associated.
- `src/data/runtimeDataSource.ts`: historical or mismatched task/runtime records reject resume and reply before invoking the driver. Same-task imported continuation remains valid. Source import checks the captured task, agent and source against current state before recording the adoption receipt and cannot overwrite another runtime.
- `tests/runtime-data.test.ts`: regression coverage for same-task continuation, replace bypass, creating a task from an already imported source, no orphan task on failure, archive/history associations, legacy mismatched records and a rebind during asynchronous import.

No real application, real user database or model call was used for this subtask. No source files outside this worktree were modified. The paired low-level adapter HTTP APIs remain within their existing trusted-client boundary; this patch does not change that API.

## Starting Git inventory

Commands executed before modification: `git status --short --branch`, `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`, `git worktree list --porcelain`.

- status: `## codex/quandeck-import-owner-20261117`, clean.
- branch: `codex/quandeck-import-owner-20261117`.
- HEAD: `e40eb6de98f7f924d3b46b26f1a7eec557c21818`.
- origin fetch/push: `https://github.com/Johnie198946/QuanDeck.git`.
- worktree: the isolated path above, newly created from e40eb6d. The inventory included other existing task worktrees; those were left untouched. The parent audit worktree was read-only and its concurrent work was not staged or committed here.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- Targeted compiled domain tests: `runtime-data`, `timeline-repository`, `runtime-binding`, `task-identity`: all passed.
- `pnpm build`: passed; existing large-chunk warning remains.
- `pnpm test`: all domain tests passed. The Node TAP batch reported 295/298 passed; the only three failures were sandbox `listen EPERM` for the local HTTP listeners in `scripts/agent-bridge.test.mjs`, `scripts/runtime/context-access.test.mjs`, `scripts/runtime/dsh-model-bridge.test.mjs`.
- Those three suites were rerun with local listener permission: 40/40 passed, exit 0. The aggregate checks therefore cover the full suite, but the original sandboxed `pnpm test` command itself exited 1. Logs are local temporary validation output and are not committed.
- `git diff --check`: passed.

## Delivery and rollback

remote_sha: Not checked or pushed by this isolated subtask; parent integration/release task owns the authorized GitHub publication.
GitHub remote/ref/SHA: origin above; no remote ref changed here; `git ls-remote` not executed by this subtask.
server_before: Not applicable; no server deployment.
server_after: Not applicable; no server deployment.
health_check: Type check and production build passed; no deployed-server health check is claimed.
functional_check: Deterministic domain/runtime regressions passed as recorded above. Native end-to-end application validation is owned by the parent task.
rollback_point: e40eb6de98f7f924d3b46b26f1a7eec557c21818; revert code commit 99889e4cafacef310d18751cb06131348a39725c if necessary, preserving existing user records.
remaining_risks: Imported active sessions already associated under the wrong task are retained as evidence and prevented from continuing; users must start a fresh managed execution. This subtask does not repair or rewrite historical task ownership. Root integration and release validation remain with the parent task.
