import assert from "node:assert/strict";
import {
  applyCollaboration,
  deriveBlackboard,
  deriveLedger,
  exportCollaboration,
  hashText,
  type CollaborationActor,
  type CollaborationCommand,
} from "../src/data/collaboration";
import { createEmptySnapshot } from "../src/data/projectStorage";
import {
  deriveTaskHandoffs,
  getTaskHandoff,
  pinTaskHandoff,
  type HandoffContent,
} from "../src/data/taskHandoff";
import { getTaskMemory, queryTaskMemory } from "../src/data/taskMemory";
import { stableContent } from "../src/data/contentHash";

const snapshot = createEmptySnapshot({ id: "handoff-project", name: "后端交接合同" });
let sequence = 0;
function command(
  type: CollaborationCommand["type"],
  payload: Record<string, unknown>,
  key?: string,
  actor: CollaborationActor = { kind: "human" },
  idempotencyKey = "handoff-test-" + ++sequence,
) {
  return applyCollaboration(
    snapshot,
    {
      projectId: snapshot.project.id,
      type,
      payload,
      taskId: key,
      expectedVersion: key ? snapshot.collaboration?.tasks[key]?.version : undefined,
      idempotencyKey,
    },
    actor,
  );
}
function create(title: string, owner = "me", dependencies: string[] = []) {
  const result = command("create_task", {
    title,
    goal: title,
    criteria: ["内容与证据一致"],
    owner,
    dependencies,
  });
  assert(result.ok, result.message);
  return result.resourceId!;
}
function accept(key: string, submissionId: string) {
  const result = command(
    "review",
    { submissionId, verdict: "accepted", note: "已核对来源", checks: [true] },
    key,
  );
  assert(result.ok, result.message);
}
const source = create("21E：查阅项目规范");
const content: HandoffContent = {
  summary: "已核对规范 v1 与交互说明。".repeat(30),
  completed: ["核对交互边界与来源"],
  decisions: ["后续页面采用分区展示"],
  remaining: [],
  nextSteps: ["将规范和边界交给开发任务"],
};
const submitted = command(
  "submit",
  { title: "规范查阅结果", body: "完整事实正文，不以开头作为人工提供的总结。", handoff: content },
  source,
);
assert(submitted.ok, submitted.message);
const c = snapshot.collaboration!;
assert.equal(
  c.handoffs?.length,
  1,
  "successful submission automatically records exactly one handoff",
);
const first = getTaskHandoff(snapshot, source)!;
assert.equal(first.origin, "recorded");
assert.equal(first.record.contentOrigin, "provided");
assert.equal(first.record.submissionId, submitted.resourceId);
assert.equal(first.record.content.summary, content.summary);
assert.equal(first.record.contentHash, hashText(stableContent(content)));
assert.equal(first.reviewStatus, "unreviewed");
assert.equal(
  first.record.sequence,
  c.events.find((event) => event.detail === submitted.resourceId)?.sequence,
);
assert.equal(first.record.specRevision, c.tasks[source].specRevision);
assert.equal(
  getTaskMemory(snapshot, source)!.summary,
  content.summary.slice(0, 240),
  "lookup cards are bounded excerpts; full registered handoff remains available",
);
assert.equal(
  queryTaskMemory(snapshot, { projectId: snapshot.project.id, query: first.record.id }).items[0]
    .key,
  source,
);
const original = JSON.stringify(first.record);
accept(source, submitted.resourceId!);
assert.equal(
  JSON.stringify(getTaskHandoff(snapshot, source)!.record),
  original,
  "review projects authority without rewriting the handoff",
);
assert.equal(getTaskHandoff(snapshot, source)!.reviewStatus, "accepted");
assert.ok(getTaskHandoff(snapshot, source)!.reviewId);
assert.equal(
  deriveLedger(snapshot).find((row) => row.key === source)?.handoff?.record.id,
  first.record.id,
);
assert.equal(deriveBlackboard(snapshot).handoffs[0].record.id, first.record.id);
assert.equal(pinTaskHandoff(getTaskHandoff(snapshot, source)!).reviewStatus, "accepted");

const target = create("14D：开发页面", "agent", [source]);
const claim = command("claim", { executor: "codex" }, target, { kind: "service" });
assert(claim.ok, claim.message);
const run = snapshot.collaboration!.runs[claim.resourceId!];
const actor: CollaborationActor = { kind: "runtime", runId: run.id, claimEpoch: run.claimEpoch };
const claimed = getTaskHandoff(snapshot, source)!;
assert.equal(claimed.successors[0].key, target);
assert.equal(
  claimed.successors[0].claimedBy,
  "codex",
  "successor ownership comes from the actual current run",
);
const checkpoint = command(
  "checkpoint",
  { completed: ["读取规范"], remaining: ["继续页面开发"], note: "首段检查结束" },
  target,
  actor,
);
assert(checkpoint.ok, checkpoint.message);
const proposal = {
  title: "页面候选",
  body: "页面已经实现，待独立验收。",
  unresolved: ["仍需验收窄屏"],
  nextSteps: ["执行窄屏验收"],
};
const result = command("submit", proposal, target, actor);
assert(result.ok, result.message);
const second = getTaskHandoff(snapshot, target)!;
assert.equal(second.record.contentOrigin, "derived");
assert.deepEqual(second.record.content.completed, ["读取规范"]);
assert.deepEqual(second.record.content.remaining, ["仍需验收窄屏"]);
assert.deepEqual(second.record.content.nextSteps, ["执行窄屏验收"]);
assert.equal(second.record.runId, run.id);
assert.equal(second.record.contextPackageId, run.contextPackageId);
assert.equal(
  second.record.contextHash,
  snapshot.collaboration!.contextPackages.find((context) => context.id === run.contextPackageId)
    ?.hash,
);
assert.deepEqual(
  second.record.sourcePins.map((pin) => pin.artifactId),
  [first.record.artifactId],
);
assert.equal(second.reviewStatus, "unreviewed");
const rejected = command(
  "review",
  {
    submissionId: result.resourceId,
    verdict: "accepted",
    note: "不能绕过未解决项",
    checks: [true],
  },
  target,
);
assert.equal(rejected.code, "INCOMPLETE_DELIVERY");
assert.equal(second.record.contentHash, getTaskHandoff(snapshot, target)!.record.contentHash);

