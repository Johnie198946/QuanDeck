import assert from 'node:assert/strict';
import { createSampleSnapshot } from '../src/data/fixtures';
import { completedResults, resultComposition, reportMarkdown } from '../src/data/results';
import { deriveResultMetrics } from '../src/data/resultMetrics';
import type { TaskOutput } from '../src/data/types';
const s = createSampleSnapshot();
const taskId = Object.keys(s.tasks)[0];
const o = s.orchestrations?.[taskId];
const childId = o ? Object.keys(o.items)[0] : undefined;
const output = (id: string, patch: Partial<TaskOutput> = {}): TaskOutput => ({ id, taskId, workItemId: null, title: '我的交付', body: '完成了路线与预算', links: [{ label: '路线', url: 'https://example.com/route' }], attachments: [{ id: 'attachment-1', name: '行程.pdf', type: 'application/pdf', size: 100 }], origin: 'human', status: 'published', createdAt: '2026-11-16T09:00:00Z', updatedAt: '2026-11-16T09:00:00Z', ...patch });
s.outputs = { a: output('a'), draft: output('draft', { status: 'draft' }), other: output('other', { taskId: 'missing-task' }) };
const all = completedResults(s, taskId, null);
assert.equal(all.filter(record => record.origin === 'human').length, 1);
assert.equal(all.find(record => record.outputId === 'a')!.text, '完成了路线与预算');
assert(!all.some(record => record.outputId === 'draft' || record.outputId === 'other'));
assert.equal(completedResults(s, 'missing-task', null).length, 0);
assert.equal(completedResults(s, taskId, 'missing-child').length, 0);
if (childId) {
 s.outputs.child = output('child', { workItemId: childId });
 const branch = completedResults(s, taskId, childId);
 assert.equal(branch.filter(record => record.origin === 'human').length, 1);
 assert.equal(branch.find(record => record.origin === 'human')!.outputId, 'child');
}
s.tasks[taskId].completion = null; // published work remains useful when a task is reopened.
assert(completedResults(s, taskId, null).some(record => record.outputId === 'a'));
s.outputs.a.body = '已调整预算';
assert.equal(completedResults(s, taskId, null).find(record => record.outputId === 'a')!.text, '已调整预算');
const record = completedResults(s, taskId, null).find(record => record.outputId === 'a')!;
assert.match(reportMarkdown(record), /行程.pdf/); assert.match(reportMarkdown(record), /https:\/\/example.com\/route/); assert.match(reportMarkdown(record), /人工提交/);
assert.deepEqual(resultComposition([record]), { total: 1, human: 1, agent: 0, text: 1, links: 1, files: 1 });
delete s.outputs.a;
assert(!completedResults(s, taskId, null).some(record => record.outputId === 'a'));
const manual = createSampleSnapshot(); manual.tasks = { single: { id:'single', title:'人工任务', sessionIds:[], completion:null, manualLock:false, owner:'me', createdAt:'09:00' } }; manual.sessions={}; manual.orchestrations={}; manual.outputs={};
assert.equal(deriveResultMetrics(manual,'single',null).ratio,0);
manual.tasks.single.completion={reason:'manual',at:'10:00'};
assert.equal(deriveResultMetrics(manual,'single',null).ratio,1);
assert.equal(deriveResultMetrics(manual,'single',null).tokenValue,null);
console.log('manual-results: published/draft separation, exact task/branch scope, edits/deletion/reopen, links/files export, contribution counts, manual progress without fake tokens');
