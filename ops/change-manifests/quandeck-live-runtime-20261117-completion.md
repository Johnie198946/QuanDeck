# QuanDeck real-runtime repair

task_id: quandeck-live-runtime-20261117
status: COMMITTED
branch: codex/quandeck-live-runtime-20261117
worktree: ${LOCAL_WORKTREE_ROOT}/quandeck-live-runtime-20261117
head/local_commit: 5eb42eb0a17c2c68815db08d2768a98b9d10b830
remote_sha: 未执行；交由主任务合并及推送核验。
server_before: 不适用，桌面应用。
server_after: 不适用，未部署服务器或替换用户 App。
health_check: pnpm exec tsc --noEmit、pnpm build 通过。
functional_check: pnpm test 全部域测试及 254 Node tests 通过；最终 goal-delivery 回归重跑通过。
rollback_point: f2fba51341addc507e74e56d60424f3b8a226015；用户真实数据库只读分析，无直接修改。
remaining_risks: 原生真实执行与新安装包验证由主任务完成；权限仍须真实来源回执，未自动批准任何工具授权。

## Scope and evidence

- Removed legacy project concurrency rejection from business claims, intelligence, review and ready queue; actual usage remains observable and one-task ownership/idempotence remains enforced.
- Known unsent legacy capacity rejection can resume once; uncertain admissions are never blindly retried.
- Permission/input waits stop the affected dependency branch; independent ready branches continue. A prior whole-task run prevents automatic children racing it.
- Post-approval decomposition returning waiting_reply closes only after a real source stop receipt, then continues automatically. Interrupted/unknown close remains fenced.
- Explicit execution text is recorded in the authorization event and bound to the original project/plan session.
- Delta discussion replies inherit omitted outline/deliverables; explicit empty arrays remain distinct. Invalid task references are rejected.
- Recovery appends a new immutable delivery-map version only for known legacy fallback slots with no outputs and unchanged bindings. Tested on an in-memory copy of the real backup: one plan recovered from 4 fallback slots to 5 declared slots; all previous plan versions, runs and execution attempts preserved byte-for-byte, second recovery no-op.
- Title presentation no longer discards a valid title merely because execution advanced the task version. Manual title/revision checks remain.

## Validation

- Initial non-escalated full suite failed only because isolated worktree desktop dependencies were not linked and localhost listeners were denied by the sandbox. Dependencies were linked, then full tests reran with localhost permission and passed.
- Full log: /private/tmp/quandeck-live-repair-20261117/runtime-test-final.log
- Build log: /private/tmp/quandeck-live-repair-20261117/runtime-build-final.log
- Original database backup is owned by root task; source data was read-only throughout.
- No GitHub push, release, native install, provider permission approval or server deployment performed by this subtask.

## Changed files

```
src/data/collaboration.ts
src/data/discussionPresentation.ts
src/data/goalDelivery.ts
src/data/governance.ts
src/data/integrationReview.ts
src/data/intelligence.ts
src/data/projectWorkflow.ts
src/data/repository.ts
src/data/runtimeDataSource.ts
src/data/runtimeSubmission.ts
tests/goal-delivery.test.ts
tests/integration-review.test.ts
tests/intelligence.test.ts
tests/runtime-data.test.ts
```

## Initial Git inventory

```text
status --short --branch
## codex/quandeck-live-runtime-20261117


branch --show-current
codex/quandeck-live-runtime-20261117


rev-parse HEAD
f2fba51341addc507e74e56d60424f3b8a226015


remote -v
origin	https://github.com/Johnie198946/QuanDeck.git (fetch)
origin	https://github.com/Johnie198946/QuanDeck.git (push)


worktree list --porcelain
Full multi-worktree inventory retained in local audit evidence; unrelated task details omitted from this public copy.
```

## Review follow-up

- Explicitly fence decomposition.closeState=unknown even when its session already appears archived. Archive is not process-stop evidence.
- Only a later archived session with stoppedConfirmed=true releases this fence; pending permissions and unknown source state are not bypassed.
- Added regression reproducing archived+unknown, asserting zero executions until an explicit confirmed source-stop receipt is present.
- Revalidated pnpm exec tsc --noEmit and goal-delivery contract test successfully.

## Submission reliability follow-up (2026-11-17)

- Fixes observed result loss: successful checkpoints and recoverable malformed JSON no longer permanently block later public final results; successful result receipts are distinguished from progress receipts and deduplicated against the bound run's submission.
- All rejected protocol payloads remain rejected. Binding, claim, source, slot, schema authority and review guards remain in the domain path. A semantic/security rejection requires a correct structured result; a plain final cannot bypass it.
- Submission errors persist as `runtime.submissionIssue` for the separately integrated activity projection. Successful checkpoints do not clear a rejected result; successful corrected results do. Blockers retain their actual reason. User-initiated correction replies include the exact failure and bound protocol instructions.
- Codex/Claude, DSH and Hermes adapters now emit a trusted successful-turn signal. Ordinary waiting, interrupted/failed turns, permissions and questions never imply completion. Pure prose questions/blockers stay in the conversation.
- Automatic goal execution requires formal results. If a successful source turn produced a report without its protocol envelope, one durable formatting repair is sent to the same owned session, using its exact binding and existing work only. The reservation records exact plan/draft/authorization versions and revalidates them with claim ownership before sending. Unknown send acknowledgement is never replayed. Source-level request guards reject text replies while permissions/questions are pending.
- Fixed stale transaction references after collaboration commands replace the snapshot draft, so issue/repair metadata actually persists.
- JSON bodies may quote protocol tags as ordinary report content. Multiple concatenated envelopes still fail parsing.
- Changed files: scripts/runtime/driver.mjs; scripts/runtime/driver.test.mjs; src/data/runtimeContracts.ts; src/data/runtimeDataSource.ts; src/data/runtimeSubmission.ts; tests/goal-delivery.test.ts; tests/runtime-collaboration.test.ts; this manifest.
- Validation: full `pnpm test` domain suite and 254 Node tests pass. Initial sandbox run passed domain tests but localhost server tests hit EPERM; authorized local-server rerun passes all 254. `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check` pass.
- Before follow-up: clean codex/quandeck-live-runtime-20261117 at c9bbcb19f31be67c568087c239cc2a7599b67659. Existing worktree/remote inventory above remains applicable; no other worktree was edited.
- Status: TESTED at manifest authoring; implementation commit recorded by the parent integration manifest after commit.
- Native installation/E2E, GitHub push and release: not performed by this subtask; parent owns them. No live user DB was edited. server_before/server_after: not applicable to local-only subtask. health_check: full tests/build pass. functional_check: source protocol fixture + automatic goal regression pass. rollback_point: c9bbcb19f31be67c568087c239cc2a7599b67659.
- Known limitation: result submission protocol currently accepts body/registered source IDs/slot IDs, not arbitrary file attachments; genuine project file paths can be included in Markdown. We do not enlarge filesystem authority in this repair. Fallback question detection is intentionally conservative; automatic goal tasks always require the formal result envelope before downstream consumption.
