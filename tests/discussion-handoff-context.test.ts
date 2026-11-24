import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { discussionContextIssue } from '../src/data/discussionContext';
import { applyCollaboration, buildContextPackage, type CollaborationCommand } from '../src/data/collaboration';
import type { RuntimeDriver, RuntimeRunInput } from '../src/data/runtimeContracts';
import type { Snapshot } from '../src/data/types';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
let serial = 0;
function command(snapshot: Snapshot, type: CollaborationCommand['type'], payload: Record<string, unknown>, taskId?: string) {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, type, taskId, expectedVersion: taskId ? snapshot.collaboration!.tasks[taskId].version : undefined, payload, idempotencyKey: `discussion-handoff-${++serial}` }, { kind: 'human' });
  assert(result.ok, result.message); return result;
}

async function run() {
  const source = new LocalWorkdeckDataSource(), calls: RuntimeRunInput[] = [];
  const driver: RuntimeDriver = { subscribe: () => () => {}, scan: async () => [], control: async () => {}, listRuns: () => [], run: async input => { calls.push(input); return { runId: `discussion-run-${calls.length}`, sessionId: `discussion-source-${calls.length}`, connectionId: input.connectionId, acceptedAt: new Date().toISOString() }; } };
  const runtime = createRuntimeDataSource(source, driver);
  const projectId = (await source.createProject({ name: 'Bound planning handoff' })).projectId!;
  await source.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#111111' });
  await runtime.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'bound-planning', projectPath: '/bound-planning-fixture' });
  let upstream = '', pending = '';
  const fullBody = '21E validated source ' + 'detail '.repeat(1000) + 'FULL_SOURCE_TAIL_21E';
  source.mutateRuntimeProject(projectId, snapshot => {
    upstream = command(snapshot, 'create_task', { title: '21E', goal: 'Provide inherited evidence', criteria: ['Verified'], owner: 'me' }).resourceId!;
    const submitted = command(snapshot, 'submit', { title: '21E original', body: fullBody, handoff: { summary: 'Complete source handoff', completed: ['Source checked'], decisions: ['Rule 21E'], remaining: [], nextSteps: ['Use for the target plan'] } }, upstream).resourceId!;
    command(snapshot, 'review', { submissionId: submitted, verdict: 'accepted', checks: [true], note: 'Checked' }, upstream);
    const artifact = snapshot.collaboration!.artifacts.find(a => a.key === upstream)!;
    command(snapshot, 'record_memory_note', { status:'confirmed', artifactId:artifact.id, artifactHash:artifact.hash, situation:'14D discussion target', action:'verify scope', outcome:'checked', limitation:'one revision' });
    pending = command(snapshot, 'create_task', { title: 'Future independent input', goal: 'Not ready', criteria: ['later'], owner: 'me' }).resourceId!;
    for (let index = 0; index < 12; index++) {
      const unrelated = command(snapshot, 'create_task', { title: `14D discussion unrelated ${index}`, goal: 'Related keyword distractor', criteria: ['ready'], owner: 'me' }).resourceId!;
      const candidate = command(snapshot, 'submit', { title: `14D discussion ${index}`, body: 'Unrelated history' }, unrelated).resourceId!;
      command(snapshot, 'review', { submissionId: candidate, verdict: 'accepted', checks: [true], note: 'Checked' }, unrelated);
    }
  });
  const transferred = await source.createTaskFromHandoff(projectId, { sourceTaskKey: upstream, title: '14D discussion target', idempotencyKey: 'new-target' });
  assert(transferred.ok, transferred.message);
  const target = transferred.taskId!;
  source.mutateRuntimeProject(projectId, snapshot => {
    command(snapshot, 'set_dependencies', { dependencies: [upstream, pending] }, target);
    command(snapshot, 'record_decision', { text: 'Retain the 14D evidence boundary', kind: 'constraint' }, target);
  });
  const planId = await source.ensureTaskPlan(target);
  const contract=await source.applyDeliveryChange(projectId,{planId:`delivery:${target}`,taskId:target,expectedVersion:0,idempotencyKey:'discussion-contract',reason:'明确本任务输出',operations:[{type:'add',slot:{id:'target-output',title:'说明文件',taskKey:target,contract:{revision:1,kind:'file',format:'md',required:true,criteria:['保留来源']}}}]});assert(contract.ok,contract.message);
  const result = await runtime.startDiscussion(planId, 'codex');
  assert(result.ok, result.message); assert.equal(calls.length, 1);
  let snapshot = await source.load();
  const session = snapshot.sessions[result.sessionId!];
  const fixed = snapshot.collaboration!.contextPackages.find(context => context.id === session.runtime!.collaboration!.contextPackageId)!;
  const targetTask = snapshot.collaboration!.tasks[target];
  const targetSpec = snapshot.collaboration!.specs.find(spec => spec.key === target && spec.revision === targetTask.specRevision)!;
  assert.equal(calls[0].purpose, 'discussion');
  assert.equal(fixed.discussionTarget!.key, target);assert.equal(fixed.discussionTarget!.deliverables?.length,1);assert.equal(fixed.discussionTarget!.deliverables![0].contract!.format,'md');assert.match(calls[0].prompt,/说明文件/);
  assert.equal(fixed.discussionTarget!.specId, targetSpec.id);
  assert.equal(fixed.discussionTarget!.specRevision, targetTask.specRevision);
  assert.equal(fixed.discussionTarget!.goal, targetSpec.goal);
  assert.deepEqual(fixed.discussionTarget!.criteria, targetSpec.criteria);
  assert(fixed.constraints.some(condition => condition.text === 'Retain the 14D evidence boundary'));
  const required = fixed.sources.find(item => item.taskKey === upstream)!;
  assert(required.required && !required.truncated);
  assert.equal(required.excerpt, fullBody, 'a large mandatory source is never truncated to the optional 2000-character excerpt');
  assert(fixed.handoffPins!.find(pin => pin.key === upstream)!.required, 'the complete exact source handoff is pinned even during planning');
  assert(calls[0].prompt.includes('FULL_SOURCE_TAIL_21E') && calls[0].prompt.includes('Use for the target plan'));
  assert(!fixed.sources.some(item => item.taskKey === pending), 'unfinished unrelated input is not fabricated into accepted evidence and does not prevent planning');
  assert.equal(snapshot.collaboration!.tasks[target].activeRunId, undefined, 'discussion does not claim or execute the business task');
  assert.equal(calls[0].sourceSessionId, undefined);
  const lesson = snapshot.collaboration!.memoryNotes![0];
  assert(fixed.memoryLessons?.some(pin => pin.id === lesson.id));
  const changed = structuredClone(snapshot);
  command(changed, 'record_memory_note', { status:'confirmed', artifactId:lesson.source.artifactId, artifactHash:lesson.source.hash, situation:'Another non-pinned tip', action:'store notice', outcome:'checked', limitation:'none' });
  assert.equal(discussionContextIssue(changed, session), undefined, 'unrelated new lessons do not interrupt a discussion');
  command(changed, 'record_memory_note', { status:'withdrawn', noteId:lesson.noteId, expectedRevision:1 });
  assert.match(discussionContextIssue(changed, session)!, /经验/, 'withdrawn pins cannot silently govern the next round');

  source.mutateRuntimeProject(projectId, draft => {
    command(draft, 'reopen', { reason: 'Source revised' }, upstream);
    const changed = command(draft, 'submit', { title: '21E revised', body: 'New source revision' }, upstream).resourceId!;
    command(draft, 'review', { submissionId: changed, verdict: 'accepted', checks: [true], note: 'Checked revision' }, upstream);
  });
  snapshot = await source.load();
  assert.throws(() => buildContextPackage(snapshot, fixed.key), error => (error as { code: string }).code === 'HANDOFF_SOURCE_CHANGED', 'planning cannot silently switch the transferred source to a newer accepted revision');
  const section = snapshot.ideaPlans![planId].draft.sections[0].id;
  const rejected = await runtime.startDiscussion(planId, 'codex', section);
  assert(!rejected.ok && rejected.message?.includes('交接来源已变化'), rejected.message);
  assert.equal(calls.length, 1, 'a source changed during preparation is rejected before a new source conversation starts');
  const stalePlan = structuredClone(snapshot);
  stalePlan.ideaPlans![planId].draftVersion++;
  assert.throws(() => buildContextPackage(stalePlan, fixed.key), error => (error as { code: string }).code === 'DISCUSSION_SCOPE_CHANGED');
  runtime.dispose();
  console.log('discussion handoff context: fixed task spec/conditions, mandatory complete source/handoff, pending dependency, source-change and stale-scope gates');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
