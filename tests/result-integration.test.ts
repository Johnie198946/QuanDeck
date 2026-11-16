import assert from "node:assert/strict";
import { applyCollaboration } from "../src/data/collaboration";
import {
  applyIntegration,
  ensureIntegration,
  inspectIntegration,
  inspectIntegrationVersion,
  integrationMarkdown,
  listIntegrationSources,
  type IntegrationCommand,
  type IntegrationSection,
} from "../src/data/resultIntegration";
import { createEmptySnapshot } from "../src/data/projectStorage";
import type { Snapshot } from "../src/data/types";
let serial = 0;
const project = () => createEmptySnapshot({ id: `project-${++serial}`, name: "泰国之旅" });
function domain(
  s: Snapshot,
  type: Parameters<typeof applyCollaboration>[1]["type"],
  payload: Record<string, unknown>,
  taskId?: string,
) {
  const result = applyCollaboration(
    s,
    {
      projectId: s.project.id,
      idempotencyKey: `domain-${++serial}`,
      type,
      taskId,
      expectedVersion: taskId ? s.collaboration?.tasks[taskId]?.version : undefined,
      payload,
    },
    { kind: "human" },
  );
  assert(result.ok, result.message);
  return result;
}
function source(s: Snapshot, title: string, body: string) {
  const taskId = domain(s, "create_task", {
    title,
    goal: title,
    owner: "me",
    criteria: ["来源已核对"],
  }).resourceId!;
  const submissionId = domain(s, "submit", { title, body }, taskId).resourceId!;
  domain(
    s,
    "review",
    { submissionId, verdict: "accepted", note: "核对完成", checks: [true] },
    taskId,
  );
  return s.collaboration!.tasks[taskId].acceptedArtifactId!;
}
function command(
  s: Snapshot,
  type: IntegrationCommand["type"],
  payload: IntegrationCommand["payload"],
  draftId?: string,
  overrides: Partial<IntegrationCommand> = {},
) {
  return applyIntegration(s, {
    projectId: s.project.id,
    idempotencyKey: `integration-${++serial}`,
    type,
    draftId,
    expectedRevision: draftId ? ensureIntegration(s).drafts[draftId]?.revision : undefined,
    payload,
    ...overrides,
  });
}
function create(s: Snapshot, sourceIds: string[]) {
  const r = command(s, "create", { title: "泰国完整出行攻略", sourceIds });
  assert(r.ok, r.message);
  return r.draftId!;
}
function edit(
  s: Snapshot,
  draftId: string,
  change: (sections: IntegrationSection[]) => void,
  title?: string,
) {
  const inspection = inspectIntegration(s, draftId),
    sections = structuredClone(inspection.revision.sections);
  change(sections);
  const r = command(
    s,
    "save",
    {
      title: title ?? inspection.revision.title,
      sourceIds: inspection.revision.sourcePins.map((p) => p.artifactId),
      sections,
    },
    draftId,
  );
  assert(r.ok, r.message);
}
function publish(s: Snapshot, draftId: string) {
  const r = command(
    s,
    "publish",
    { expectedBundleVersion: inspectIntegration(s, draftId).bundle.version, reviewed: true },
    draftId,
  );
  assert(r.ok, r.message);
  return r.versionId!;
}
function branch(s: Snapshot, draftId: string) {
  const r = command(s, "create", { bundleId: inspectIntegration(s, draftId).bundle.id });
  assert(r.ok, r.message);
  return r.draftId!;
}
{
  const s = project(),
    a = source(s, "第1天曼谷", "上午寺庙，下午河边；原文约束不得丢失"),
    b = source(s, "第2天清迈", "酒店和交通已核对");
  const originals = JSON.stringify(s.collaboration!.artifacts),
    draft = create(s, [a, b]);
  assert.equal(listIntegrationSources(s).filter((x) => x.eligible).length, 2);
  assert.equal(inspectIntegration(s, draft).coveredSources, 2);
  assert.equal(
    inspectIntegration(s, draft).revision.sourcePins[0].sourceSessionId,
    undefined,
    "human work never inherits unrelated agent chats",
  );
  edit(s, draft, (sections) => {
    sections[0].schedule = { date: "2026-12-01" };
    sections[1].schedule = { date: "2026-12-02" };
  });
  assert(inspectIntegration(s, draft).canPublish);
  assert.equal(
    command(s, "publish", { expectedBundleVersion: 0 }, draft).code,
    "HUMAN_REVIEW_REQUIRED",
  );
  const request: IntegrationCommand = {
    projectId: s.project.id,
    idempotencyKey: "fixed-publication",
    type: "publish",
    draftId: draft,
    expectedRevision: ensureIntegration(s).drafts[draft].revision,
    payload: { expectedBundleVersion: 0, reviewed: true },
  };
  const first = applyIntegration(s, request);
  assert(first.ok);
  assert.equal(applyIntegration(s, request).replayed, true);
  assert.equal(
    applyIntegration(s, { ...request, payload: { ...request.payload, reviewNote: "different" } })
      .code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(command(s, "save", {}, draft).code, "DRAFT_CLOSED");
  assert.equal(
    JSON.stringify(s.collaboration!.artifacts),
    originals,
    "integration never rewrites source artifacts",
  );
  assert(integrationMarkdown(s, first.versionId!).includes("原文约束不得丢失"));
  assert(integrationMarkdown(s, first.versionId!).includes("2026-12-01"));
  assert(
    !integrationMarkdown(s, first.versionId!).includes("09:00"),
    "date-only never invents a clock",
  );
}
{
  const s = project(),
    a = source(s, "交通", "交通原文"),
    b = source(s, "酒店", "酒店原文");
  const original = create(s, [a, b]),
    v1 = publish(s, original),
    history = JSON.stringify(ensureIntegration(s).versions[0]);
  const left = branch(s, original),
    right = branch(s, original);
  edit(s, left, (sections) => {
    sections[0].body += "，左分支修改";
  });
  edit(s, right, (sections) => {
    sections[1].body += "，右分支修改";
  });
  publish(s, left);
  const rejected = command(s, "publish", { expectedBundleVersion: 2, reviewed: true }, right);
  assert.equal(rejected.code, "INTEGRATION_BLOCKED");
  assert.equal(inspectIntegration(s, right).mergeConflicts.length, 0);
  assert(command(s, "rebase", { expectedBundleVersion: 2 }, right).ok);
  const v3 = publish(s, right),
    markdown = integrationMarkdown(s, v3);
  assert(markdown.includes("左分支修改") && markdown.includes("右分支修改"));
  assert.equal(
    JSON.stringify(ensureIntegration(s).versions.find((v) => v.id === v1)),
    history,
    "old published versions stay exact",
  );
  assert.equal(ensureIntegration(s).versions.length, 3);
}
{
  const s = project(),
    a = source(s, "住宿", "原酒店"),
    b = source(s, "交通", "原路线"),
    base = create(s, [a, b]);
  publish(s, base);
  const left = branch(s, base),
    right = branch(s, base);
  edit(
    s,
    left,
    (x) => {
      x[0].body = "酒店A";
      x.reverse();
    },
    "左标题",
  );
  edit(
    s,
    right,
    (x) => {
      x[0].body = "酒店B";
    },
    "右标题",
  );
  publish(s, left);
  const before = JSON.stringify(ensureIntegration(s));
  const conflict = command(s, "rebase", { expectedBundleVersion: 2 }, right);
  assert.equal(conflict.code, "MERGE_CONFLICT");
  assert.equal(JSON.stringify(ensureIntegration(s)), before, "conflicted rebase is atomic");
  const choices = Object.fromEntries(conflict.conflicts!.map((c) => [c.key, "ours" as const]));
  assert(command(s, "rebase", { expectedBundleVersion: 2, choices }, right).ok);
  const reviewed = inspectIntegration(s, right);
  assert.equal(reviewed.revision.title, "右标题");
  assert.equal(
    reviewed.revision.sections[0].title,
    "交通",
    "independent published reorder is retained",
  );
  assert(reviewed.revision.sections.some((x) => x.body === "酒店B"));
}
{
  const s = project(),
    a = source(s, "第1天", "上午活动"),
    b = source(s, "第2天", "午间活动"),
    draft = create(s, [a, b]);
  edit(s, draft, (x) => {
    x[0].schedule = { date: "2026-12-01", start: "09:00", end: "11:00", resource: "同行人" };
    x[1].schedule = { date: "2026-12-01", start: "10:00", end: "12:00", resource: "同行人" };
    x[0].facts = [{ key: "第1晚酒店", value: "A" }];
    x[1].facts = [{ key: "第1晚酒店", value: "B" }];
  });
  let check = inspectIntegration(s, draft);
  assert(check.issues.some((i) => i.code === "TIME_OVERLAP"));
  assert(check.issues.some((i) => i.code === "FACT_CONFLICT"));
  assert(!check.canPublish);
  edit(s, draft, (x) => {
    x[1].schedule!.date = "2026-12-02";
    x[1].facts![0].key = "第2晚酒店";
  });
  assert(inspectIntegration(s, draft).canPublish);
  const revision = inspectIntegration(s, draft).revision;
  const invalid = structuredClone(revision.sections);
  invalid[0].schedule = { date: "2026-02-31" };
  assert.equal(
    command(s, "save", { title: revision.title, sourceIds: [a, b], sections: invalid }, draft).code,
    "INVALID_SCHEMA",
  );
  assert.equal(
    command(
      s,
      "save",
      { title: revision.title, sourceIds: [a, b], sections: revision.sections },
      draft,
      { expectedRevision: 1 },
    ).code,
    "REVISION_CONFLICT",
  );
  assert.equal(
    command(
      s,
      "save",
      { title: revision.title, sourceIds: [a], sections: [revision.sections[0]] },
      draft,
    ).code,
    "EXCLUSION_REASON_REQUIRED",
  );
  assert(
    command(
      s,
      "save",
      {
        title: revision.title,
        sourceIds: [a],
        sections: [revision.sections[0]],
        excludeReasons: { [b]: "第二天将另行安排" },
      },
      draft,
    ).ok,
  );
  assert(ensureIntegration(s).events.at(-1)!.detail.includes("第二天将另行安排"));
}
{
  const s = project(),
    a = source(s, "住宿", "酒店计划"),
    draft = create(s, [a]),
    version = publish(s, draft),
    next = branch(s, draft);
  domain(s, "record_decision", { kind: "constraint", text: "新增预算限制：总价不得超过3000元" });
  assert(!inspectIntegration(s, next).canPublish);
  assert(inspectIntegrationVersion(s, version)!.issues.some((i) => i.code === "STALE_SOURCE"));
  assert.equal(
    command(s, "rebase", { expectedBundleVersion: 1 }, next).code,
    "SOURCE_UNAVAILABLE",
    "new confirmed constraints require source revalidation, not a silent repin",
  );
  domain(s, "mark_stale", { artifactId: a, reason: "酒店已经停业" });
  assert(!inspectIntegration(s, next).canPublish);
  assert.equal(command(s, "rebase", { expectedBundleVersion: 1 }, next).code, "SOURCE_UNAVAILABLE");
  assert(integrationMarkdown(s, version).includes("当前来源或条件已变化"));
  const other = project();
  assert.equal(
    command(other, "create", { title: "外部来源", sourceIds: [a] }).code,
    "SOURCE_UNAVAILABLE",
  );
}
{
  const s = project(),
    a = source(s, "任务", "原成果"),
    draft = create(s, [a]);
  const commandValue: IntegrationCommand = {
    projectId: s.project.id,
    idempotencyKey: "__proto__",
    type: "create",
    payload: { title: "安全幂等", sourceIds: [a] },
  };
  assert(applyIntegration(s, commandValue).ok);
  assert(applyIntegration(s, commandValue).replayed);
  assert.equal(
    applyIntegration(s, { ...commandValue, idempotencyKey: "agent-write" }, "agent").code,
    "HUMAN_REQUIRED",
  );
  const before = JSON.stringify(ensureIntegration(s));
  assert.equal(
    command(
      s,
      "save",
      {
        title: "非法",
        sourceIds: [a],
        sections: [{ id: "1", title: "无来源", body: "X", sourceIds: ["missing"] }],
      },
      draft,
    ).code,
    "INVALID_SOURCE",
  );
  assert.equal(JSON.stringify(ensureIntegration(s)), before);
}
{
  const s = project(),
    a = source(s, "第一天", "甲"),
    b = source(s, "第二天", "乙"),
    c = source(s, "第三天", "丙"),
    base = create(s, [a, b, c]);
  publish(s, base);
  const left = branch(s, base),
    right = branch(s, base);
  edit(s, left, (x) => {
    x.push({ id: "left-added", title: "带上雨伞", body: "人工提醒", sourceIds: [] });
  });
  edit(s, right, (x) => {
    x.push({ id: "right-added", title: "确认接送", body: "人工提醒", sourceIds: [] });
  });
  publish(s, left);
  assert(command(s, "rebase", { expectedBundleVersion: 2 }, right).ok);
  assert.equal(
    inspectIntegration(s, right).revision.sections.length,
    5,
    "disjoint additions never overwrite one another",
  );
  publish(s, right);
  const deletion = branch(s, right),
    modification = branch(s, right);
  edit(s, deletion, (x) => {
    x.splice(
      x.findIndex((s) => s.id === "left-added"),
      1,
    );
  });
  edit(s, modification, (x) => {
    x.find((s) => s.id === "left-added")!.body = "改为雨衣";
  });
  publish(s, deletion);
  assert(
    inspectIntegration(s, modification).mergeConflicts.some((c) => c.key === "section:left-added"),
    "delete versus modification needs a choice",
  );
  assert.equal(
    command(s, "rebase", { expectedBundleVersion: 4 }, modification).code,
    "MERGE_CONFLICT",
  );
  const orderA = branch(s, deletion),
    orderB = branch(s, deletion);
  edit(s, orderA, (x) => {
    [x[0], x[1]] = [x[1], x[0]];
  });
  edit(s, orderB, (x) => {
    [x[1], x[2]] = [x[2], x[1]];
  });
  publish(s, orderA);
  assert(
    inspectIntegration(s, orderB).mergeConflicts.some((c) => c.kind === "order"),
    "divergent orders never silently win",
  );
}
{
  const s = project(),
    a = source(s, "准确源会话", "人工内容"),
    artifact = s.collaboration!.artifacts.find((x) => x.id === a)!;
  // Transport fixture: exact historical admission, plus a newer unrelated execution.
  artifact.runId = "old-run";
  s.collaboration!.executionLinks = [
    {
      id: "execution:old-run",
      projectId: s.project.id,
      taskKey: artifact.key,
      taskId: artifact.key,
      agentId: "codex",
      tool: "codex",
      connectionId: "first-connection",
      sessionId: "local-old",
      sourceSessionId: "provider-old",
      runId: "old-run",
      runtimeRunId: "driver-old",
      at: new Date().toISOString(),
      provenance: "receipt",
    },
    {
      id: "execution:new-run",
      projectId: s.project.id,
      taskKey: artifact.key,
      taskId: artifact.key,
      agentId: "codex",
      tool: "codex",
      connectionId: "first-connection",
      sessionId: "local-new",
      sourceSessionId: "provider-new",
      runId: "new-run",
      runtimeRunId: "driver-new",
      at: new Date().toISOString(),
      provenance: "receipt",
    },
  ];
  const p = listIntegrationSources(s).find((p) => p.artifactId === a)!;
  assert.equal(p.runId, "old-run");
  assert.equal(p.sourceSessionId, "provider-old");
  assert.equal(p.sessionId, "local-old");
  assert.equal(p.runtimeRunId, "driver-old");
  const draft = create(s, [a]);
  edit(s, draft, (x) => {
    x[0].schedule = { date: "2026-12-01", start: "10:00", end: "11:00" };
  });
  assert(inspectIntegration(s, draft).issues.some((i) => i.code === "UNSCOPED_TIME"));
  assert(
    inspectIntegration(s, draft).canPublish,
    "unknown resource is not a fabricated time collision",
  );
  s.project.timeZone = "Asia/Bangkok";
  assert(
    !inspectIntegration(s, draft).canPublish,
    "timezone changes invalidate pinned interpretation",
  );
  assert(command(s, "rebase", { expectedBundleVersion: 0 }, draft).ok);
  assert(inspectIntegration(s, draft).canPublish);
}
console.log(
  "result integration: immutable versions, CAS/idempotency, source/condition fencing, three-way merge, explicit exclusions, temporal/fact conflicts and human publication passed",
);