const attempt = create("不可伪造交接");
for (const invalid of [
  { ...content, status: "done" },
  { ...content, artifactId: first.record.artifactId },
  { ...content, summary: "" },
  { ...content, remaining: "不合法数组" },
]) {
  const before = JSON.stringify(snapshot);
  const result = command(
    "submit",
    { title: "错误候选", body: "不应被持久化", handoff: invalid },
    attempt,
  );
  assert.equal(result.code, "HANDOFF_INVALID");
  assert.equal(
    JSON.stringify(snapshot),
    before,
    "invalid handoff rolls back artifact, submission, status and events together",
  );
}
const blocker = command(
  "submit",
  {
    title: "保留阻塞事实",
    body: "测试候选",
    unresolved: ["真实阻塞"],
    nextSteps: ["检查来源"],
    handoff: { ...content, remaining: [], nextSteps: [] },
  },
  attempt,
);
assert(blocker.ok, blocker.message);
assert.deepEqual(getTaskHandoff(snapshot, attempt)!.record.content.remaining, ["真实阻塞"]);
assert.deepEqual(getTaskHandoff(snapshot, attempt)!.record.content.nextSteps, ["检查来源"]);

const contentOnlyTask = create("只有交接内容中的剩余事项");
const contentOnly = command(
  "submit",
  {
    title: "交接有阻塞",
    body: "未完成的候选",
    handoff: { ...content, remaining: ["实现尚未完成"] },
  },
  contentOnlyTask,
);
assert(contentOnly.ok, contentOnly.message);
assert.deepEqual(
  snapshot.collaboration!.submissions.find((item) => item.id === contentOnly.resourceId)!
    .unresolved,
  ["实现尚未完成"],
);
assert.equal(
  command(
    "review",
    {
      submissionId: contentOnly.resourceId,
      verdict: "accepted",
      note: "不能通过另一字段遗漏阻塞",
      checks: [true],
    },
    contentOnlyTask,
  ).code,
  "INCOMPLETE_DELIVERY",
);

const replayTask = create("幂等登记");
const replayCommand: CollaborationCommand = {
  projectId: snapshot.project.id,
  type: "submit",
  taskId: replayTask,
  expectedVersion: snapshot.collaboration!.tasks[replayTask].version,
  idempotencyKey: "same-submit",
  payload: { title: "幂等交付", body: "同一条提交只能有一条总结" },
};
assert(applyCollaboration(snapshot, replayCommand, { kind: "human" }).ok);
const count = snapshot.collaboration!.handoffs!.length;
assert(applyCollaboration(snapshot, replayCommand, { kind: "human" }).replayed);
assert.equal(snapshot.collaboration!.handoffs!.length, count);

const legacy = structuredClone(snapshot);
delete legacy.collaboration!.handoffs;
const beforeLegacy = JSON.stringify(legacy);
const legacyHandoff = getTaskHandoff(legacy, source)!;
assert.equal(legacyHandoff.origin, "legacy-derived");
assert.equal(legacyHandoff.record.contentOrigin, "derived");
assert.equal(
  JSON.stringify(legacy),
  beforeLegacy,
  "legacy summary projection never backfills invented historical records",
);
assert.equal(
  getTaskHandoff(legacy, source)!.record.hash,
  legacyHandoff.record.hash,
  "legacy pins are deterministic",
);
const detached = getTaskHandoff(snapshot, source)!;
detached.record.content.summary = "caller mutation";
assert.equal(getTaskHandoff(snapshot, source)!.record.content.summary, content.summary);
const foreign = createEmptySnapshot({ id: "other-project", name: "其他项目" });
assert.deepEqual(deriveTaskHandoffs(foreign), []);
const tampered = structuredClone(snapshot);
tampered.collaboration!.handoffs![0].content.summary = "tampered";
assert.equal(
  getTaskHandoff(tampered, source)!.stale,
  true,
  "a changed immutable summary cannot be reused as current evidence",
);
assert.equal(
  getTaskMemory(tampered, source)!.stale,
  true,
  "memory lookup carries the same integrity failure",
);
assert(
  command(
    "revise_task",
    { goal: "修改了规范查阅范围", criteria: ["需重新核对"], reason: "范围变化", owner: "me" },
    source,
  ).ok,
);
assert(getTaskHandoff(snapshot, source)!.stale);
assert.equal(JSON.stringify(getTaskHandoff(snapshot, source)!.record), original);
const documents = exportCollaboration(snapshot);
// Compact default projections point to source records; full business history remains explicit.
for (const document of [documents.ledger, documents.blackboard]) {
  assert(!document.includes(content.summary), 'default projection does not repeat full handoffs');
  assert(document.includes('来源') || document.includes('交接'));
}
const recovery = exportCollaboration(snapshot, { includeAudit: true });
for (const text of [first.record.id, first.record.artifactId, target]) assert(recovery.json.includes(text), text);
assert.equal(getTaskHandoff(snapshot, source)!.record.content.summary, content.summary);
console.log(
  "task handoff: atomic records, immutable provenance, authority projections, legacy compatibility and fixed exports passed",
);
