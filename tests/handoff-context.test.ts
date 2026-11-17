import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, hashText, taskKey, type CollaborationCommand } from '../src/data/collaboration';
import { createTaskFromHandoffIn } from '../src/data/taskHandoffTransfer';
import { deriveTaskHandoffs } from '../src/data/taskHandoff';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeRunInput } from '../src/data/runtimeContracts';
import type { Snapshot } from '../src/data/types';

let serial = 0;
const command = (snapshot: Snapshot, type: CollaborationCommand['type'], payload: Record<string, unknown>, taskId?: string) => {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, idempotencyKey: 'handoff-context-' + ++serial, type, taskId, expectedVersion: taskId ? snapshot.collaboration?.tasks[taskId]?.version : undefined, payload }, { kind: 'human' });
  assert(result.ok, result.message); return result;
};
function setup() {
  const snapshot = createEmptySnapshot({ id: 'context-project', name: 'Fixed handoff context' });
  const source = command(snapshot, 'create_task', { title: '21E source', goal: 'Keep the project rule', criteria: ['has rule'], owner: 'me' }).resourceId!;
  const submitted = command(snapshot, 'submit', { title: 'Rule', body: 'Use deep blue marker 17.', handoff: { summary: 'Rule verified in task 21E', completed: ['Checked source'], decisions: ['Use deep blue marker'], remaining: [], nextSteps: ['Apply rule in target'] } }, source).resourceId!;
  command(snapshot, 'review', { submissionId: submitted, verdict: 'accepted', checks: [true], note: 'Verified against required rule' }, source);
  const target = createTaskFromHandoffIn(snapshot, snapshot.project.id, { sourceTaskKey: source, title: '14D target', idempotencyKey: 'new-14d' });
  assert(target.ok, target.message); return { snapshot, source, target: target.taskId! };
}
{
  const { snapshot, source, target } = setup();
  const before = JSON.stringify(snapshot.collaboration!.handoffs);
  const context = buildContextPackage(snapshot, target);
  const transfer = snapshot.collaboration!.handoffTransfers![0], record = snapshot.collaboration!.handoffs![0];
  assert.equal(context.handoffPins!.length, 1);
  assert.deepEqual(context.handoffPins![0], { id: record.id, key: source, submissionId: record.submissionId, artifactId: record.artifactId, artifactHash: record.artifactHash, contentHash: record.contentHash, hash: record.hash, origin: 'recorded', reviewStatus: 'accepted', reviewId: transfer.sourceReviewId, required: true });
  for (const text of ['Rule verified in task 21E', 'Checked source', 'Apply rule in target', 'deep blue marker 17']) assert(context.prompt.includes(text));
  assert.equal(context.hash, hashText(context.prompt));
  assert.equal(context.projectMemory!.entries.length, Object.values(snapshot.collaboration!.tasks).filter(task => !task.archived).length);
  assert.equal(context.projectMemory!.sourceSequence, snapshot.collaboration!.sequence);
  assert.equal(context.projectMemory!.hash, hashText(JSON.stringify({ sourceSequence: context.projectMemory!.sourceSequence, entries: context.projectMemory!.entries })));
  assert.equal(context.projectMemory!.entries.find(task => task.key === target)!.summary, '尚未提交任务总结与交接');
  assert.equal(context.projectMemory!.entries.find(task => task.key === source)!.handoff!.id, record.id);
  assert.equal(JSON.stringify(snapshot.collaboration!.handoffs), before, 'context assembly never mutates published memory');
  const cloned = structuredClone(snapshot);
  cloned.collaboration!.handoffs![0].content.summary = 'tampered memory';
  assert.throws(() => buildContextPackage(cloned, target), error => (error as {code:string}).code === 'HANDOFF_SOURCE_CHANGED');
  const moved = structuredClone(snapshot);
  moved.project.id = 'different-project';
  assert.throws(() => buildContextPackage(moved, target), error => (error as {code:string}).code === 'HANDOFF_SOURCE_CHANGED');
  command(snapshot, 'reopen', { reason: 'Rule revision' }, source);
  const updated = command(snapshot, 'submit', { title: 'New rule', body: 'Use green marker 18.' }, source).resourceId!;
  command(snapshot, 'review', { submissionId: updated, verdict: 'accepted', checks: [true], note: 'Verified against required rule' }, source);
  assert.throws(() => buildContextPackage(snapshot, target), error => (error as {code:string}).code === 'HANDOFF_SOURCE_CHANGED', 'a transferred target never silently follows a newly accepted source');
}
{
  const { snapshot, source } = setup();
  delete snapshot.collaboration!.handoffs;
  delete snapshot.collaboration!.handoffTransfers;
  const target = command(snapshot, 'create_task', { title: 'Legacy target', goal: 'Apply old evidence', criteria: ['has source'], owner: 'agent', dependencies: [source] }).resourceId!;
  const before = JSON.stringify(snapshot);
  const context = buildContextPackage(snapshot, target);
  assert.equal(context.handoffPins![0].origin, 'legacy-derived');
  assert.equal(context.handoffPins![0].reviewStatus, 'accepted');
  assert(context.prompt.includes('历史记录派生'));
  assert.equal(JSON.stringify(snapshot), before, 'legacy memory is read-only deterministic projection');
  assert.equal(context.handoffPins![0].hash, deriveTaskHandoffs(snapshot, [source])[0].record.hash);
}
{
  const { snapshot, source } = setup();
  command(snapshot, 'reopen', { reason: 'Detailed summary' }, source);
  const result = command(snapshot, 'submit', { title: 'Long summary', body: 'Full result body', handoff: { summary: 'x'.repeat(900), completed: [], decisions: [], remaining: [], nextSteps: [] } }, source).resourceId!;
  command(snapshot, 'review', { submissionId: result, verdict: 'accepted', checks: [true], note: 'Verified against required rule' }, source);
  const independent = command(snapshot, 'create_task', { title: 'Unrelated task', goal: 'Separate business work', criteria: ['done'], owner: 'agent' }).resourceId!;
  const context = buildContextPackage(snapshot, independent), entry = context.projectMemory!.entries.find(item => item.key === source)!;
  assert.equal(entry.summary.length, 500); assert.equal(entry.summaryTotalChars, 900); assert.equal(entry.summaryTruncated, true);
  assert(context.prompt.includes('项目任务记忆索引'), 'the source receives fixed project memory even without matching optional evidence keywords');
}

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
async function runtimeTransfer() {
  const calls: RuntimeRunInput[] = [];
  let unknown = false;
  const driver: RuntimeDriver = {
    subscribe: () => () => {}, control: async () => ({}), scan: async () => [],
    run: async input => { calls.push(input); if (unknown) throw new Error('provider acknowledgement lost'); return { ...input, runId: 'run-' + calls.length, sessionId: 'source-' + calls.length, acceptedAt: new Date().toISOString() }; },
  };
  const base = new LocalWorkdeckDataSource(), source = createRuntimeDataSource(base, driver);
  try {
    const projectId = (await source.createProject({ name: 'Handoff runtime' })).projectId!;
    await source.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#123456' });
    await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'c', projectPath: '/fixture' });
    let upstream = '';
    base.mutateRuntimeProject(projectId, snapshot => {
      snapshot.defaultAgent = 'codex';
      upstream = command(snapshot, 'create_task', { title: '21E', goal: 'rule', criteria: ['rule'], owner: 'me' }).resourceId!;
      const result = command(snapshot, 'submit', { title: 'Rule', body: 'Rule: deep blue 17' }, upstream).resourceId!;
      command(snapshot, 'review', { submissionId: result, verdict: 'accepted', checks: [true], note: 'Verified against required rule' }, upstream);
    });
    const input = { sourceTaskKey: upstream, title: '14D', execute: true, idempotencyKey: 'execute-14d' };
    const [a, b] = await Promise.all([source.createTaskFromHandoff(projectId, input), source.createTaskFromHandoff(projectId, input)]);
    assert(a.ok && b.ok, a.message); assert.equal(a.taskId, b.taskId); assert.equal(a.sessionId, b.sessionId); assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceSessionId, undefined);
    assert(calls[0].prompt.includes('deep blue 17') && calls[0].prompt.includes('固定任务交接'));
    assert.equal((await source.createTaskFromHandoff(projectId, input)).sessionId, a.sessionId);
    assert.equal(calls.length, 1);
    const snapshot = await source.load(), session = snapshot.sessions[a.sessionId!];
    const context = snapshot.collaboration!.contextPackages.find(item => item.id === session.runtime!.collaboration!.contextPackageId)!;
    assert.equal(context.prompt, calls[0].prompt); assert.equal(context.handoffPins!.length, 1);
    let root = '';
    base.mutateRuntimeProject(projectId, value => { root = command(value, 'create_task', { title: 'Parent with children', goal: 'Apply the source through child work', criteria: ['assembled'], owner: 'agent' }).resourceId!; });
    const child = await source.addManualSubtask(root, root, 'Child applies inherited source'); assert(child.ok, child.message);
    const targetVersion = (await source.load()).collaboration!.tasks[root].version;
    const transferred = await source.createTaskFromHandoff(projectId, { sourceTaskKey: upstream, targetTaskKey: root, expectedTargetVersion: targetVersion, title: 'Parent with children', idempotencyKey: 'parent-transfer' });
    assert(transferred.ok, transferred.message);
    const dispatchedChild = await source.dispatchWork(root, child.itemId!, 'codex'); assert(dispatchedChild.ok, dispatchedChild.message);
    const withChild = await source.load(), childKey = taskKey(root, child.itemId);
    const childContext = withChild.collaboration!.contextPackages.find(item => item.key === childKey)!;
    const inherited = withChild.collaboration!.handoffTransfers!.find(item => item.targetTaskKey === root)!;
    assert(childContext.sources.some(item => item.id === inherited.sourceArtifactId && item.required));
    assert(childContext.handoffPins!.some(item => item.id === inherited.sourceHandoffId && item.required));
    assert(calls[1].prompt.includes('deep blue 17'), 'a child receives the fixed root transfer before its own new conversation');
    const startedScope = await source.createTaskFromHandoff(projectId, { sourceTaskKey: upstream, targetTaskKey: root,
      expectedTargetVersion: withChild.collaboration!.tasks[root].version, title: 'Parent with children', idempotencyKey: 'started-child-rebind' });
    assert.equal(startedScope.code, 'HANDOFF_TARGET_STARTED', 'a parent with an executing child is not an unstarted target');
    const legacyFixture = structuredClone(withChild);
    const legacyTarget = command(legacyFixture, 'create_task', { title: 'Legacy business task', goal: 'keep historical context', criteria: ['preserve'], owner: 'agent' }).resourceId!;
    legacyFixture.sessions['legacy-business'] = { ...session, id: 'legacy-business', taskId: legacyTarget, runtime: undefined };
    const legacyInput = { sourceTaskKey: upstream, targetTaskKey: legacyTarget, expectedTargetVersion: legacyFixture.collaboration!.tasks[legacyTarget].version,
      title: 'Legacy business task', idempotencyKey: 'legacy-business-rebind' };
    assert.equal(createTaskFromHandoffIn(legacyFixture, projectId, legacyInput).code, 'HANDOFF_TARGET_STARTED', 'legacy execution without a managed run must not bypass the guard');
    const changed = structuredClone(withChild);
    command(changed, 'mark_stale', { artifactId: inherited.sourceArtifactId, reason: 'Source changed after transfer' }, upstream);
    assert.throws(() => buildContextPackage(changed, childKey), error => (error as {code:string}).code === 'HANDOFF_SOURCE_CHANGED');
    unknown = true;
    const lostInput = { ...input, title: '15E', idempotencyKey: 'execute-15e' };
    const lost = await source.createTaskFromHandoff(projectId, lostInput);
    assert.equal(lost.ok, false); assert(lost.taskId && lost.transferId && lost.sessionId);
    const replay = await source.createTaskFromHandoff(projectId, lostInput);
    assert.equal(replay.ok, false); assert.equal(replay.sessionId, lost.sessionId); assert.equal(calls.length, 3, 'unknown acceptance is never automatically replayed');
  } finally { source.dispose(); }
}
runtimeTransfer().then(() => console.log('handoff context: exact provenance, tamper/version guards, legacy projection and idempotent runtime transfer passed')).catch(error => { console.error(error); process.exitCode = 1; });
