import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, exportCollaboration, type CollaborationCommand } from '../src/data/collaboration';
import { buildProjectMemory, renderProjectMemory } from '../src/data/projectMemory';
import { buildSummaryInput } from '../src/data/intelligence';
import { summaryInputForModel } from '../src/data/aiProvider';

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
  assert(page.includes(text), text); assert(context.prompt.includes(text), text); assert(JSON.stringify(summary).includes(text), text);
}
assert.equal(JSON.stringify(snapshot.collaboration), JSON.parse(before).collaboration && JSON.stringify(JSON.parse(before).collaboration));
assert.equal(memory.entries.find(row => row.key === source)!.handoff!.reviewStatus, 'accepted');
assert.equal(memory.entries.find(row => row.key === target)!.handoff, undefined);
assert.equal(memory.progress.completed.length, 1);

const c = snapshot.collaboration!;
for (let n = 0; n < 5000; n++) c.events.push({ id: 'audit-only-' + n, sequence: ++c.sequence, type: 'runtime_heartbeat', taskKey: source, actor: 'runtime', at: '2026-01-01T00:00:00Z', detail: 'INTERNAL_RUN_LOG_DO_NOT_SEND' });
(c.receipts as Record<string, unknown>)['internal-receipt'] = { detail: 'INTERNAL_RECEIPT_DO_NOT_SEND', actualTokens: 123456789 };
const current = buildProjectMemory(snapshot), docs = exportCollaboration(snapshot), input = buildSummaryInput(snapshot);
assert.equal(current.hash, memory.hash, 'audit growth does not change project-memory identity');
assert.equal(renderProjectMemory(snapshot), page, 'audit growth does not inflate human memory');
const withoutWatermarks = (value: typeof input) => {
  const copy = structuredClone(value); copy.sourceSeq = 0; copy.projectMemory!.sourceSequence = 0; copy.coverage!.estimatedTokens = 0; return copy;
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
console.log('project memory boundary: business handoff, stable audit exclusion, explicit private recovery passed');
