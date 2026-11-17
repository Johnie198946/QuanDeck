import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage } from '../src/data/collaboration';
import { createTaskFromHandoffIn } from '../src/data/taskHandoffTransfer';

const snapshot = createEmptySnapshot({ id: 'handoff-project', name: '交接闭环' });
let serial = 0;
function command(type: Parameters<typeof applyCollaboration>[1]['type'], payload: Record<string, unknown>, taskId?: string) {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id,
    idempotencyKey: `transfer-test-${++serial}`, type, taskId,
    expectedVersion: taskId ? snapshot.collaboration?.tasks[taskId]?.version : undefined, payload }, { kind: 'human' });
  assert(result.ok, result.message);
  return result;
}
const source = command('create_task', { title: '21E：规范', goal: '保存已核对规则', criteria: ['可核对'], owner: 'me' }).resourceId!;
const input = { sourceTaskKey: source, title: '14D：应用规则', goal: '根据上游规范产生示例', idempotencyKey: 'transfer-1' };
assert.equal(createTaskFromHandoffIn(snapshot, 'foreign', input).code, 'PROJECT_MISMATCH');
assert.equal(createTaskFromHandoffIn(snapshot, snapshot.project.id, input).code, 'HANDOFF_SOURCE_NOT_READY');
assert.equal(createTaskFromHandoffIn(snapshot, snapshot.project.id, { ...input, sourceHandoffHash: 'forged' } as typeof input).code, 'SCHEMA_INVALID');
const submission = command('submit', { title: '规范 v1', body: '本项目唯一标记：深蓝 17。规则必须显示来源。' }, source).resourceId!;
assert.equal(createTaskFromHandoffIn(snapshot, snapshot.project.id, input).code, 'HANDOFF_SOURCE_NOT_READY');
command('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '规则已核对' }, source);
const result = createTaskFromHandoffIn(snapshot, snapshot.project.id, input);
assert(result.ok, result.message);
const target = result.taskId!;
assert.notEqual(target, source);
assert.deepEqual(snapshot.collaboration!.tasks[target].dependencies, [source]);
assert.deepEqual(snapshot.tasks[target].sessionIds, [], 'new task must not inherit the old conversation');
const transfer = snapshot.collaboration!.handoffTransfers![0];
assert.equal(transfer.targetTaskKey, target);
assert.equal(transfer.sourceArtifactId, snapshot.collaboration!.tasks[source].acceptedArtifactId);
assert.equal(transfer.sourceReviewId, snapshot.collaboration!.reviews.at(-1)!.id);
assert(transfer.sourceHandoffId && transfer.sourceHandoffHash);
const beforeReplay = Object.keys(snapshot.tasks).length;
const replay = createTaskFromHandoffIn(snapshot, snapshot.project.id, input);
assert.equal(replay.taskId, target);
assert.equal(replay.replayed, true);
assert.equal(Object.keys(snapshot.tasks).length, beforeReplay);
assert.equal(snapshot.collaboration!.handoffTransfers!.length, 1);
assert.equal(createTaskFromHandoffIn(snapshot, snapshot.project.id, { ...input, goal: 'changed' }).code, 'IDEMPOTENCY_CONFLICT');
const context = buildContextPackage(snapshot, target);
assert(context.sources.some(source => source.id === transfer.sourceArtifactId && source.required));
assert(context.prompt.includes('深蓝 17'));
command('mark_stale', { artifactId: transfer.sourceArtifactId, reason: '来源需要重核' }, source);
assert.throws(() => buildContextPackage(snapshot, target), /交接|前置|失效|来源/);
assert.equal(createTaskFromHandoffIn(snapshot, snapshot.project.id, { ...input, idempotencyKey: 'transfer-stale' }).code, 'HANDOFF_SOURCE_NOT_READY');
assert.equal(snapshot.collaboration!.handoffTransfers!.length, 1);
console.log('task handoff transfer: accepted pins, fresh task, replay, forged fields and stale sources passed');
