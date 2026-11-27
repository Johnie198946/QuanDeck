import { applyDeliveryChange } from "../src/data/deliveryChanges";
import { previewDeliveryPublication, publishDeliveryIn } from "../src/data/deliveryPublication";
import assert from "node:assert/strict";
import { createEmptySnapshot } from "../src/data/projectStorage";
import {
  applyCollaboration,
  buildContextPackage,
  isCollaborationArtifactFresh,
  type CollaborationCommandType,
  type CollaborationActor,
} from "../src/data/collaboration";
import {
  suggestSharedDecisions,
  listSharedDecisions,
  sharedDecisionPins,
} from "../src/data/sharedDecisions";
import { listIntegrationSources } from "../src/data/resultIntegration";
import type { Snapshot } from "../src/data/types";

const s = createEmptySnapshot({ id: "test-shared", name: "协作测试" });
let sequence = 0;
const human: CollaborationActor = { kind: "human" };
function command(
  type: CollaborationCommandType,
  payload: Record<string, unknown>,
  key?: string,
  actor: CollaborationActor = human,
) {
  return applyCollaboration(
    s,
    {
      projectId: s.project.id,
      type,
      payload,
      taskId: key,
      expectedVersion: key ? s.collaboration!.tasks[key]?.version : undefined,
      idempotencyKey: "receipt-" + ++sequence,
    },
    actor,
  );
}
function create(title: string, dependencies: string[] = []) {
  const r = command("create_task", { title, owner: "agent", criteria: ["完成"], dependencies });
  assert(r.ok, r.message);
  return r.resourceId!;
}
function submit(key: string, body: string, sourceIds: string[] = []) {
  const r = command("submit", { title: "候选", body, sourceIds }, key);
  assert(r.ok, r.message);
  return r.resourceId!;
}
function review(key: string, submissionId: string) {
  return command("review", { submissionId, checks: [true], verdict: "accepted" }, key);
}
const mutate = (action: string, payload: Record<string, unknown>) =>
  command("shared_decision", { action, ...payload });
const current = (id: string) => listSharedDecisions(s).find((d) => d.id === id)!;

assert.deepEqual(listSharedDecisions(s), []);
const west = create("规划大阪到京都的住宿"),
  east = create("规划京都站到岚山的住宿");
const unrelated = create("撰写音乐会节目单");
const hotel = suggestSharedDecisions(s, west)[0];
assert.deepEqual(hotel.taskKeys, [west, east].sort());
assert.equal(hotel.scope, "京都");
assert(buildContextPackage(s, west).prompt.includes("可能与任务"));
assert(!buildContextPackage(s, unrelated).prompt.includes("可能与任务"));
assert(review(unrelated, submit(unrelated, "节目单")).ok);
assert.deepEqual(
  listSharedDecisions(s),
  [],
  "lexical hints do not link or block independently assigned work",
);

const room = mutate("link", {
  title: hotel.title,
  scope: "一家三人 12 月 1 日晚",
  taskKeys: hotel.taskKeys,
  suggestionId: hotel.id,
});
assert(room.ok, room.message);
const id = room.resourceId!;
const claim = command("claim", { executor: "codex", runId: "run-west" }, west, { kind: "service" });
assert(claim.ok, claim.message);
const runtime: CollaborationActor = {
  kind: "runtime",
  runId: "run-west",
  claimEpoch: claim.context!.claimEpoch,
};
assert(claim.context!.prompt.includes(id));
const report = {
  completed: [],
  remaining: [],
  note: "查到酒店",
  decisionOptions: [{ decisionId: id, text: "京都站甲酒店" }],
};
assert(command("checkpoint", report, west, runtime).ok);
assert.equal(current(id).options[0].taskKey, west);
assert.equal(current(id).options[0].origin, "task");
assert.equal(
  command("checkpoint", report, east, runtime).code,
  "STALE_CLAIM",
  "task A cannot submit for B",
);
assert.equal(
  command("shared_decision", { action: "confirm" }, undefined, runtime).code,
  "FORBIDDEN",
);
const checkpointCount = s.collaboration!.checkpoints.length;
assert.equal(
  command(
    "checkpoint",
    { ...report, decisionOptions: [{ decisionId: id, text: "伪造作者", taskKey: east }] },
    west,
    runtime,
  ).code,
  "SCHEMA_INVALID",
);
assert.equal(
  s.collaboration!.checkpoints.length,
  checkpointCount,
  "malformed candidates roll back the whole checkpoint",
);
assert.equal(
  command(
    "checkpoint",
    { ...report, decisionOptions: [{ decisionId: "another-project", text: "其他" }] },
    west,
    runtime,
  ).code,
  "SCOPE_MISMATCH",
);
assert.equal(
  mutate("propose", { decisionId: id, expectedRevision: 0, text: "过期选项" }).code,
  "VERSION_CONFLICT",
);
assert(
  mutate("propose", {
    decisionId: id,
    expectedRevision: current(id).revision,
    text: "岚山乙酒店",
    taskKey: east,
  }).ok,
);
assert.equal(current(id).options[1].origin, "human");
const firstAccepted = () =>
  mutate("confirm", {
    decisionId: id,
    expectedRevision: current(id).revision,
    optionId: current(id).options[0].id,
    reason: "列车抵达得晚",
  });
