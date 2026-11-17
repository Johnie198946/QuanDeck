# Completion manifest

- task_id: quandeck-direct-task-projection-20261117
- status: COMMITTED
- branch: codex/quandeck-direct-task-projection-20261117
- worktree: <task-worktree>
- code_commit: f1fcc0d2846dc17aac08010a7d8e2693fc0fe2c3

## Objective and files

Correct ordinary direct-execution tasks that have a current candidate in the canonical ledger but no declared direction/output slots: their source can remain waiting_reply without requesting input. Use the shared idle-session delivery predicate for task status/counts, and current unassigned ledger submissions for the progress trail. Do not mutate task acceptance, source lifecycle or create output slots.

Files: src/data/derive.ts; src/data/taskProgressTrail.ts; src/components/journal/TaskProgressTrail.tsx; src/components/ui/StatusPill.tsx; tests/execution-progress.test.ts; docs/validation/direct-task-delivery-projection-20261117.md.

## Opening inventory

- git status --short --branch: clean, `## codex/quandeck-direct-task-projection-20261117`.
- git branch --show-current: codex/quandeck-direct-task-projection-20261117.
- git rev-parse HEAD: b8bfb4baadf79cb9ad39d149faace760b0408a78.
- git remote -v: origin https://github.com/Johnie198946/QuanDeck.git (fetch/push).
- git worktree list --porcelain: bare repository at <local-bare-repository>; independent task worktree above on its own branch, separate from root integration worktree quandeck-permissions-spec-flow-20261117 and other registered tasks. Inventory captured at <private-evidence-dir>/worktrees.txt. No other worktree modified or staged.

## Validation

- Targeted TypeScript compilation of tests/execution-progress.test.ts: exit 0.
- Compiled execution-progress.test.js: exit 0, including current unslotted candidate, real question/permission priority, rejected submission, failed/running source, stale spec revision, accepted delivery and snapshot immutability.
- node node_modules/typescript/bin/tsc --noEmit: exit 0.
- pnpm build: exit 0. Existing bundle-size advisory remains.
- git diff --check and staged diff check: clean.
- Native inspection: parent preserves the real candidate unaccepted for integration-install verification. This child did not operate native UI or modify real DB. Runtime facts inspected read-only; no prompts/secrets copied into this manifest.

## Delivery and rollback

- remote/ref/SHA: not pushed by this child; root owns integration/release.
- git ls-remote evidence: not executed; no PUSHED claim.
- server_before: not applicable, local desktop code change.
- server_after: not applicable, no server deployment or app installation by this child.
- health_check: TypeScript and production build passed; external runtime health not tested here.
- functional_check: targeted domain/projection regression passed; native post-install check remains with parent.
- rollback_point: b8bfb4baadf79cb9ad39d149faace760b0408a78; revert this task's commit in the integration branch if necessary, no database rollback required.
- remaining_risks: source lifecycle still belongs to the source Agent, so actual requests/errors retain attention; candidate delivery is not user acceptance. No full-suite rerun or native install in this isolated task, per parent scope. Main integration/release is not implied by this local commit.
