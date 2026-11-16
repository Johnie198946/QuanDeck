# QuanDeck system analysis idle timeout repair

- task_id: quandeck-system-idle-timeout-20261117
- status: COMMITTED
- branch: codex/quandeck-system-idle-timeout-20261117
- worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-system-idle-timeout-20261117
- commit SHA (implementation): b90da4fc80a8f75e151832117e82febb9cc678ac
- base: 0bbca40a96cc9fca1e0a0ae3d2d194e350d2f753

## Objective and change

Keep an already admitted, isolated system analysis alive while the model produces new output. Preserve a bounded wait when transport never recovers or output stops. Do not retry unknown admission, modify credentials, loosen permissions, or mutate business facts.

- scripts/runtime/system-assistance.mjs: only new nonempty text/reasoning deltas, changed complete messages, and strictly increasing usage refresh the idle deadline. Repeated fragments/usage, empty deltas, acknowledgements, retry/status events cannot refresh it. No-progress Codex transport retains at most the original timeout plus one bounded grace period. Output inactivity reports a different diagnostic from ongoing connection retry.
- src/data/intelligenceRuntime.ts: persist safe progress-present/last-progress-time error metadata, excluding provider body/diagnostic content.
- scripts/runtime/fixtures/system-peer.mjs, scripts/runtime/system-assistance.test.mjs, tests/intelligence-runtime.test.ts: streaming, stalled output, replay/noise, usage and persistence regressions.

## Evidence and limits

Existing source logs for four failed live summaries explicitly showed WebSocket request timeouts, then HTTP fallback and HTTP 200 at approximately 113 seconds. Reasoning/message output items appeared around 120 seconds. The application still closed the same owned request at its fixed 180-second wall-clock limit. This demonstrates that “connection continuously retrying” was an inaccurate blanket diagnosis and that the adapter ignored model activity when calculating expiry. Existing persisted logs did not retain each text delta, so they do not prove output was still arriving at the exact abort instant.

An isolated live diagnostic was prepared privately. The first launch exited before admission. The integration task tracks the separately authorized real-provider verification; it is not claimed by this implementation commit. Local protocol tests cover the observed transport timing plus controlled continuous output across the old deadline.

## Validation

- node --test scripts/runtime/system-assistance.test.mjs: 15/15 passed.
- pnpm exec tsc --noEmit: passed.
- pnpm test: complete domain tests and 265/265 Node tests passed. Local fixture network listeners required the test-only sandbox escalation; no real provider inference or live DB write is part of this suite.
- pnpm build: passed; existing large-bundle warning remains.
- git diff --check: passed.

## Delivery / rollback

- GitHub remote: origin https://github.com/Johnie198946/QuanDeck.git
- GitHub ref / remote SHA / git ls-remote: not executed by this subtask; parent integration owns authorized release.
- server_before: not applicable; no server deployment or live app replacement by this subtask.
- server_after: not applicable.
- health_check: local TypeScript, build and protocol tests passed; no live-provider health assertion.
- functional_check: same request survives continuous real model events; no-progress/replayed events time out; stalled output remains unknown until explicit retry; progress diagnostics persist without source content.
- rollback_point: base 0bbca40a96cc9fca1e0a0ae3d2d194e350d2f753. Revert the implementation commit to restore the prior timeout behavior; no data migration.
- remaining_risks: external WebSocket connectivity remains outside this fix. Continuous real generation may exceed the old wall-clock window by design, bounded by inactivity and the source Agent’s own lifecycle. Duplicate identical delta fragments are conservatively ignored because the protocol has no mandatory per-fragment sequence ID. The integration task subsequently obtained specific authorization and verified one real replay completed at 205.1 seconds, beyond the old cutoff; formal binding/domain validation passed on an in-memory clone. No real database was written.

## Pre-change Git inventory

Shared integration worktree was read only. Its unrelated untracked desktop/app/agent-bridge 2.mjs file was neither changed nor staged. This task used a new worktree and branch from the recorded integration commit. The task worktree began clean.

```text
git status --short --branch
## codex/quandeck-live-repair-20261117
?? "desktop/app/agent-bridge 2.mjs"
```

```text
git branch --show-current
codex/quandeck-live-repair-20261117
```

```text
git rev-parse HEAD
0bbca40a96cc9fca1e0a0ae3d2d194e350d2f753
```

```text
git remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)
```

```text
git worktree list --porcelain
Recorded privately before changes. Integration worktree: .worktrees/quandeck-live-repair-20261117,
branch codex/quandeck-live-repair-20261117, HEAD 0bbca40a96cc9fca1e0a0ae3d2d194e350d2f753.
New task worktree: .worktrees/quandeck-system-idle-timeout-20261117,
branch codex/quandeck-system-idle-timeout-20261117, same initial HEAD.
Other unrelated worktrees were not modified; their paths are omitted from this public manifest.
```

Task worktree inventory after creation:
```text
git status --short --branch
## codex/quandeck-system-idle-timeout-20261117
git branch --show-current
codex/quandeck-system-idle-timeout-20261117
git rev-parse HEAD
0bbca40a96cc9fca1e0a0ae3d2d194e350d2f753
git remote -v
origin https://github.com/Johnie198946/QuanDeck.git (fetch)
origin https://github.com/Johnie198946/QuanDeck.git (push)
```
