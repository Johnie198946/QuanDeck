import assert from 'node:assert/strict';
import { applyCollaboration, ensureCollaboration, type CollaborationCommand } from '../src/data/collaboration';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { deliveryReview, deliveryReviewCommand } from '../src/data/deliveryReview';
import { taskProgressTrail } from '../src/data/taskProgressTrail';
import { unfinishedReviewChildren } from '../src/data/reviewScope';

const snapshot = createEmptySnapshot({ id: 'review-scope', name: '验收范围测试' });
let sequence = 0;
function command(type: CollaborationCommand['type'], payload: Record<string, unknown>, key?: string) {
  const task = key ? snapshot.collaboration!.tasks[key] : undefined;
  return applyCollaboration(snapshot, { projectId: snapshot.project.id, type, payload,
    taskId: task?.taskId, workItemId: task?.workItemId, expectedVersion: task?.version,
    idempotencyKey: `readiness-${++sequence}` }, { kind: 'human' });
}
const created = command('create_task', { title: '父任务', goal: '整合三项子任务', criteria: ['目标满足'], owner: 'me' });
assert(created.ok, created.message);
const root = created.resourceId!;
snapshot.orchestrations[root] = { taskId: root, label: '父任务', startedAt: snapshot.now, syncedAt: snapshot.now,
  coordinationTokens: null, phases: ['执行'], executors: {}, items: {}, itemOrder: [], attempts: {},
  capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false } };
const orchestration = snapshot.orchestrations[root];
for (const [id, parent] of [['branch', root], ['nested', 'branch'], ['sibling', root]]) {
  orchestration.items[id] = { id, rootTaskId: root, parentTaskId: parent, title: id, phase: '执行',
    dependsOnTaskIds: [], owner: 'me', executorId: null, status: 'not_started', attemptIds: [] };
  orchestration.itemOrder.push(id);
}
ensureCollaboration(snapshot);
function submit(key: string) {
  const result = command('submit', { title: '候选', body: '当前范围的候选正文' }, key);
  assert(result.ok, result.message);
  const submission = snapshot.collaboration!.submissions.find(s => s.id === result.resourceId)!;
  return submission.artifactId;
}
const artifactId = submit(root);
const view = deliveryReview(snapshot, artifactId)!;
assert.equal(view.unfinishedChildren.length, 3);
assert(!view.canAccept, 'three unfinished children disable parent acceptance before clicking');
assert.match(view.reason, /还有 3 项子任务未结束/);
assert(view.reviewable, 'requesting changes remains possible');
assert.throws(() => deliveryReviewCommand(snapshot, artifactId, 'accepted', [true], '核对'), /3 项子任务/);
assert.equal(deliveryReviewCommand(snapshot, artifactId, 'needs_changes', [false], '请先补齐子任务').payload!.verdict, 'needs_changes');
const rejected = command('review', { submissionId: view.submission!.id, verdict: 'accepted', checks: [true], note: '绕过前端' }, root);
assert(!rejected.ok);
assert.equal(rejected.code, 'CHILDREN_NOT_DONE');
assert.notEqual(snapshot.collaboration!.tasks[root].status, 'done');

const leafArtifact = submit(`${root}::nested`);
assert(deliveryReview(snapshot, leafArtifact)!.canAccept, 'an independent leaf can be reviewed while siblings remain unfinished');
const before = JSON.stringify(snapshot);
let progress = taskProgressTrail(snapshot, { taskId: root });
assert.equal(progress.current.label, '仍需推进');
assert.equal(progress.unfinished, 1, 'count terminal tasks once, not parent summaries');
assert.match(progress.current.detail, /不能整体验收/);
assert.equal(JSON.stringify(snapshot), before, 'projections do not accept work or rewrite lifecycle');
const refreshed = JSON.parse(JSON.stringify(snapshot));
assert(!deliveryReview(refreshed, artifactId)!.canAccept, 'refresh preserves the gate');
assert.equal(taskProgressTrail(refreshed, { taskId: root }).current.label, '仍需推进');

snapshot.collaboration!.tasks[`${root}::branch`].status = 'done';
assert.equal(unfinishedReviewChildren(snapshot, snapshot.collaboration!.tasks[root]).length, 2, 'a closed direct parent cannot hide unfinished descendants');
snapshot.collaboration!.tasks[`${root}::nested`].status = 'cancelled';
snapshot.collaboration!.tasks[`${root}::sibling`].archived = true;
assert(deliveryReview(snapshot, artifactId)!.canAccept, 'cancelled and archived children do not block acceptance');
snapshot.collaboration!.submissions.find(s => s.id === view.submission!.id)!.unresolved = ['缺少验证记录'];
assert(!deliveryReview(snapshot, artifactId)!.canAccept, 'unslotted unresolved work also blocks acceptance');
assert.match(deliveryReview(snapshot, artifactId)!.reason, /未解决事项/);
console.log('Review readiness: unfinished descendants, sibling isolation, partial delivery, refresh and backend rejection passed');
