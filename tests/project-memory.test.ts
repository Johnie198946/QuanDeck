import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, ensureCollaboration, exportCollaboration, type CollaborationCommand } from '../src/data/collaboration';
import { buildProjectMemory, renderProjectMemory } from '../src/data/projectMemory';
import { buildSummaryInput } from '../src/data/intelligence';
import { summaryInputForModel } from '../src/data/aiProvider';
import { taskProgressTrail } from '../src/data/taskProgressTrail';

const snapshot = createEmptySnapshot({ id: 'memory-fixture', name: '协作手册', description: '让接手者了解已确认规则及自己的职责' });
let seq = 0;
function command(type: CollaborationCommand['type'], payload: Record<string,unknown>, key?: string) {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, type, payload, taskId: key,
    expectedVersion: key ? snapshot.collaboration!.tasks[key].version : undefined, idempotencyKey: 'memory-' + ++seq }, { kind: 'human' });
  assert(result.ok, result.message); return result.resourceId!;
}
command('record_decision', { text: '全文必须中文', kind: 'constraint' });
const source = command('create_task', { title: '21E 规则核对', goal: '核对五条规则', criteria: ['五条齐全'], owner: 'me' });
const submission = command('submit', { title: '规则说明', body: '正文包含五条核对后的规则', handoff: {
  summary: '已核对五条规则；下一位负责应用。', completed: ['核对规则'], decisions: ['按顺序展示'], remaining: [], nextSteps: ['14D 将规则转为页面'],
} }, source);
command('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '五条规则逐条核对' }, source);
const target = command('create_task', { title: '14D 制作页面', goal: '使用 21E 规则做离线页面；禁止联网；保留中文全文', criteria: ['离线可读', '不得漏掉任一规则'], owner: 'agent', dependencies: [source] });
const memory = buildProjectMemory(snapshot), before = JSON.stringify(snapshot);
const page = renderProjectMemory(snapshot), context = buildContextPackage(snapshot, target), summary = buildSummaryInput(snapshot);
for (const text of ['让接手者了解', '已核对五条规则', '14D 将规则转为页面', '全文必须中文', '离线可读', '禁止联网', '尚未提交任务总结与交接']) {
  if (!['离线可读', '禁止联网'].includes(text)) assert(page.includes(text), text);
  if (text !== '尚未提交任务总结与交接') assert(context.prompt.includes(text), text);
  if (!['已核对五条规则', '14D 将规则转为页面', '尚未提交任务总结与交接'].includes(text)) assert(JSON.stringify(summary).includes(text), text);
}
assert.equal(JSON.stringify(snapshot.collaboration), JSON.parse(before).collaboration && JSON.stringify(JSON.parse(before).collaboration));
assert.equal(memory.entries.find(row => row.key === source)!.handoff!.reviewStatus, 'accepted');
assert.equal(memory.entries.find(row => row.key === target)!.handoff, undefined);
assert.equal(memory.progress.completed.length, 1);
assert.equal(memory.entries.find(row => row.key === target)!.nextStepsSource, 'current-state');
assert(memory.entries.find(row => row.key === target)!.nextSteps[0].includes('提交候选成果'));
assert.equal(memory.entries.find(row => row.key === source)!.nextStepsSource, 'handoff');
assert.deepEqual(memory.entries.find(row => row.key === source)!.nextSteps, ['14D 将规则转为页面']);

const c = snapshot.collaboration!;
for (let n = 0; n < 5000; n++) c.events.push({ id: 'audit-only-' + n, sequence: ++c.sequence, type: 'runtime_heartbeat', taskKey: source, actor: 'runtime', at: '2026-01-01T00:00:00Z', detail: 'INTERNAL_RUN_LOG_DO_NOT_SEND' });
(c.receipts as Record<string, unknown>)['internal-receipt'] = { detail: 'INTERNAL_RECEIPT_DO_NOT_SEND', actualTokens: 123456789 };
const current = buildProjectMemory(snapshot), docs = exportCollaboration(snapshot), input = buildSummaryInput(snapshot);
assert.equal(current.hash, memory.hash, 'audit growth does not change project-memory identity');
assert.equal(renderProjectMemory(snapshot), page, 'audit growth does not inflate human memory');
const withoutWatermarks = (value: typeof input) => {
  const copy = structuredClone(value); copy.sourceSeq = 0; if (copy.projectMemory) copy.projectMemory.sourceSequence = 0; copy.coverage!.estimatedTokens = 0; copy.coverage!.estimatedRequestTokens = 0; return copy;
};
assert.deepEqual(withoutWatermarks(input), withoutWatermarks(summary), 'no per-event growth or log contamination in summary input');
assert.equal(input.facts.some(fact => fact.kind === 'event'), false);
assert.deepEqual(input.sourceEventIds, []);
for (const content of [docs.memory, docs.ledger, docs.blackboard, docs.json, buildContextPackage(snapshot, target).prompt, JSON.stringify(summaryInputForModel(input))]) {
  for (const marker of ['INTERNAL_RUN_LOG_DO_NOT_SEND', 'INTERNAL_RECEIPT_DO_NOT_SEND', 'audit-only-', '实报 tokens', '事件水位', '执行来源：']) assert(!content.includes(marker), marker);
}
const diagnostic = JSON.parse(exportCollaboration(snapshot, { includeAudit: true }).json);
assert.equal(diagnostic.purpose, 'private-diagnostic-recovery');
assert.equal(diagnostic.defaultContext, false);
assert.equal(diagnostic.collaboration.events.length, c.events.length, 'audit preserved for explicit recovery');
assert(diagnostic.collaboration.events.some((event: {detail:string}) => event.detail === 'INTERNAL_RUN_LOG_DO_NOT_SEND'));

const legacy = structuredClone(input); delete legacy.projectMemory;
legacy.sourceEventIds.push('LEGACY_AUDIT_ID'); legacy.factRefs.push('LEGACY_AUDIT_ID');
legacy.facts.push({ id: 'LEGACY_AUDIT_ID', kind: 'event', text: 'LEGACY_RAW_EVENT' });
legacy.previousSummary = { id: 'old', version: 1, sourceSeq: 0, hash: 'hash', overview: 'LEGACY_LOG_SUMMARY', truncated: false };
assert(!JSON.stringify(summaryInputForModel(legacy)).includes('LEGACY_'), 'transport cleans already queued legacy summaries too');

command('reopen', { reason: '规则需重新核对' }, source);
const stale = buildProjectMemory(snapshot).entries.find(row => row.key === source)!;
assert(stale.stale);
assert.equal(stale.content, undefined, 'stale narrative cannot be presented as current instructions');
assert(stale.summary.includes('需重新核对'));
assert(stale.nextSteps[0].includes('重新验收'));
const waiting = buildProjectMemory(snapshot).entries.find(row => row.key === target)!;
assert.equal(waiting.status, 'blocked');
assert(waiting.nextSteps[0].includes('21E 规则核对'), 'blocked guidance names only actual unsatisfied predecessors');
const review = command('create_task', { title: '待核对说明', goal: '说明内容', criteria: ['说明齐全'], owner: 'me' });
command('submit', { title: '候选说明', body: '实际候选正文' }, review);
const reviewing = buildProjectMemory(snapshot).entries.find(row => row.key === review)!;
assert.equal(reviewing.nextStepsSource, 'current-state');
assert(reviewing.nextSteps[0].includes('记录验收结果'));
assert.deepEqual(reviewing.content!.nextSteps, [], 'derived guidance never rewrites recorded handoff content');

// A complete hierarchy counts its two leaves once, not the root/branch summaries again.
const hierarchy = createEmptySnapshot({ id: 'hierarchy', name: '层级计数' });
function treeCommand(type: CollaborationCommand['type'], payload: Record<string,unknown>, key?: string) {
  const row = key ? hierarchy.collaboration!.tasks[key] : undefined;
  const result = applyCollaboration(hierarchy, { projectId: hierarchy.project.id, type, payload,
    taskId: row?.taskId, workItemId: row?.workItemId, expectedVersion: row?.version, idempotencyKey: 'tree-' + ++seq }, { kind: 'human' });
  assert(result.ok, result.message); return result.resourceId!;
}
const root = treeCommand('create_task', { title: '父汇总', goal: '汇总子任务', criteria: ['汇总完成'], owner: 'me' });
hierarchy.orchestrations[root] = { taskId: root, label: '父汇总', startedAt: '2026-01-01T00:00:00Z', syncedAt: '2026-01-01T00:00:00Z', coordinationTokens: null, phases: ['执行'], executors: {}, items: {}, itemOrder: [], attempts: {}, capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false } };
for (const [id, parent] of [['branch', root], ['leaf-a', 'branch'], ['leaf-b', root]]) {
  hierarchy.orchestrations[root].items[id] = { id, rootTaskId: root, parentTaskId: parent, title: id, phase: '执行', dependsOnTaskIds: [], owner: 'me', executorId: null, status: 'not_started', attemptIds: [] };
  hierarchy.orchestrations[root].itemOrder.push(id);
}
ensureCollaboration(hierarchy);
for (const key of [root + '::leaf-a', root + '::leaf-b', root + '::branch', root]) {
  const submitted = treeCommand('submit', { title: '完成 ' + key, body: '已完成该范围并核对' }, key);
  treeCommand('review', { submissionId: submitted, verdict: 'accepted', checks: [true], note: '按该任务要求核对' }, key);
}
const treeMemory = buildProjectMemory(hierarchy), trail = taskProgressTrail(hierarchy);
assert.equal(treeMemory.entries.length, 4, 'parent handoffs remain readable');
assert.equal(treeMemory.progress.leafCount, 2);
assert.equal(treeMemory.progress.completed.length, 2);
assert.equal(treeMemory.progress.leafCount, trail.leafCount);
assert.equal(treeMemory.progress.completed.length, trail.completedLeaves);
assert(renderProjectMemory(hierarchy).includes('末级任务已完成：2/2'));
console.log('project memory boundary: business handoff, stable audit exclusion, explicit private recovery passed');
