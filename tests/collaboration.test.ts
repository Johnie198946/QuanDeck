import assert from "node:assert/strict";
import {
  applyCollaboration,
  buildContextPackage,
  deriveBlackboard,
  ensureCollaboration,
  exportCollaboration,
  hashText,
  taskKey,
  type CollaborationActor,
  type CollaborationCommand,
  type CollaborationCommandType,
} from "../src/data/collaboration";
import { createEmptySnapshot } from "../src/data/projectStorage";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import type { Snapshot } from "../src/data/types";

let sequence = 0;
const human: CollaborationActor = { kind: "human" },
  service: CollaborationActor = { kind: "service" };
const project = () => createEmptySnapshot({ id: "project-test", name: "泰国行程" });
function command(
  s: Snapshot,
  type: CollaborationCommandType,
  payload: Record<string, unknown> = {},
  key?: string,
  actor: CollaborationActor = human,
  extra: Partial<CollaborationCommand> = {},
) {
  const [taskId, workItemId] = key?.split("::") ?? [];
  return applyCollaboration(
    s,
    {
      projectId: s.project.id,
      idempotencyKey: "test-" + ++sequence,
      type,
      taskId,
      workItemId,
      expectedVersion: key ? s.collaboration?.tasks[key]?.version : undefined,
      payload,
      ...extra,
    },
    actor,
  );
}
function create(
  s: Snapshot,
  title: string,
  owner: "me" | "agent" = "me",
  dependencies: string[] = [],
) {
  const result = command(s, "create_task", {
    title,
    goal: title + "目标",
    criteria: ["目标达成", "证据可追溯"],
    owner,
    dependencies,
  });
  assert(result.ok, result.message);
  return result.resourceId!;
}
function submit(s: Snapshot, key: string, sourceIds: string[] = []) {
  const result = command(
    s,
    "submit",
    { title: "明确交付", body: "逐项核对的人工成果，参考交通班次和住宿信息。", sourceIds },
    key,
  );
  assert(result.ok, result.message);
  return result.resourceId!;
}
function accept(s: Snapshot, key: string, submissionId: string) {
  const result = command(
    s,
    "review",
    { submissionId, verdict: "accepted", note: "已查看交付证据并逐条确认", checks: [true, true] },
    key,
  );
  assert(result.ok, result.message);
}
const s = project();
assert.equal(
  hashText("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "portable SHA-256 matches a standard vector",
);
const humanTask = create(s, "交通攻略");
assert.equal(command(s, "claim", { executor: "codex" }, humanTask, service).code, "HUMAN_TASK");
const first = submit(s, humanTask);
assert.equal(s.collaboration!.tasks[humanTask].status, "in_review");
assert.equal(s.tasks[humanTask].completion, null, "submission alone never completes a task");
assert.equal(
  command(
    s,
    "review",
    { submissionId: first, verdict: "accepted", note: "尚未核对", checks: [true, false] },
    humanTask,
  ).code,
  "CRITERIA_NOT_MET",
);
accept(s, humanTask, first);
assert(s.tasks[humanTask].completion);
assert.equal(
  Object.keys(s.collaboration!.runs).length,
  0,
  "manual task generates no AI run, session, or token bill",
);
const immutable = JSON.stringify({
  specs: s.collaboration!.specs,
  reviews: s.collaboration!.reviews,
  artifacts: s.collaboration!.artifacts,
});
const source = s.collaboration!.tasks[humanTask].acceptedArtifactId!;
const aiTask = create(s, "交通综合行程", "agent", [humanTask]);
assert(command(s, "record_decision", { text: "不坐红眼航班", kind: "rejection" }, aiTask).ok);
const claimed = command(s, "claim", { executor: "codex", runId: "run-one" }, aiTask, service);
assert(claimed.ok, claimed.message);
assert(claimed.context!.prompt.includes("不坐红眼航班"));
assert.deepEqual(
  claimed.context!.sources.map((x) => x.id),
  [source],
);
const run = s.collaboration!.runs["run-one"];
const runtime: CollaborationActor = { kind: "runtime", runId: run.id, claimEpoch: run.claimEpoch };
assert.equal(
  command(s, "record_decision", { text: "可以忽略用户否决", kind: "constraint" }, aiTask, runtime)
    .code,
  "FORBIDDEN",
);
const runningVersion = s.collaboration!.tasks[aiTask].version;
assert(
  command(s, "run_status", { runId: run.id, status: "running", actualTokens: 1 }, aiTask, service)
    .ok,
);
assert.equal(
  s.collaboration!.tasks[aiTask].version,
  runningVersion,
  "same running status/usage does not change task version",
);
assert(
  command(
    s,
    "checkpoint",
    { runId: run.id, completed: ["已检查交通"], remaining: ["汇总住宿"], note: "需要交接" },
    aiTask,
    runtime,
  ).ok,
);
const aiSubmission = command(
  s,
  "submit",
  { title: "综合成果", body: "已核对交通与住宿，避开红眼航班。", sourceIds: [source] },
  aiTask,
  runtime,
);
assert(aiSubmission.ok, aiSubmission.message);
assert(
  command(
    s,
    "run_status",
    { runId: run.id, status: "succeeded", actualTokens: 120 },
    aiTask,
    service,
  ).ok,
);
assert.equal(
  s.collaboration!.tasks[aiTask].status,
  "in_review",
  "provider turn end cannot complete or regress candidate review",
);
accept(s, aiTask, aiSubmission.resourceId!);
assert.equal(
  JSON.stringify({
    specs: s.collaboration!.specs.slice(0, 1),
    reviews: s.collaboration!.reviews.slice(0, 1),
    artifacts: s.collaboration!.artifacts.slice(0, 1),
  }),
  immutable,
  "later work never edits original evidence records",
);
assert(command(s, "mark_stale", { artifactId: source, reason: "交通时刻已变更" }).ok);
assert(
  s.collaboration!.tasks[aiTask].requiresRevalidation,
  "source changes propagate transitively to accepted consumers",
);
assert.equal(
  s.collaboration!.tasks[aiTask].status,
  "done",
  "historical acceptance stays recorded while current validity is stale",
);
const next = create(s, "后续交通", "agent");
assert.throws(
  () => buildContextPackage(s, next, { sourceIds: [source] }),
  (error: unknown) => (error as { code: string }).code === "SOURCE_STALE",
  "explicit stale evidence fails closed instead of silently disappearing",
);

// An independent review sees only the pinned candidate; replacing it invalidates the opinion.
const reviewProject = project(),
  subject = create(reviewProject, "待复核交付"),
  candidate = submit(reviewProject, subject),
  reviewTask = create(reviewProject, "独立检查", "agent");
const reviewClaim = command(
  reviewProject,
  "claim",
  { executor: "codex", runId: "review-run", purpose: "review", reviewSubmissionId: candidate },
  reviewTask,
  service,
);
assert(reviewClaim.ok, reviewClaim.message);
assert.equal(reviewClaim.context!.sources[0].freshness, "candidate");
const opinion = command(
  reviewProject,
  "submit",
  { title: "复核意见", body: "检查完整候选后发现所有验收项均已覆盖。" },
  reviewTask,
  { kind: "runtime", runId: "review-run", claimEpoch: reviewClaim.context!.claimEpoch },
);
assert(opinion.ok, opinion.message);
const opinionArtifact = reviewProject.collaboration!.artifacts.find(
  (x) =>
    x.id ===
    reviewProject.collaboration!.submissions.find((x) => x.id === opinion.resourceId)!.artifactId,
)!;
assert.equal(
  opinionArtifact.sourceIds.length,
  1,
  "candidate input provenance is recorded even if the model omits citations",
);
accept(reviewProject, reviewTask, opinion.resourceId!);
assert(
  command(
    reviewProject,
    "review",
    {
      submissionId: candidate,
      verdict: "needs_changes",
      note: "用户要求补充日期证据",
      checks: [true, false],
    },
    subject,
  ).ok,
);
assert.equal(reviewProject.collaboration!.freshness[opinionArtifact.id], "stale");
assert(reviewProject.collaboration!.tasks[reviewTask].requiresRevalidation);

// Chinese retrieval finds related accepted Thai work without explicit dependency edges.
const travel = project();
const thai: string[] = [];
for (const part of ["交通", "住宿", "游玩", "美食"]) {
  const key = create(travel, "泰国" + part + "攻略");
  const delivery = submit(travel, key);
  accept(travel, key, delivery);
  thai.push(travel.collaboration!.tasks[key].acceptedArtifactId!);
}
const japan = create(travel, "日本交通攻略"),
  japanDelivery = submit(travel, japan);
accept(travel, japan, japanDelivery);
const planning = create(travel, "规划泰国旅行", "agent"),
  retrieved = buildContextPackage(travel, planning);
assert.deepEqual(
  new Set(retrieved.sources.map((x) => x.id)),
  new Set(thai),
  "CJK bigram/trigram ranking retrieves four Thai artifacts and excludes Japan",
);

// CAS, replay and rollback do not duplicate tasks or partially publish state.
const p = project();
const made: CollaborationCommand = {
  projectId: p.project.id,
  idempotencyKey: "create-once",
  type: "create_task",
  payload: { title: "住宿攻略", goal: "比较住宿", criteria: ["预算内"], owner: "agent" },
};
const one = applyCollaboration(p, made, human);
assert(one.ok);
assert.equal(applyCollaboration(p, made, human).replayed, true);
assert.equal(Object.keys(p.tasks).length, 1);
assert.equal(
  applyCollaboration(p, { ...made, payload: { ...made.payload, title: "不同请求" } }, human).code,
  "IDEMPOTENCY_CONFLICT",
);
const before = JSON.stringify(p);
assert.equal(
  command(
    p,
    "revise_task",
    { goal: "新目标", criteria: ["新验收"], reason: "测试" },
    one.resourceId,
    human,
    { expectedVersion: 0 },
  ).code,
  "VERSION_CONFLICT",
);
assert.equal(JSON.stringify(p), before);
const second = create(p, "预算检查", "agent");
const dagBefore = JSON.stringify(p);
assert(command(p, "set_dependencies", { dependencies: [second] }, one.resourceId).ok);
const beforeCycle = JSON.stringify(p);
assert.equal(
  command(p, "set_dependencies", { dependencies: [one.resourceId] }, second).code,
  "DEPENDENCY_CYCLE",
);
assert.equal(JSON.stringify(p), beforeCycle);
assert.notEqual(JSON.stringify(p), dagBefore);
assert.equal(
  command(p, "propose_plan", {
    tasks: [
      {
        key: "a",
        title: "循环",
        goal: "循环",
        criteria: ["检查"],
        owner: "agent",
        dependsOn: ["a"],
      },
    ],
  }).code,
  "DEPENDENCY_CYCLE",
);
const proposal = command(p, "propose_plan", {
  tasks: [
    {
      key: "hotel",
      title: "酒店",
      goal: "确认酒店",
      criteria: ["可取消"],
      owner: "me",
      dependsOn: [],
    },
    {
      key: "book",
      title: "预订",
      goal: "核对订单",
      criteria: ["核对日期"],
      owner: "me",
      dependsOn: ["hotel"],
    },
  ],
});
assert(proposal.ok);
const adopted = command(p, "adopt_plan", { proposalId: proposal.resourceId });
assert(adopted.ok);
assert.equal(adopted.createdTaskIds!.length, 2);
assert.equal(p.collaboration!.tasks[adopted.createdTaskIds![1]].status, "blocked");
assert.equal(
  command(p, "adopt_plan", { proposalId: proposal.resourceId }).code,
  "INVALID_STATE",
  "separate retries cannot duplicate an adopted plan",
);

// Provider usage remains visible without gating new claims or pausing an active run.
const budget = project();
assert(command(budget, "set_policy", {
  contextTokens: 1000,
  runTokens: 5000,
  projectTokens: 5000,
  maxParallel: 2,
}).ok);
const b1 = create(budget, "用量记录 A", "agent"),
  b2 = create(budget, "用量记录 B", "agent");
assert(command(budget, "claim", { executor: "codex", runId: "usage-run" }, b1, service).ok);
assert(command(
  budget, "run_status", { runId: "usage-run", status: "running", actualTokens: 5100 }, b1, service,
).ok);
assert.equal(budget.collaboration!.runs["usage-run"].status, "running");
assert.equal(budget.collaboration!.tasks[b1].status, "running");
assert.equal(deriveBlackboard(budget).spentTokens, 5100);
assert(command(budget, "claim", { executor: "codex" }, b2, service).ok);

// Requirement changes fence an older run and retain immutable input, even when it reports late.
const fenced = project(),
  f = create(fenced, "待修改的 AI 任务", "agent");
const fc = command(fenced, "claim", { executor: "codex", runId: "old-run" }, f, service);
assert(fc.ok);
const pinned = JSON.stringify(fenced.collaboration!.contextPackages[0]);
command(
  fenced,
  "run_status",
  { runId: "old-run", status: "running", actualTokens: 10 },
  f,
  service,
);
const oldActor: CollaborationActor = {
  kind: "runtime",
  runId: "old-run",
  claimEpoch: fc.context!.claimEpoch,
};
assert(
  command(
    fenced,
    "revise_task",
    { goal: "变更后目标", criteria: ["新的验收"], reason: "用户修改需求" },
    f,
  ).ok,
);
assert.equal(
  deriveBlackboard(fenced).reservedTokens,
  0,
  "locally fencing a run never invents unused token reservations",
);
assert.equal(
  command(fenced, "submit", { title: "过期成果", body: "按照旧要求完成" }, f, oldActor).code,
  "STALE_CLAIM",
);
assert(
  command(
    fenced,
    "run_status",
    { runId: "old-run", status: "succeeded", actualTokens: 800 },
    f,
    service,
  ).ok,
);
assert.equal(
  fenced.collaboration!.tasks[f].status,
  "ready",
  "late billing cannot move current task state",
);
assert.equal(JSON.stringify(fenced.collaboration!.contextPackages[0]), pinned);
assert.equal(fenced.collaboration!.runs["old-run"].actualTokens, 800);

// Unknown side effects block automatic replacement runs, and no command deletes external data.
const ext = project(),
  e = create(ext, "订房请求", "agent");
command(ext, "claim", { executor: "codex", runId: "ext-run" }, e, service);
const proposedAction = command(
  ext,
  "external_action",
  { operation: "酒店下单", parameters: "候选酒店与已确认日期" },
  e,
);
assert(proposedAction.ok);
for (const status of ["authorized", "dispatched", "unknown"])
  assert(
    command(ext, "resolve_external_action", {
      actionId: proposedAction.resourceId,
      status,
      receipt: "用户或源端核对记录",
    }).ok,
  );
command(ext, "run_status", { runId: "ext-run", status: "lost" }, e, service);
assert.equal(
  command(ext, "claim", { executor: "codex" }, e, service).code,
  "EXTERNAL_STATE_UNKNOWN",
);
assert(command(ext, "archive_task", { reason: "停止规划但保留对账" }, e).ok);
assert(ext.tasks[e]);
assert(ext.collaboration!.runs["ext-run"]);

// Verified reconciliation revives only the same lost claim, never a fenced old requirement.
const recovered = project(),
  recoverTask = create(recovered, "恢复失联运行", "agent");
const recovery = command(
  recovered,
  "claim",
  { executor: "codex", runId: "recover-run" },
  recoverTask,
  service,
);
assert(recovery.ok);
command(recovered, "run_status", { runId: "recover-run", status: "lost" }, recoverTask, service);
assert.equal(
  command(
    recovered,
    "run_status",
    { runId: "recover-run", status: "running", reconciled: true },
    recoverTask,
    { kind: "runtime", runId: "recover-run", claimEpoch: recovery.context!.claimEpoch },
  ).code,
  "FORBIDDEN",
);
assert(
  command(
    recovered,
    "run_status",
    { runId: "recover-run", status: "running", reconciled: true },
    recoverTask,
    service,
  ).ok,
);
assert.equal(recovered.collaboration!.runs["recover-run"].status, "running");
assert(
  command(
    recovered,
    "submit",
    { title: "已恢复交付", body: "已核对来源确认同一次运行" },
    recoverTask,
    { kind: "runtime", runId: "recover-run", claimEpoch: recovery.context!.claimEpoch },
  ).ok,
);

// Critical user conditions are sent in full, independent of legacy app caps.
const large = project(),
  lt = create(large, "中文上下文", "agent");
command(large, "set_policy", { contextTokens: 256, runTokens: 1000 });
command(
  large,
  "record_decision",
  { text: "用户已明确否决不可覆盖".repeat(80), kind: "rejection" },
  lt,
);
const largeClaim = command(large, "claim", { executor: "codex" }, lt, service);
assert(largeClaim.ok);
assert(largeClaim.context!.prompt.includes("用户已明确否决不可覆盖".repeat(80)));
assert.equal(largeClaim.context!.tokenBudget, null);
const legacy = project();
legacy.tasks.old = {
  id: "old",
  title: "历史完成",
  owner: "me",
  createdAt: "2025-01-01",
  sessionIds: [],
  completion: { reason: "all_archived", at: "2025-01-01" },
  manualLock: false,
};
ensureCollaboration(legacy);
assert(legacy.collaboration!.tasks.old.legacyCompletion);
assert.equal(legacy.collaboration!.reviews.length, 0);
assert.equal(legacy.tasks.old.completion!.reason, "all_archived");
const exported = exportCollaboration(s);
assert.match(exported.ledger, /source_seq/);
assert.equal(JSON.parse(exported.json).generated, true);
assert.match(exported.blackboard, /待验收/);

// The same repository transaction owns both legacy UI projection and collaboration facts.
(async () => {
  const memory = new Map<string, string>();
  let failSave = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failSave) throw new Error("disk full");
        memory.set(k, v);
      },
    },
  });
  const repo = new LocalWorkdeckDataSource();
  const a = (await repo.createProject({ name: "A" })).projectId!;
  const cr = await repo.collaborate({
    projectId: a,
    idempotencyKey: "task",
    type: "create_task",
    payload: { title: "人工任务", goal: "核对订单", criteria: ["订单号正确"], owner: "me" },
  });
  assert(cr.ok);
  const snap = await repo.load();
  assert(snap.tasks[cr.resourceId!]);
  assert(snap.collaboration!.tasks[cr.resourceId!]);
  await assert.rejects(repo.completeTask(cr.resourceId!), /先提交成果/);
  failSave = true;
  await assert.rejects(
    repo.collaborate({
      projectId: a,
      idempotencyKey: "fail",
      type: "submit",
      taskId: cr.resourceId,
      expectedVersion: 1,
      payload: { title: "订单", body: "已核对 123" },
    }),
    /未保存/,
  );
  failSave = false;
  assert.deepEqual(
    await repo.load(),
    snap,
    "failed persistence rolls back candidate plus legacy view and receipt together",
  );
  const b = (await repo.createProject({ name: "B" })).projectId!;
  assert(
    (
      await repo.collaborate({
        projectId: a,
        idempotencyKey: "background",
        type: "submit",
        taskId: cr.resourceId,
        expectedVersion: 1,
        payload: { title: "订单", body: "核对 123" },
      })
    ).ok,
  );
  assert.equal((await repo.load()).project.id, b);
  assert.equal(
    (await repo.listProjects()).find((x) => x.project.id === a)!.collaboration!.submissions.length,
    1,
  );
  const ai = await repo.collaborate({
    projectId: b,
    idempotencyKey: "legacy-guard",
    type: "create_task",
    payload: { title: "旧入口任务", goal: "旧入口任务", criteria: ["有证据"], owner: "agent" },
  });
  assert(ai.ok);
  repo.mutateRuntimeProject(b, (d) => {
    assert(
      command(d, "claim", { executor: "codex", runId: "legacy-run" }, ai.resourceId, service).ok,
    );
  });
  const originalContext = JSON.stringify((await repo.load()).collaboration!.contextPackages);
  await repo.updateTaskTitle(ai.resourceId!, "改动后的范围");
  const renamed = await repo.load();
  assert.equal(renamed.collaboration!.runs["legacy-run"].status, "cancelled");
  assert.equal(renamed.collaboration!.tasks[ai.resourceId!].specRevision, 2);
  assert.equal(
    JSON.stringify(renamed.collaboration!.contextPackages),
    originalContext,
    "legacy rename fences but never rewrites dispatched context",
  );
  const createdIdea = await repo.createIdea("预算规划");
  const beforePlan = await repo.load();
  const line = beforePlan.ideaPlans![createdIdea.planId].draft.sections.flatMap(
    (section) => section.lines,
  )[0];
  await repo.editPlanLine(createdIdea.planId, line.id, {
    text: "预算不超过 5000 元",
    state: "fixed",
  });
  const edited = await repo.load();
  assert(
    edited.collaboration!.decisions.some(
      (decision) => decision.text === "预算不超过 5000 元" && decision.authority === "confirmed",
    ),
  );
  await repo.editPlanLine(createdIdea.planId, line.id, { state: "open" });
  const withdrawn = await repo.load();
  assert.equal(
    withdrawn.collaboration!.decisions.at(-1)!.authority,
    "withdrawn",
    "legacy condition withdrawal appends a revision",
  );
  const block = withdrawn.journal.blocks.find(
    (x) => x.kind === "task" && x.taskId === ai.resourceId,
  )!;
  await repo.deleteBlock(block.id);
  assert(
    (await repo.load()).collaboration!.tasks[ai.resourceId!],
    "hiding journal block never erases ledger task",
  );
  console.log(
    "collaboration: immutable evidence, explicit human review, no fake runs, CAS/idempotency/DAG, fixed context, conservative budgets, source invalidation, fencing, side-effect guards, project routing and persistence rollback passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
