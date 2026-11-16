# Local runtime protocol

Runtime always executes the selected tool locally. No remote QuanDeck server and no model keys are stored in connection records. Tool login/configuration remains owned by its CLI.

## Supported transports

| Tool | Transport | Authoritative receipt | Resume | Human interaction |
|---|---|---|---|---|
| DeepSeek Harness | `dsh sdk`, JSON-RPC over stdio | `session/prompt.messageId` | `session/resume` | `approval/request` / `user-question/ask` |
| Codex | `codex app-server --stdio`, JSON-RPC | `turn/start` response and actual `thread.id` | `thread/resume` | App Server approval / requestUserInput |
| Claude Code | Official `@anthropic-ai/claude-agent-sdk` 0.3.325 with the selected CLI | `--replay-user-messages` exact UUID acknowledgement, or result's matching `user_message_uuid` | SDK `resume` | `canUseTool`, including AskUserQuestion |

Source-owned permission IDs are never synthesized away, and grants are one operation only. The detailed operation shown for DSH is joined from its actual `tool/call` by `callId`; the approval request itself only carries tool name / call ID / optional reason. If the source does not report a command, no command is invented.

Connections preserve absolute CLI path, optional Node path, project directory, and DSH Provider/Model IDs. DSH uses the `sdk` profile: a provider configured only in `web` may not be present in `sdk`. The shared `$DSH_HOME/cordis.patch.yml` is applied after profile settings. QuanDeck does not copy profile configuration or credentials. Verified npm `.cmd` wrappers are resolved to the official JS entry and executed without a shell; explicit Node paths work outside GUI PATH. Unknown wrappers are not allowed to carry task arguments.

## Driver

`createRuntimeDriver({getConnection,commandInvocation,initialRuns,saveRuns,onPersistenceError})` exposes:

- `run(input)` returns only after source acknowledgement. Concurrent same-dispatch submissions await one admission. `acceptance` distinguishes `acknowledged`, `unknown`, and `rejected`.
- `subscribe(listener)` emits ordered public messages, final per-turn reply, source progress/usage, child task events, source permission requests, and public tool logs.
- `control(runId, action, payload)` supports `reply`, `stop`, `resume`, `cancel`, `archive`. A finished model turn waits for the user; it does not complete the product task. Explicit archive closes the run.
- `listRuns()`, `read(runId)`, `recover(record)` and `flush()` support durable Electron storage. Recovery never replays a prompt. Storage failure stops active source processes, preserves in-memory records, and invokes `onPersistenceError`.
- `scan(connectionId)` reads only the configured project directory, recent seven days. It does not start a model turn.
- `adopt(input)` imports an exact observed source session and its public history in a paused state. Continuing from the source window is the first operation that resumes a model.

Source execution opens in an independent native window, separate from the conclusion panel. Child source windows show the corresponding child ID and public output, and are read-only. Continue a child through its parent session; no nonexistent child resume API is fabricated.

## Discovery and limits

Codex discovery uses official thread/list and thread/read. Claude uses official listSessions and getSessionMessages, with worktree expansion disabled; only messages with a final stop reason become captured replies. DSH observes official default `$DSH_HOME/sessions` (optional configured `sessionRoot`) using bounded v2/v3/v4 public log summaries, including Zstd frames. Unknown versions, oversized files, and broken compressed tails are reported as not read. It never reconstructs/resumes a session by editing its log. Disk logs cannot prove an external DSH process is still running; stop that source before resuming it in QuanDeck. Actual runtime SDK events provide live status for QuanDeck-owned runs.

WorkBuddy, Cursor, and OpenCode are not advertised as connected runtimes in this release. Installation detection or opening their CLI is not proof of dispatch/observation support.

## Verification

`node --test scripts/runtime/*.test.mjs scripts/agent-bridge.test.mjs`

Protocol peers under fixtures are test-only and excluded from desktop packaging. Claude tests run the unmodified official SDK against a controlled protocol peer. The real installed Codex CLI completed fixed-text responses over the same session, with pause/resume and source-reported token counts; evidence is `output/native-runtime/codex-live.json` (network retry recorded). DSH and Claude account-backed model execution require target-machine verification; this machine has no installed DSH/Claude CLI account.

## Official sources

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/src/types.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/cordis.patch.yml
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md
- Codex protocol verified from installed CLI `app-server generate-json-schema`.
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/agent-sdk/user-input
- https://github.com/anthropics/claude-agent-sdk-typescript
