import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { applyCollaboration, buildContextPackage, ensureCollaboration, estimateTokens, hashText } from "../src/data/collaboration";
import { readContextEvidence, readAndRecordContextEvidence } from "../src/data/contextEvidence";
import { buildTaskMemoryIndex, queryTaskMemory } from "../src/data/taskMemory";
import { createEmptySnapshot } from "../src/data/projectStorage";
import type { Snapshot } from "../src/data/types";

let serial = 0;
function command(s: Snapshot, type: Parameters<typeof applyCollaboration>[1]["type"], payload: Record<string, unknown>, key?: string, service = false) {
  const result = applyCollaboration(s, { projectId: s.project.id, type, idempotencyKey: `acceptance-${++serial}`,
    taskId: key, expectedVersion: key ? s.collaboration?.tasks[key]?.version : undefined, payload }, { kind: service ? "service" : "human" });
  assert(result.ok, result.code + ":" + result.message); return result;
}
const create = (s: Snapshot, title: string, dependencies: string[] = []) => command(s, "create_task", { title, goal: title, criteria: ["按用户条件交付", "来源完整"], owner: "agent", dependencies }).resourceId!;
function accepted(s: Snapshot, title: string, body: string) {
  const key = create(s, title);
  const submissionId = command(s, "submit", { title, body }, key).resourceId!;
  command(s, "review", { submissionId, verdict: "accepted", checks: [true, true], note: "fixture annotation" }, key);
  return key;
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

// Twenty independently annotated tasks exercise hard conditions at the beginning,
// middle and end of evidence. These are deterministic packaging tests, not AI quality claims.
const annotations = [
  ["交通", "禁止红眼航班", "末班车为21:30"], ["住宿", "酒店需无障碍", "必须有电梯"],
  ["饮食", "花生过敏", "后厨交叉污染需要确认"], ["预算", "总预算8000元", "保留1000元应急"],
  ["日期", "12月1日出发", "12月7日返回"], ["城市", "仅曼谷清迈", "不要安排普吉岛"],
  ["带娃", "同行幼儿3岁", "午休两小时"], ["老人", "步行每段20分钟", "每天最多两个景点"],
  ["天气", "雨天改室内", "不可用过期预报"], ["航班", "随身行李7公斤", "转机至少3小时"],
  ["保险", "覆盖潜水活动", "确认免责条款"], ["票务", "先查退改规则", "未授权不得付款"],
  ["研究", "只采用一手来源", "标明查询日期"], ["代码", "保留旧接口", "不得覆盖用户修改"],
  ["发布", "须先通过测试", "未经授权不得部署"], ["报告", "区分事实与估计", "未知费用不填零"],
  ["日程", "周一上午人工确认", "确认后才解锁排程"], ["地图", "坐标须核验", "跨城移动预留时间"],
  ["合并", "保留来源版本", "冲突必须显式处理"], ["权限", "只读取当前项目", "引用不是执行授权"],
];
const cases: { name: string; mandatory: number; present: number; tokens: number }[] = [];
for (const [name, constraint, tail] of annotations) {
  const s = createEmptySnapshot({ id: `bench-${name}`, name });
  command(s, "set_policy", { contextTokens: 24000, runTokens: 30000 });
  const body = `资料开头：${name}\n` + "详细依据。".repeat(900) + `\n关键尾注：${tail}`;
  const sourceKey = accepted(s, name + "来源", body), target = create(s, name + "执行", [sourceKey]);
  command(s, "record_decision", { text: constraint, kind: "rejection" }, target);
  const pack = buildContextPackage(s, target);
  const labels = [name + "执行", constraint, tail, "按用户条件交付", "来源完整"];
  const present = labels.filter((label) => pack.prompt.includes(label)).length;
  assert.equal(present, labels.length, `${name}: mandatory omission`);
  assert.equal(pack.sources[0].excerpt, body, `${name}: required evidence must be complete`);
  assert.equal(pack.sources[0].truncated, false);
  assert.throws(() => buildContextPackage(s, target, { tokenBudget: 256 }), code("CONTEXT_BUDGET_EXCEEDED"));
  assert.throws(() => buildContextPackage(s, target, { sourceIds: [] }), code("REQUIRED_SOURCE_MISSING"));
  cases.push({ name, mandatory: labels.length, present, tokens: pack.estimatedTokens });
}

// Controlled fixed-version expansion reconstructs optional evidence without silently losing its tail.
const s = createEmptySnapshot({ id: "scope", name: "证据范围" });
const evidenceKey = accepted(s, "泰国交通", "交通依据。".repeat(1000) + "不可遗漏的尾注"), key = create(s, "泰国交通执行");
const result = command(s, "claim", { executor: "codex", runId: "evidence-run" }, key, true);
const pack = result.context!, source = pack.sources[0], binding = { runId: "evidence-run", claimEpoch: pack.claimEpoch };
assert.equal(source.truncated, true);
const request = { projectId: s.project.id, contextPackageId: pack.id, artifactId: source.id, hash: source.hash };
let full = source.excerpt, offset: number | null = source.endOffset!;
let expansions = 0;
while (offset !== null) {
  const page = readContextEvidence(s, { ...request, offset, limit: 4000 }, binding);
  full += page.text; offset = page.nextOffset; expansions++;
}
assert.equal(full, s.collaboration!.artifacts.find((a) => a.id === source.id)!.body);
assert.equal(hashText(full), source.hash);
assert.throws(() => readContextEvidence(s, { ...request, projectId: "foreign" }, binding), code("READ_SCOPE_REVOKED"));
assert.throws(() => readContextEvidence(s, { ...request, hash: "altered" }, binding), code("SOURCE_NOT_IN_CONTEXT"));
assert.throws(() => readContextEvidence(s, { ...request, contextPackageId: "another" }, binding), code("CONTEXT_MISMATCH"));
assert.throws(() => readContextEvidence(s, { ...request, limit: 4001 }, binding), code("SCHEMA_INVALID"));
assert.throws(() => readContextEvidence(s, request, { ...binding, claimEpoch: 0 }), code("READ_SCOPE_REVOKED"));
const changed = structuredClone(s);
changed.collaboration!.tasks[evidenceKey].requiresRevalidation = true;
assert.throws(() => readContextEvidence(changed, request, binding), code("SOURCE_STALE"));
const tampered = structuredClone(s); tampered.collaboration!.artifacts[0].body += "tampered";
assert.throws(() => readContextEvidence(tampered, request, binding), code("SOURCE_NOT_IN_CONTEXT"));
const revoked = structuredClone(s); revoked.collaboration!.tasks[key].activeRunId = "new-run";
assert.throws(() => readContextEvidence(revoked, request, binding), code("READ_SCOPE_REVOKED"));

// Delivered fragments are persisted, bounded cumulatively, and re-reads count as input again.
const recorded = structuredClone(s);
const pageRequest = { ...request, offset: 2000, limit: 100 };
const delivered = readAndRecordContextEvidence(recorded, pageRequest, binding);
assert.equal(recorded.contextEvidenceReads!.length, 1);
assert.equal(recorded.contextEvidenceReads![0].fragmentHash, hashText(delivered.text));
assert.equal(recorded.contextEvidenceReads![0].hash, source.hash);
assert.equal(recorded.contextEvidenceReads![0].length, 100);
const firstRead = JSON.stringify(recorded.contextEvidenceReads![0]);
readAndRecordContextEvidence(recorded, pageRequest, binding);
assert.equal(JSON.stringify(recorded.contextEvidenceReads![0]), firstRead, "old read receipt is immutable");
assert.notEqual(recorded.contextEvidenceReads![0].id, recorded.contextEvidenceReads![1].id, "repeated reads cost input again");
let exhausted = false;
for (let i = 0; i < 100; i++) {
  const before = JSON.stringify(recorded.contextEvidenceReads);
  try { readAndRecordContextEvidence(recorded, pageRequest, binding); }
  catch (error) { assert(code("CONTEXT_READ_BUDGET")(error)); assert.equal(JSON.stringify(recorded.contextEvidenceReads), before); exhausted = true; break; }
}
assert(exhausted);
assert(recorded.contextEvidenceReads!.reduce((sum, read) => sum + read.estimatedTokens, 0) + pack.estimatedTokens <= pack.tokenBudget);
const recordedBefore = JSON.stringify(recorded.contextEvidenceReads);
assert.throws(() => readAndRecordContextEvidence(recorded, { ...pageRequest, hash: "invalid" }, binding), code("SOURCE_NOT_IN_CONTEXT"));
assert.equal(JSON.stringify(recorded.contextEvidenceReads), recordedBefore);

// Same relevant material + increasing irrelevant archive: full-history and retrieved input baseline.
function scale(size: number) {
  const fixture = structuredClone(s), c = ensureCollaboration(fixture);
  const template = c.tasks[evidenceKey], a = c.artifacts[0], sub = c.submissions[0], review = c.reviews[0], spec = c.specs.find((x) => x.key === evidenceKey)!;
  for (let i = 0; i < size; i++) {
    const id = `archive-${i.toString().padStart(4, "0")}`, body = `无关历史项目 ${i}：` + "档案正文。".repeat(100);
    c.tasks[id] = { ...template, key: id, taskId: id, title: `其他项目档案 ${i}`, acceptedArtifactId: `artifact-${id}` };
    c.specs.push({ ...spec, id: `spec-${id}`, key: id, goal: `其他归档 ${i}` });
    c.artifacts.push({ ...a, id: `artifact-${id}`, artifactId: `artifact-${id}`, key: id, title: `其他归档 ${i}`, body, hash: hashText(body), sourceIds: [] });
    c.submissions.push({ ...sub, id: `submission-${id}`, key: id, artifactId: `artifact-${id}` });
    c.reviews.push({ ...review, id: `review-${id}`, key: id, submissionId: `submission-${id}` });
  }
  const start = performance.now(), index = buildTaskMemoryIndex(fixture), indexedAt = performance.now();
  const lookup = queryTaskMemory(fixture, { projectId: fixture.project.id, query: "泰国交通", limit: 8 }, index), queriedAt = performance.now();
  const context = buildContextPackage(fixture, key), assembledAt = performance.now();
  assert.equal(lookup.items.length, 2);
  assert(lookup.items.some((x) => x.key === evidenceKey));
  const firstPage = queryTaskMemory(fixture, { projectId: fixture.project.id, limit: 50 }, index);
  assert(firstPage.nextCursor);
  const secondPage = queryTaskMemory(fixture, { projectId: fixture.project.id, limit: 50, cursor: firstPage.nextCursor }, index);
  assert(!secondPage.items.some((item) => firstPage.items.some((prior) => prior.key === item.key)));
  assert.throws(() => queryTaskMemory(fixture, { projectId: fixture.project.id, query: "changed", cursor: firstPage.nextCursor }), code("STALE_CURSOR"));
  return { historyTasks: size, inputTokens: context.estimatedTokens,
    fullHistoryEstimate: estimateTokens(c.artifacts.map((x) => x.body).join("\n")),
    candidateCount: lookup.total, returnedCards: lookup.items.length, expansionCount: expansions,
    indexMs: indexedAt - start, queryMs: queriedAt - indexedAt, assemblyMs: assembledAt - queriedAt };
}
const baseline = scale(100), large = scale(1000);
const growth = large.inputTokens / baseline.inputTokens - 1;
assert(growth <= .10, `context growth ${(growth * 100).toFixed(2)}% >10%`);
const report = { schema: "quandeck.context-benchmark.v1", fixtureOnly: true, modelQualityMeasured: false,
  generatedAt: new Date().toISOString(), cases, missingMandatoryLabels: cases.reduce((sum, row) => sum + row.mandatory - row.present, 0),
  baseline, large, growth, scopeChecks: "cross-project, wrong hash/context/epoch, stale source, tamper, takeover, oversized page rejected" };
if (process.env.QUANDECK_CONTEXT_REPORT) writeFileSync(process.env.QUANDECK_CONTEXT_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
