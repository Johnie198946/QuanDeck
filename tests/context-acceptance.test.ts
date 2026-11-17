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
  const submissionId = command(s, "submit", { title, body, handoff: { summary: title, completed: ["Verified evidence"], decisions: [], remaining: [], nextSteps: [] } }, key).resourceId!;
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
  const pack = buildContextPackage(s, target, { tokenBudget: 24000 });
  const labels = [name + "执行", constraint, tail, "按用户条件交付", "来源完整"];
  const present = labels.filter((label) => pack.prompt.includes(label)).length;
  assert.equal(present, labels.length, `${name}: mandatory omission`);
  assert.equal(pack.sources[0].excerpt, body, `${name}: required evidence must be complete`);
  assert.equal(pack.sources[0].truncated, false);
  assert.throws(() => buildContextPackage(s, target, { tokenBudget: 256 }), code("CONTEXT_BUDGET_EXCEEDED"), "reject rather than truncate mandatory evidence");
  assert.equal(pack.tokenBudget, 24000);
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
for (let i = 0; i < 100; i++) readAndRecordContextEvidence(recorded, pageRequest, binding);
assert.equal(recorded.contextEvidenceReads!.length, 102, "repeated evidence reads are recorded without token gates");
assert.equal(pack.tokenBudget, 6000);
const recordedBefore = JSON.stringify(recorded.contextEvidenceReads);
assert.throws(() => readAndRecordContextEvidence(recorded, { ...pageRequest, hash: "invalid" }, binding), code("SOURCE_NOT_IN_CONTEXT"));
assert.equal(JSON.stringify(recorded.contextEvidenceReads), recordedBefore);