const candidate = submit(east, "岚山资料和两家酒店");
assert.equal(review(east, candidate).code, "SHARED_DECISION_PENDING");
assert(firstAccepted().ok);
assert.equal(review(east, candidate).code, "SHARED_DECISION_CHANGED");
assert.equal(
  command("submit", { title: "旧执行", body: "未读取已选酒店" }, west, runtime).code,
  "SHARED_DECISION_CHANGED",
);
assert.equal(buildContextPackage(s, east).sharedDecisionPins?.[0].id, id);
assert(buildContextPackage(s, east).prompt.includes("用户已确认 京都站甲酒店"));
assert(review(east, submit(east, "按甲酒店核对首晚行程")).ok);
const oldEast = s.collaboration!.tasks[east].acceptedArtifactId!;
const downstream = create("计算站前换乘时间", [east]);
assert(review(downstream, submit(downstream, "由酒店出发", [oldEast])).ok);
const oldDownstream = s.collaboration!.tasks[downstream].acceptedArtifactId!;
const unrelatedArtifact = s.collaboration!.tasks[unrelated].acceptedArtifactId!;
const revision = current(id).revision,
  oldPin = sharedDecisionPins(s, east);
assert(
  mutate("propose", { decisionId: id, expectedRevision: revision, text: "研究第三个备选" }).ok,
);
assert.deepEqual(
  sharedDecisionPins(s, east),
  oldPin,
  "another suggestion does not replace the effective decision",
);
assert(isCollaborationArtifactFresh(s, oldEast));
const change = {
  decisionId: id,
  expectedRevision: current(id).revision,
  optionId: current(id).options[1].id,
  reason: "变更到达站",
};
const cmd = {
  projectId: s.project.id,
  type: "shared_decision" as const,
  idempotencyKey: "same-confirm",
  payload: { action: "confirm", ...change },
};
assert(applyCollaboration(s, cmd, human).ok);
assert(applyCollaboration(s, cmd, human).replayed);
assert.equal(current(id).history.length, 2);
assert.equal(mutate("confirm", change).code, "VERSION_CONFLICT");
for (const stale of [oldEast, oldDownstream]) {
  assert(!isCollaborationArtifactFresh(s, stale));
  assert.equal(
    listIntegrationSources(s).find((row) => row.artifactId === stale)?.eligible,
    false,
    "obsolete choices cannot be republished",
  );
}
assert(isCollaborationArtifactFresh(s, unrelatedArtifact));
assert.equal(s.collaboration!.tasks[east].requiresRevalidation, true);
assert.deepEqual(listSharedDecisions(JSON.parse(JSON.stringify(s)) as Snapshot, east), [
  current(id),
]);
assert(
  mutate("unlink", { decisionId: id, expectedRevision: current(id).revision, taskKeys: [west] }).ok,
);
assert.deepEqual(listSharedDecisions(s), []);

const nov1 = create("京都站 11月1日 住宿"),
  nov2 = create("京都站 11月2日 酒店");
assert(
  !suggestSharedDecisions(s, nov1).some((h) => h.taskKeys.includes(nov2)),
  "different explicit nights are not merged",
);
const verA = create("更新版本到 0.30.4"),
  verB = create("发布版本 0.30.5");
const v = suggestSharedDecisions(s, verA).find((x) => x.taskKeys.includes(verB))!;
const version = mutate("link", {
  title: v.title,
  scope: "QuanDeck 稳定版",
  suggestionId: v.id,
  taskKeys: v.taskKeys,
});
assert(version.ok, version.message);
assert.deepEqual(
  current(version.resourceId!)
    .options.map((o) => o.text)
    .sort(),
  ["0.30.4", "0.30.5"],
);
assert(!current(version.resourceId!).selectedOptionId, "higher SemVer never wins automatically");
const docA = create("撰写《安装手册》部署章节"),
  docB = create("修改《安装手册》部署章节");
const doc = suggestSharedDecisions(s, docA).find((h) => h.taskKeys.includes(docB))!;
assert(doc);
assert(mutate("dismiss", { suggestionId: doc.id, taskKeys: doc.taskKeys }).ok);
assert(!suggestSharedDecisions(s, docA).some((x) => x.id === doc.id));

