import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, type CollaborationCommand } from '../src/data/collaboration';
import { projectMemoryNotes, queryProjectLessons } from '../src/data/projectMemoryNotes';
import { buildProjectBrief, buildScopedProjectMemory, renderProjectMemory } from '../src/data/projectMemory';

const snapshot = createEmptySnapshot({ id: 'memory-notes-fixture', name: '离线手册', description: '制作可交接的离线说明' });
let sequence = 0;
const command = (type: CollaborationCommand['type'], payload: Record<string, unknown>, key?: string) => applyCollaboration(snapshot, {
  projectId: snapshot.project.id, idempotencyKey: 'memory-test-' + ++sequence, type, payload,
  taskId: key, expectedVersion: key ? snapshot.collaboration?.tasks[key].version : undefined,
}, { kind: 'human' });
const source = command('create_task', { title: '核对手册规则', goal: '核对手册的离线规则', criteria: ['规则齐全'], owner: 'me' }).resourceId!;
const submission = command('submit', { title: '手册规则', body: '保留离线副本，缺失信息留空。' }, source).resourceId!;
const artifact = snapshot.collaboration!.artifacts.find(item => item.key === source)!;
const payload = { status: 'candidate', situation: '离线说明的交接', action: '先核对规则再制作页面', outcome: '发现了一个缺口', limitation: '仅适用于本项目，其他项目需重新核对', artifactId: artifact.id, artifactHash: artifact.hash };
assert.equal(command('record_memory_note', payload).code, 'MEMORY_SOURCE_CHANGED', 'unreviewed candidate cannot become experience evidence');
assert(command('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '合成规则逐条核对' }, source).ok);
assert.equal(command('record_memory_note', { ...payload, status: ['confirmed'] }).code, 'MEMORY_NOTE_INVALID');
const target = command('create_task', { title: '制作手册页面', goal: '依据规则制作页面', criteria: ['离线可读'], owner: 'me', dependencies: [source] }).resourceId!;
const input: CollaborationCommand = { projectId: snapshot.project.id, type: 'record_memory_note', idempotencyKey: 'fixed-note', payload };
assert.equal(applyCollaboration(snapshot, input, { kind: 'service' }).code, 'FORBIDDEN');
assert(applyCollaboration(snapshot, input, { kind: 'human' }).ok);
assert(applyCollaboration(snapshot, input, { kind: 'human' }).replayed);
assert.equal(snapshot.collaboration!.memoryNotes!.length, 1);
assert.equal(queryProjectLessons(snapshot, target).length, 0, 'candidate reflection is not effective memory');
const original = projectMemoryNotes(snapshot)[0];
assert.equal(command('record_memory_note', { ...payload, noteId: original.noteId, expectedRevision: 0, status: 'confirmed' }).code, 'VERSION_CONFLICT');
assert(command('record_memory_note', { ...payload, noteId: original.noteId, expectedRevision: 1, status: 'confirmed' }).ok);
assert.equal(queryProjectLessons(snapshot, target).length, 1);
assert.equal(snapshot.collaboration!.decisions.length, 0, 'experience does not create project requirements');
assert(buildContextPackage(snapshot, target).memoryLessons?.some(note => note.id === projectMemoryNotes(snapshot)[0].id), 'actual packet includes relevant confirmed experience');
const chineseTarget = command('create_task', { title: '改造任务输入框交互', goal: '优化输入界面', criteria: ['简洁'], owner: 'me' }).resourceId!;
assert(command('record_memory_note', { ...payload, status: 'confirmed', situation: '紧凑的任务输入框' }).ok);
assert(queryProjectLessons(snapshot, chineseTarget).some(note => note.situation === '紧凑的任务输入框'), 'Chinese related experience is discoverable without exact whole phrase');

assert.equal(snapshot.collaboration!.tasks[target].status, 'ready', 'reflection never starts work');
const effective = projectMemoryNotes(snapshot)[0];
assert.equal(effective.revision, 2);
assert.equal(snapshot.collaboration!.memoryNotes![0].hash, original.hash, 'revision does not rewrite history');
assert.equal(command('record_memory_note', { ...payload, artifactHash: 'wrong' }).code, 'MEMORY_SOURCE_CHANGED');

const scoped = buildScopedProjectMemory(snapshot, [target, source]);
const brief = renderProjectMemory(snapshot);
for (let n = 0; n < 25; n++) command('create_task', { title: '无关事项 ' + n, goal: '无关原文不应进入当前上下文', owner: 'me', criteria: ['记录'] });
assert.equal(buildScopedProjectMemory(snapshot, [target, source]).hash, scoped.hash, 'unrelated tasks do not alter scoped memory');
assert.equal(buildProjectBrief(snapshot).entries.length, 8, 'human entrypoint has a bounded list');
assert(buildProjectBrief(snapshot).coverage.omittedTasks > 0);
assert(!buildProjectBrief(snapshot).projectSpec?.sections.length);
assert(brief.includes('去哪里查'));
const other = createEmptySnapshot({ id: 'other-project', name: '另一项目' });
assert.equal(applyCollaboration(other, input, { kind: 'human' }).code, 'PROJECT_MISMATCH');
assert.equal(projectMemoryNotes(other).length, 0);

// Observations without proof are private to reflection, including on a matching task.
const observed = command('record_memory_observation',{text:'离线突发事件：UNVERIFIED_SENTINEL'});
assert(observed.ok);
assert.equal(command('record_memory_observation',{text:'离线突发事件：UNVERIFIED_SENTINEL'}).resourceId,observed.resourceId);
assert.equal(snapshot.collaboration!.memoryObservations!.length,1);
assert(!buildContextPackage(snapshot,target).prompt.includes('UNVERIFIED_SENTINEL'));
assert(command('record_memory_note',{...payload,observationId:observed.resourceId,situation:'为突发事件保留替代路线'}).ok);
assert(!queryProjectLessons(snapshot,target).some(n => n.observationId === observed.resourceId));

// Repeat saves from independent forms don't take retrieval slots.
const again = command('record_memory_note',{...payload,status:'confirmed',action:'  '+payload.action+'  '});
assert(again.ok && again.resourceId === effective.id);
assert.equal(queryProjectLessons(snapshot,target).filter(n => n.noteId === effective.noteId).length,1);

// Only a pinned lesson from this exact accepted task can receive outcome feedback.
const alternate = command('record_memory_note',{...payload,status:'confirmed',situation:'A '+effective.situation});
assert(alternate.ok);
const equallyRelevant = command('create_task',{title:'制作手册页面',goal:'依据规则制作页面',criteria:['已核对'],owner:'me',dependencies:[source]}).resourceId!;
const relativeRank = () => queryProjectLessons(snapshot,equallyRelevant).map(n=>n.id).filter(id=>id===alternate.resourceId || id===effective.id);
assert.deepEqual(relativeRank(),[alternate.resourceId,effective.id],'no implicit boost without evidence');
const feedbackPacket = command('build_context',{},target);
assert(feedbackPacket.context?.memoryLessons?.some(n => n.id === effective.id));
const subTarget = command('submit',{title:'交接页面',body:'人工离线核验完整'},target).resourceId!;
const downstream = snapshot.collaboration!.artifacts.find(a => a.key === target)!;
const feedback = {effect:'helpful',reason:'断网时顺利展示',lessonId:effective.id,artifactId:downstream.id,artifactHash:downstream.hash};
assert.equal(command('record_memory_feedback',feedback).code,'MEMORY_SOURCE_CHANGED');
assert(command('review',{submissionId:subTarget,verdict:'accepted',checks:[true],note:'离线通过'},target).ok);
assert.equal(command('record_memory_feedback',{...feedback,lessonId:'unknown'}).code,'MEMORY_SOURCE_CHANGED');
assert.equal(command('record_memory_feedback',{...feedback,artifactHash:'wrong'}).code,'MEMORY_SOURCE_CHANGED');
assert.equal(command('record_memory_feedback',{...feedback,effect:'unknown'}).code,'MEMORY_NOTE_INVALID');
assert(command('record_memory_feedback',feedback).ok);
assert(command('record_memory_feedback',feedback).ok);
assert.equal(snapshot.collaboration!.memoryFeedback!.length,1);
assert.deepEqual(relativeRank(),[effective.id,alternate.resourceId],'positive effect can break relevance ties');
assert(command('reopen',{reason:'修改手册测试要求'},target).ok);
assert.deepEqual(relativeRank(),[alternate.resourceId,effective.id],'superseded outcome cannot boost retrieval');
assert.equal(command('record_memory_feedback',{...feedback,effect:'adjust'}).code,'MEMORY_SOURCE_CHANGED');

assert(command('reopen', { reason: '原规则需要改动' }, source).ok);
assert(projectMemoryNotes(snapshot)[0].stale, 'source changes invalidate derived experience');
assert.equal(queryProjectLessons(snapshot, target).length, 0);
assert(command('record_memory_note', { noteId: effective.noteId, expectedRevision: 2, status: 'withdrawn' }).ok, 'stale reflection can still be withdrawn');
assert.equal(projectMemoryNotes(snapshot)[0].status, 'withdrawn');
assert.equal(queryProjectLessons(snapshot, target).length, 0);
console.log('memory notes: provenance, candidate authority, revision CAS, withdrawal, isolation and bounded briefs passed');