// Same relevant material + increasing irrelevant archive: full-history and retrieved input baseline.
function scale(size: number, archived = true) {
  const fixture = structuredClone(s), c = ensureCollaboration(fixture);
  const template = c.tasks[evidenceKey], a = c.artifacts[0], sub = c.submissions[0], review = c.reviews[0], spec = c.specs.find((x) => x.key === evidenceKey)!;
  for (let i = 0; i < size; i++) {
    const id = `archive-${i.toString().padStart(4, "0")}`, body = `无关历史项目 ${i}：` + "档案正文。".repeat(100);
    c.tasks[id] = { ...template, key: id, taskId: id, title: `其他项目档案 ${i}`, archived, acceptedArtifactId: `artifact-${id}` };
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
  const firstPage = queryTaskMemory(fixture, { projectId: fixture.project.id, limit: 50, includeArchived: true }, index);
  assert(firstPage.nextCursor);
  const secondPage = queryTaskMemory(fixture, { projectId: fixture.project.id, limit: 50, includeArchived: true, cursor: firstPage.nextCursor }, index);
  assert(!secondPage.items.some((item) => firstPage.items.some((prior) => prior.key === item.key)));
  assert.throws(() => queryTaskMemory(fixture, { projectId: fixture.project.id, query: "changed", cursor: firstPage.nextCursor }), code("STALE_CURSOR"));
  assert.equal(context.projectMemory!.entries.length, 1, "only the current task and required predecessors enter scoped memory");
  return { historyTasks: size, archived, memoryEntries: context.projectMemory!.entries.length, inputTokens: context.estimatedTokens,
    fullHistoryEstimate: estimateTokens(c.artifacts.map((x) => x.body).join("\n")),
    candidateCount: lookup.total, returnedCards: lookup.items.length, expansionCount: expansions,
    indexMs: indexedAt - start, queryMs: queriedAt - indexedAt, assemblyMs: assembledAt - queriedAt };
}
const baseline = scale(100), large = scale(1000);
const growth = large.inputTokens / baseline.inputTokens - 1;
assert(growth <= .10, `context growth ${(growth * 100).toFixed(2)}% >10%`);
const live = scale(100, false);
assert.equal(live.inputTokens, baseline.inputTokens, "irrelevant live task memory does not increase the task payload");
const report = { schema: "quandeck.context-benchmark.v2", fixtureOnly: true, modelQualityMeasured: false,
  generatedAt: new Date().toISOString(), cases, missingMandatoryLabels: cases.reduce((sum, row) => sum + row.mandatory - row.present, 0),
  baseline, large, live, growth, scopeChecks: "cross-project, wrong hash/context/epoch, stale source, tamper, takeover, oversized page rejected" };
if (process.env.QUANDECK_CONTEXT_REPORT) writeFileSync(process.env.QUANDECK_CONTEXT_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// Reject malformed/oversized budgets and atomically refuse an incomplete mandatory package.
{
  const value = createEmptySnapshot({ id: 'bounded-memory', name: 'Bounded memory' });
  const target = create(value, 'Small target');
  for (const tokenBudget of [0, -1, 1.5, NaN, Infinity, 48001])
    assert.throws(() => buildContextPackage(value, target, { tokenBudget }), code('SCHEMA_INVALID'));
  command(value, 'record_decision', { text: '不可丢失的要求。'.repeat(1600), kind: 'constraint' }, target);
  const expanded = buildContextPackage(value,target);
  assert(expanded.tokenBudget! > 6000 && expanded.tokenBudget! <= 48000);
  assert.equal(expanded.targetTokenBudget,6000);
  assert.equal(expanded.budgetExpansion?.reason,'complete-required-input');
  command(value, 'record_decision', { text: '另一项必须保留的条件。'.repeat(1800), kind: 'constraint' }, target);
  const before = JSON.stringify(value);
  const failed = applyCollaboration(value, { projectId: value.project.id, type: 'claim', taskId: target,
    idempotencyKey: 'oversized-claim', payload: { executor: 'codex' } }, { kind: 'service' });
  assert.equal(failed.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(JSON.stringify(value), before, 'oversized dispatch writes no claim, run or context');
  assert.throws(() => buildContextPackage(value, target, { tokenBudget: 48000 }), code('CONTEXT_BUDGET_EXCEEDED'));
  assert.throws(() => buildContextPackage(value, target, { tokenBudget: 64000 }), code('SCHEMA_INVALID'));
}

// A reference, its delivery metadata and its handoff share one optional budget decision.
{
  const value = createEmptySnapshot({ id: 'optional-memory', name: 'Optional memory' });
  const prior = create(value, 'Optional handoff reference');
  const submission = command(value, 'submit', { title: 'Optional handoff reference', body: 'Tiny body',
    handoff: { summary: 'Large optional handoff '.repeat(80), completed: ['evidence'], decisions: [], remaining: [], nextSteps: ['next'] } }, prior).resourceId!;
  command(value, 'review', { submissionId: submission, verdict: 'accepted', checks: [true,true], note: 'checked' }, prior);
  const target = create(value, 'Optional handoff target');
  const base = buildContextPackage(value, target, { sourceIds: [] });
  const tight = buildContextPackage(value, target, { tokenBudget: base.estimatedTokens + 50 });
  assert.equal(tight.sources.length, 0);
  assert.equal(tight.handoffPins!.length, 0);
  assert.equal(tight.omittedSources, 1);
  assert(!tight.prompt.includes('Tiny body') && !tight.prompt.includes('Large optional handoff'));
  assert(tight.estimatedTokens <= tight.tokenBudget!);
  const candidate = create(value, 'Optional handoff unreviewed');
  command(value, 'submit', { title: 'Optional handoff unreviewed', body: 'CANDIDATE_NOT_PROJECT_FACT' }, candidate);
  assert(!buildContextPackage(value,target).prompt.includes('CANDIDATE_NOT_PROJECT_FACT'));
}

// Deep child tasks inherit parent conditions; changing a branch fences only that subtree.
{
  const value = createEmptySnapshot({ id: 'memory-inheritance', name: 'Inherited requirements' });
  const root = create(value, 'Project component');
  value.orchestrations[root] = { taskId: root, label: 'Complete component',
    startedAt: '2026-01-01T00:00:00Z', syncedAt: '2026-01-01T00:00:00Z', coordinationTokens: null,
    phases: ['执行'], executors: {}, items: {}, itemOrder: [], attempts: {},
    capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false } };
  for (const [id,parent] of [['branch',root],['leaf','branch'],['sibling',root]]) {
    value.orchestrations[root].items[id] = { id, rootTaskId: root, parentTaskId: parent, title: id, phase: '执行',
      dependsOnTaskIds: [], owner: 'agent', executorId: null, status: 'not_started', attemptIds: [] };
    value.orchestrations[root].itemOrder.push(id);
  }
  ensureCollaboration(value);
  const branch = root + '::branch', leaf = root + '::leaf', sibling = root + '::sibling';
  command(value, 'record_decision', { text: 'GLOBAL_SCOPE_RULE', kind: 'constraint' });
  command(value, 'record_decision', { text: 'ROOT_SCOPE_RULE', kind: 'constraint' }, root);
  command(value, 'record_decision', { text: 'BRANCH_SCOPE_RULE', kind: 'constraint' }, branch);
  const inherited = buildContextPackage(value, leaf);
  for (const label of ['GLOBAL_SCOPE_RULE','ROOT_SCOPE_RULE','BRANCH_SCOPE_RULE']) assert(inherited.prompt.includes(label));
  assert(!buildContextPackage(value,sibling).prompt.includes('BRANCH_SCOPE_RULE'));
  command(value, 'claim', { executor: 'codex', runId: 'deep-leaf-run' }, leaf, true);
  const siblingVersion = value.collaboration!.tasks[sibling].version;
  command(value, 'record_decision', { text: 'NEW_BRANCH_RULE', kind: 'constraint' }, branch);
  assert.notEqual(value.collaboration!.runs['deep-leaf-run'].status, 'queued');
  assert.equal(value.collaboration!.tasks[leaf].activeRunId, undefined);
  assert.equal(value.collaboration!.tasks[sibling].version, siblingVersion);
  const after = buildContextPackage(value,leaf);
  assert(after.prompt.includes('NEW_BRANCH_RULE'));
  const beforeParent = after.ancestorSpecs!.find(item => item.key === branch)!;
  command(value, 'claim', { executor: 'codex', runId: 'after-condition-run' }, leaf, true);
  command(value, 'revise_task', { goal: 'REVISED_PARENT_REQUIREMENT', criteria: ['new acceptance'], reason: 'parent scope changed' }, branch);
  const revised = buildContextPackage(value,leaf);
  assert(revised.prompt.includes('REVISED_PARENT_REQUIREMENT'));
  assert.notEqual(revised.ancestorSpecs!.find(item => item.key === branch)!.id,beforeParent.id);
  assert.equal(value.collaboration!.tasks[leaf].activeRunId, undefined);
  assert.equal(value.collaboration!.tasks[sibling].version, siblingVersion);
}
console.log('bounded memory: irrelevant growth, atomic budgets, candidate isolation and deep scope inheritance passed');

// Original project requirements cannot become an optional, silently clipped background hint.
{
  const description = '完整项目要求。'.repeat(750) + 'PROJECT_REQUIREMENT_TAIL';
  const value = createEmptySnapshot({ id: 'large-project-requirement', name: 'Complete project requirement', description });
  accepted(value, 'Small specific reference', 'Useful but optional related evidence');
  const target = create(value, 'Small specific task');
  const expanded = command(value, 'claim', { executor: 'codex' }, target, true).context!;
  assert(expanded.prompt.includes(description));
  assert(expanded.prompt.includes('PROJECT_REQUIREMENT_TAIL'));
  assert(expanded.tokenBudget! > expanded.targetTokenBudget!);
  assert(expanded.tokenBudget! <= 48000);
  assert.equal(expanded.estimatedTokens, expanded.tokenBudget);
  assert.equal(expanded.sources.length, 0, 'expanded allowance is only for mandatory input');
  assert.equal(expanded.omittedSources, 1);
  assert.throws(() => buildContextPackage(value,target,{tokenBudget:6000}),code('CONTEXT_BUDGET_EXCEEDED'));
}
