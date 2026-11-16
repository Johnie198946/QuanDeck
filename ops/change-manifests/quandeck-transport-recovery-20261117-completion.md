# QuanDeck model transport recovery

task_id: quandeck-transport-recovery-20261117
status: TESTED at manifest authoring; local commit supplied to parent for integration

## Objective and evidence

Read-only inspection of the actual QuanDeck v0.11.1 workspace and Codex source logs distinguished source transport failure from host dispatch failure. Both background title requests had real source session IDs and five source-side `request timed out` retry warnings. Contemporary task runs experienced the same retries, then logged fallback to HTTP and produced actual tool calls/results. The 120-second system timeout cut short that recovery path. The installed model was gpt-6.1-sol with medium effort; no model-name mismatch was observed. Source logs, task records and credentials were never modified. Sanitized local evidence is retained outside Git at `/private/tmp/quandeck-live-repair-20261117/transport-evidence.json`.

## Changes

- scripts/runtime/system-assistance.mjs: one bounded extension of the same owned Codex request after explicit provider retry and source acceptance, at most 60 additional seconds; no second request and no implicit replay of an unknown admission. Title/classification requests use low reasoning effort. Final errors distinguish sustained provider retries.
- src/data/intelligenceRuntime.ts: preserve model acknowledgement, retry and grace diagnostics in the job receipt.
- scripts/runtime/driver.mjs: retry/heartbeat notifications do not count as recovered model progress. Actual streamed content, replies, tool activity, changed usage and requests can resolve attention.
- scripts/runtime/fixtures/protocol-peer.mjs; scripts/runtime/fixtures/system-peer.mjs; scripts/runtime/health.test.mjs; scripts/runtime/system-assistance.test.mjs: coverage for delayed successful recovery, bounded infinite retry, title effort and false health recovery.

## Git inventory

- Initial status: clean `## codex/quandeck-transport-recovery-20261117`.
- Branch: codex/quandeck-transport-recovery-20261117.
- HEAD before: 7af002762c1f8878bb953f0be4bdb5fe81654f8e.
- Remote: origin https://github.com/Johnie198946/QuanDeck.git (fetch and push).
- Worktree: `${LOCAL_WORKTREE_ROOT}/quandeck-transport-recovery-20261117`.
- Full required command inventory (`status --short --branch`, `branch --show-current`, `rev-parse HEAD`, `remote -v`, `worktree list --porcelain`) saved before edits at `/private/tmp/quandeck-live-repair-20261117/transport-git-before.txt`. Other task worktrees were present and untouched, including parent integration changes and its untracked `agent-bridge 2.mjs`.

## Validation and delivery

- Focused source protocol/system analysis/health tests: 65 passed.
- Complete `pnpm test`: all domain suites and 259 Node tests passed. First complete run exposed missing local desktop dependency link; linked the existing dependency installation without modifying dependencies, and reran successfully.
- `pnpm exec tsc --noEmit`, `pnpm build`, `git diff --check`: passed. Build reports the existing large-bundle advisory.
- commit SHA: implementation commit containing this manifest, supplied in parent completion message after commit.
- GitHub remote/ref/SHA: no push performed by this subtask; parent owns integration/release and verification.
- server_before: not applicable; local desktop code only.
- server_after: not applicable; parent owns native rebuild/install.
- health_check: full tests and build passed; root will verify installed desktop.
- functional_check: fixture protocol recovery and true model-progress boundaries passed; actual live source logs established the problem. No live model call or existing runtime process was changed by this subtask.
- rollback_point: 7af002762c1f8878bb953f0be4bdb5fe81654f8e; revert this task commit if needed.

## Limits

This fixes premature host timeout and false recovery reporting. It does not claim to repair the user's external WebSocket connectivity. Global Codex settings, provider identity and credentials are untouched. Unknown provider acceptance is retained rather than blindly replayed. Installed desktop and successful retry of the real title jobs remain parent integration checks.
