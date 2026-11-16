import './delivery-presentation.test';
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
