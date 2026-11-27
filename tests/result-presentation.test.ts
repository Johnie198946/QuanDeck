import './delivery-presentation.test';
import { inboxRows, inboxResultVersions } from '../src/components/projects/agentInboxData';
import assert from 'node:assert/strict';
import { applyCollaboration } from '../src/data/collaboration';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { taskResultEntries, presentResult, resultExcerpt } from '../src/data/resultPresentation';
import type { Snapshot, Session } from '../src/data/types';

const snap = createEmptySnapshot({ id: 'presentation-test', name: '旅行' });
let serial = 0;
function command(type: Parameters<typeof applyCollaboration>[1]['type'], payload: Record<string, unknown>, taskId?: string) {
  const result = applyCollaboration(snap, { projectId: snap.project.id, idempotencyKey: `reader-${++serial}`, type, taskId,
    expectedVersion: taskId ? snap.collaboration?.tasks[taskId]?.version : undefined, payload }, { kind: 'human' });
  assert(result.ok, result.message); return result;
}
const taskId = command('create_task', { title: '泰国旅行', goal: '旅行攻略', owner: 'me', criteria: ['内容已核对'] }).resourceId!;
const body = '## 路线\n\n曼谷两晚，芭提雅两晚。\n\n|日期|安排|\n|---|---|\n|周四|河畔散步|';
const submissionId = command('submit', { title: '泰国旅行攻略', body }, taskId).resourceId!;
let entries = taskResultEntries(snap, taskId, null);
assert.equal(entries.length, 1);
assert.equal(entries[0].status, '待核对', 'published storage must not imply accepted');
assert.equal(entries[0].record.text, body, 'complete report is retained');
assert.equal(entries[0].runId, undefined, 'manual result does not invent a runtime');
command('review', { submissionId, verdict: 'accepted', note: '核对完毕', checks: [true] }, taskId);
entries = taskResultEntries(snap, taskId, null);
assert.equal(entries[0].status, '已确认');
snap.collaboration!.tasks[taskId].requiresRevalidation = true;
assert.equal(taskResultEntries(snap, taskId, null)[0].status, '需重新核对');
snap.collaboration!.tasks[taskId].requiresRevalidation = false;
const sessionId = 'source-local';
snap.sessions[sessionId] = { id: sessionId, taskId, agentId: 'codex', title: '旅行来源', status: 'waiting_reply', rounds: [], runtime: {
  projectId: snap.project.id, taskId, runId: 'actual-runtime', purpose: 'execution', connection: { connectionId: 'codex-local', tool: 'codex', projectPath: '/test/project' },
} } as unknown as Session;
const direct = { id: 'reply', title: '回报', text: '[原件](./guide.pdf)', at: '2026-11-16T12:00:00Z', sessionId };
assert.equal(presentResult(snap, taskId, direct, true).runId, 'actual-runtime');
assert.equal(presentResult(snap, 'other-task', direct, true).runId, undefined, 'other task cannot borrow a local file binding');
snap.sessions[sessionId].runtime!.projectId = 'other-project';
assert.equal(presentResult(snap, taskId, direct, true).runId, undefined, 'other project cannot borrow a local file binding');
snap.sessions[sessionId].runtime!.projectId = snap.project.id;
const artifact = snap.collaboration!.artifacts[0];
artifact.runId = 'managed-run';
snap.collaboration!.executionLinks = [{ id: 'execution:managed-run', projectId: snap.project.id, taskId, taskKey: taskId,
  agentId: 'codex', tool: 'codex', connectionId: 'codex-local', sessionId, sourceSessionId: 'codex-thread', runId: 'managed-run', runtimeRunId: 'actual-runtime', at: '2026-11-16T12:00:00Z', provenance: 'receipt' }];
entries = taskResultEntries(snap, taskId, null);
assert.equal(entries[0].runId, 'actual-runtime', 'published artifact uses saved runtime receipt, never the managed run ID');
assert.equal(entries[0].sessionId, sessionId);
const unbound = structuredClone(snap) as Snapshot;
unbound.collaboration!.executionLinks = [];
assert.equal(taskResultEntries(unbound, taskId, null)[0].runId, undefined, 'no arbitrary latest-session fallback for a published result');
assert.equal(resultExcerpt(body), '曼谷两晚，芭提雅两晚。');
assert.equal(resultExcerpt('**明确结论**'.repeat(30), 20).length, 21);
console.log('result presentation: acceptance states, exact source bindings, full report and excerpts passed');
assert.equal(resultExcerpt('<quandeck-conclusion>{"summary":"先确认出发城市","confirmed":[],"open":["哪里出发？"]}</quandeck-conclusion>'), '先确认出发城市', 'protocol envelopes do not leak into task excerpts');
assert.equal(resultExcerpt('<quandeck-conclusion>{broken'), '回复格式待核对');


const versioned = structuredClone(snap);
const raw = versioned.sessions[sessionId];
const first = {id:'original',at:'2026-11-16T12:01:00Z',reply:'第一版，先去京都。'};
const second = {id:'revision',at:'2026-11-16T12:02:00Z',reply:'第二版，在京都多住一晚。'};
raw.rounds = [first];
versioned.tasks[taskId].sessionIds = [sessionId];
const replies = () => taskResultEntries(versioned,taskId,null).filter(entry => !entry.artifactId && entry.sessionId === sessionId);
const originalKey = replies()[0].record.id;
raw.runtime!.controlDeliveries = {'feedback:result-user-1':{status:'sent',fingerprint:'first',at:first.at,resultRoundId:first.id}};
raw.status = 'running';
assert.equal(replies()[0].record.id, originalKey, 'the original remains open while revising');
raw.rounds.push(second);
raw.status = 'waiting_reply';
const revisedKey = replies()[0].record.id;
assert.notEqual(revisedKey,originalKey);
assert.deepEqual(replies().map(entry=>entry.record.text),[second.reply,first.reply]);
raw.status = 'archived';
assert.deepEqual(replies().map(entry=>entry.record.id),[revisedKey,originalKey],'archiving keeps stable links to the exact rounds');

// An old link includes both the version and the deliverable key. Even after the contract changes,
// reconstruct the matching receipt only, never a sibling or the aggregate body of the newer version.
const historical = structuredClone(versioned);
const old = historical.collaboration!.artifacts[0];
const slot = {id:'route-map',title:'路线图',taskKey:taskId,taskId,planId:'travel-plan',
  contract:{revision:1,kind:'text' as const,format:'md',required:true,criteria:[]}};
const plan = {id:slot.planId,title:'行程',scope:'task' as const,taskId,version:1,draftVersion:1,at:old.createdAt,tasks:[],slots:[slot]};
historical.collaboration!.goalPlans = {[slot.planId]:[plan,{...plan,version:2,slots:[{...slot,contract:{...slot.contract,revision:2}}]}]};
old.deliveryReceipts=[{slotId:slot.id,contractRevision:1,kind:'text',format:'md',body:'历史路线 A → B',contentHash:'hash',bytes:17,verifiedAt:old.createdAt}];
const row = inboxRows([historical]).find(value=>value.task.id===taskId)!;
const pin='artifact:'+old.id+':'+slot.id;
const restored=inboxResultVersions(row,undefined,pin).find(entry=>entry.record.id===pin);
assert.equal(restored?.record.text,'历史路线 A → B','restore exact historical slot body even after contract changed');
assert.equal(restored?.artifactId,old.id);
const otherScope=inboxRows([historical],{projectId:historical.project.id,taskId,itemId:'unrelated-item'})[0];
assert.equal(inboxResultVersions(otherScope,'unrelated-item',pin).length,0,'other child cannot display a root version');
