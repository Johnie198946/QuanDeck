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

## Managed collaboration in v0.6.0

`RuntimeSource` claims a domain Run before calling the provider. `runtime.runId` is the provider driver ID; `runtime.collaboration.runId` is the ledger Run ID. The immutable context package contains the exact dispatched prompt, hash, estimated input size, requirements revision and claim epoch. Dispatch creates a fresh source session. Resume keeps its source identity and is rejected when requirements/claim ownership have changed. Unknown admission stays blocked for reconciliation, with no automatic resend. Restart pauses records without replaying prompts.

Ordinary replies, archived sessions, provider `done`, and child-agent completion never accept a managed task. `startDiscussion` creates a separate planning task; `startReview` creates a separate review task and pins the full current candidate, rejecting oversized review input instead of silently truncating it. Review opinions are candidates; only the human review command accepts work. A replaced or returned review target makes a later review submission stale.

Current CLI transports use the strict `quandeck.runtime.v1` fallback channel in `src/data/runtimeSubmission.ts`: one complete assistant message must consist of `<quandeck-submission>{JSON}</quandeck-submission>`. Its allowed top-level fields are `schemaVersion`, `idempotencyKey`, `binding`, `kind`, and `payload`. Binding includes project/task/work-item, managed run, context package, input task version, specification revision and claim epoch. Identity is checked against the trusted connection record; the model cannot grant itself authority by changing JSON. The four kinds are `result`, `checkpoint`, `plan_proposal`, and `blocker`; payload fields and data sizes are checked before domain validation. Quoted examples, arbitrary prose, unknown fields, source IDs absent from the pinned package, stale claims and authority fields are rejected. Original replies and per-message submission receipts remain visible. Successful repeated keys reuse the first receipt; changed payloads conflict.

This implemented runtime contract is deliberately named separately from the broader design document's target `1.0` schema. It does not claim to provide a general MCP submission endpoint, arbitrary source retrieval, or support for every target-schema field. Research citations can be included in candidate prose for the human reviewer; authoritative source IDs are only the versions already in the fixed context package.

Budgets are soft for external CLIs: the driver pauses after source-reported usage reaches the reserved limit, preserves the actual overage and public reply, and blocks further resume/reply for that run. Provider calls may exceed the threshold before reporting. Missing usage remains unknown, not zero. External CLI tool/file isolation is recorded as **unverified**; prompts and permission callbacks do not establish a hard sandbox. Context token counts are explicit estimates, not provider usage. No autonomous external-action guarantee is claimed.

## Discovery and limits

### Independent system AI

`RuntimeDriver.assist` performs intake classification and project summaries without creating business tasks, Runtime runs, journal sessions or business execution statistics. `src/data/intelligenceRuntime.ts` persists the original intake first and returns immediately; the provider operates in the background. The only automatically selected provider is the **first record in the user's saved Agent configuration list**. Default/star order does not influence selection and an unavailable first record never falls through to another one. A new project can use that configured provider without binding the old project's working directory.

Every system request gets a new isolated temporary directory and fresh source session. No credential is copied and no source conversation is resumed. Codex uses the existing login with explicit feature overrides, ephemeral threads, empty environments/capability roots, read-only/no-network sandbox, disabled project instructions, and disabled configured MCP servers. The effective sandbox, empty inherited instruction sources and MCP inventory must be confirmed before `turn/start`; unsupported versions fail without a model request. Any observed tool call or approval request aborts the analysis. The actual capability label is `read-only-isolated`, not a claim that every external CLI version is an absolute tool-free sandbox. Claude uses its installed official SDK with `tools: []`, strict empty MCP configuration, no filesystem settings/skills/plugins, no persisted session and denied tool requests. DSH system analysis is currently unsupported; its normal manually dispatched execution path remains available.

The `quandeck.ai.classify.v1` and `quandeck.ai.summary.v1` JSON envelopes bind project, immutable input job, input ID and source-event watermark. Domain validators separately validate task/date precision, facts, completed status, duplicates and suggestion creation authority. A model result cannot choose the project, complete tasks, or turn summary suggestions into accepted tasks.

Summary changes debounce for five seconds and run once per project. Source progress and accounting receipts do not form a model-call feedback loop. An old result is retained as history and queues a fresh bounded input; it does not replace the current summary. Failed/restarted jobs preserve original input and unknown usage reservations; explicit retry is required. Each admitted system request reserves the shared project token budget, has a maximum token allowance and 90-second deadline, and keeps source-reported usage separate from estimates. Shutdown stops scheduling and aborts source requests before storage closes.

The non-inference `probeCodexSystemConnection` verifies the same admission checks without ever calling `turn/start`. This implementation was checked against the installed Codex CLI 0.161.0; the local evidence artifact is `output/codex-system-capability-check.json`. Automated tests use fixture peers/mocked SDKs, not paid user-provider inference.

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