// The current delivery-map publication entry point checks explicitly linked decisions,
// including accepted work that existed before the user discovered the overlap.
{
  const key = create("定稿部署文档"),
    partner = create("核对部署版本");
  const planId = "delivery:" + key;
  const change = applyDeliveryChange(s, {
    planId,
    taskId: key,
    expectedVersion: 0,
    idempotencyKey: "register-manual",
    reason: "指定交付文档",
    operations: [
      {
        type: "add",
        slot: {
          id: "manual",
          title: "部署手册",
          taskKey: key,
          contract: {
            revision: 1,
            kind: "text",
            format: "markdown",
            required: true,
            criteria: ["完整"],
          },
        },
      },
    ],
  });
  assert(change.ok, change.message);
  const slot = s.collaboration!.goalPlans![planId].at(-1)!.slots[0];
  const submitted = command(
    "submit",
    {
      title: "部署说明",
      body: "部署文档",
      deliveryItems: [{ slotId: slot.id, contractRevision: 1, body: "完整说明" }],
    },
    key,
  );
  assert(submitted.ok, submitted.message);
  assert(
    command(
      "review",
      {
        submissionId: submitted.resourceId,
        verdict: "accepted",
        checks: [true],
        deliveryChecks: { [slot.id]: [true] },
      },
      key,
    ).ok,
  );
  const old = previewDeliveryPublication(s, { taskId: key });
  assert(old.canPublish, old.blockers.join("；"));
  const record = mutate("link", {
    title: "采用的部署版本",
    scope: "同一安装手册",
    taskKeys: [key, partner],
  });
  assert(record.ok);
  const pending = previewDeliveryPublication(s, { taskId: key });
  assert(!pending.canPublish);
  assert(pending.blockers.some((b) => b.includes("采用的部署版本")));
  assert.equal(
    publishDeliveryIn(s, {
      scope: { taskId: key },
      idempotencyKey: "old-release",
      expectedFingerprint: old.fingerprint,
      reviewed: true,
    }).code,
    "PUBLICATION_BLOCKED",
  );
  assert(
    mutate("unlink", {
      decisionId: record.resourceId,
      expectedRevision: current(record.resourceId!).revision,
      taskKeys: [key],
    }).ok,
  );
  assert(
    previewDeliveryPublication(s, { taskId: key }).canPublish,
    "removing an unconfirmed scope restores the original accepted output",
  );
}

async function exercisePublicRuntime() {
  const { LocalWorkdeckDataSource } = await import("../src/data/repository");
  const { createRuntimeDataSource } = await import("../src/data/runtimeDataSource");
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
    },
  });
  const records: import("../src/data/runtimeContracts").RuntimeRunRecord[] = [];
  let receive = (_event: import("../src/data/runtimeContracts").RuntimeEvent) => {};
  const driver: import("../src/data/runtimeContracts").RuntimeDriver = {
    subscribe(fn) {
      receive = fn;
      return () => {};
    },
    scan: async () => [],
    listRuns: () => records,
    control: async () => {},
    async run(input) {
      const record = {
        ...input,
        runId: "provider-run",
        sessionId: "provider-source",
        acceptedAt: new Date().toISOString(),
        acceptance: "acknowledged" as const,
        status: "queued" as const,
        events: [],
      };
      records.push(record);
      return record;
    },
  };
  const api = createRuntimeDataSource(new LocalWorkdeckDataSource(), driver);
  const projectId = (await api.createProject({ name: "共同决定入库" })).projectId!;
  await api.registerAgent({ id: "codex", name: "Codex", short: "C", color: "#123456" });
  await api.bindRuntimeConnection("codex", {
    tool: "codex",
    connectionId: "shared-test",
    projectPath: "/synthetic-test",
  });
  const task = async (title: string) =>
    (await api.createTaskWithAttachments(title, [], projectId)).taskId!;
  const a = await task("京都站附近的酒店"),
    b = await task("安排大阪到京都的住宿");
  const linked = await api.collaborate({
    projectId,
    idempotencyKey: "ui-link",
    type: "shared_decision",
    payload: { action: "link", title: "住宿", scope: "同一晚", taskKeys: [a, b] },
  });
  assert(linked.ok, linked.message);
  const run = await api.dispatch(a, "codex");
  assert(run.ok, run.message);
  const record = records[0],
    dispatched = await api.load(),
    session = dispatched.sessions[dispatched.tasks[a].sessionIds[0]];
  assert(record.prompt.includes(linked.resourceId!));
  const envelope = {
    schemaVersion: "quandeck.runtime.v1",
    idempotencyKey: "first-option",
    binding: session.runtime!.collaboration!,
    kind: "result",
    payload: {
      title: "住宿调查",
      body: "甲酒店邻近出口",
      decisionOptions: [{ decisionId: linked.resourceId, text: "甲酒店" }],
    },
  };
  receive({
    id: "result",
    sequence: 1,
    runId: record.runId,
    sessionId: record.sessionId,
    at: new Date(Date.now() + 1000).toISOString(),
    status: "done",
    submission: envelope,
  });
  await api.flushRuntime();
  const saved = await api.load();
  assert.equal(saved.sessions[session.id].runtime!.submissionReceipts!.at(-1)!.ok, true);
  const decision = listSharedDecisions(saved)[0];
  assert.equal(decision.options[0].origin, "task");
  assert.equal(decision.options[0].taskKey, a);
  assert.equal(decision.selectedOptionId, undefined);
  const reopened = await new LocalWorkdeckDataSource().load();
  assert.deepEqual(listSharedDecisions(reopened)[0], decision);
}
exercisePublicRuntime().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
