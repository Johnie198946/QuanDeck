import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, buildContextPackage, type CollaborationCommand } from '../src/data/collaboration';
import { projectMemoryNotes, queryProjectLessons } from '../src/data/projectMemoryNotes';

// Regression for a new task receiving a predecessor’s confirmed, current experience.
const project = createEmptySnapshot({ id: 'memory-usability-audit', name: '社区开放日', description: '让现场志愿者接手续办' });
let sequence = 0;
function send(type: CollaborationCommand['type'], payload: Record<string, unknown>, taskId?: string) {
  const response = applyCollaboration(project, { projectId: project.project.id, idempotencyKey: 'audit-' + ++sequence,
    type, payload, taskId, expectedVersion: taskId ? project.collaboration!.tasks[taskId].version : undefined }, { kind: 'human' });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.resourceId!;
}
const task = (title: string, goal: string, dependencies: string[] = []) => send('create_task', { title, goal, owner: 'me', criteria: ['已核对'], dependencies });
function accepted(title: string, body: string) {
  const key = task(title, title);
  const submissionId = send('submit', { title, body }, key);
  send('review', { submissionId, verdict: 'accepted', checks: [true], note: '现场核验' }, key);
  return project.collaboration!.artifacts.find(a => a.key === key)!;
}
const artifact = accepted('先遣实测', '无信号时纸质票册可验票；现场留一名陪同人员。');
const lesson = { artifactId: artifact.id, artifactHash: artifact.hash, situation: '签到断网', action: '换用纸质票册', outcome: '无人滞留', limitation: '仅适用于入口有工作人员' };
const incoming = task('布置现场入口', '接手先遣组的检查', [artifact.key]);
const semanticallyRelated = task('来宾抵达时没有网络', '在脱机条件下核验参加资格');
const packetIds = (key: string) => (buildContextPackage(project, key).memoryLessons ?? []).map(n => n.id);
send('record_memory_note', { ...lesson, status: 'candidate' });
const draft = projectMemoryNotes(project)[0];
assert(!packetIds(incoming).includes(draft.id), 'candidate must not influence execution');
send('record_memory_note', { ...lesson, status: 'confirmed', noteId: draft.noteId, expectedRevision: 1 });
const confirmedId = projectMemoryNotes(project)[0].id;
assert(packetIds(incoming).includes(confirmedId), 'new dependent task must receive the accepted lesson');
const synonymHit = packetIds(semanticallyRelated).includes(confirmedId);
for (let i = 0; i < 2; i++) send('record_memory_note', { ...lesson, status: 'confirmed' });
const duplicateSlots = packetIds(incoming).length;
send('record_memory_note', { status: 'withdrawn', noteId: draft.noteId, expectedRevision: 2 });
assert(!packetIds(incoming).includes(confirmedId), 'withdrawn revision must disappear from the next packet');
const survivingCopies = packetIds(incoming).length;
send('reopen', { reason: '场地改变，重做实测' }, artifact.key);
assert.throws(() => packetIds(incoming), { code: 'SOURCE_STALE' }, 'stale required source must block dependent execution');
assert.equal(queryProjectLessons(project, incoming).length, 0, 'all lessons based on superseded source must stop being reused');

// Four eligible notes compete for the same three slots. Evaluate four fresh
// tasks so every note is the explicit prerequisite exactly once, independent
// of generated IDs and insertion order.
const topics = ['消防通道', '打印机房', '餐饮采购', '场馆供电'];
const sources = topics.map(topic => {
  const art = accepted(topic, topic + '值班手册');
  send('record_memory_note', { status: 'confirmed', situation: '值班检查', action: '复核' + topic,
    outcome: '按时交接', limitation: '仅限该班', artifactId: art.id, artifactHash: art.hash });
  return { key: art.key, note: projectMemoryNotes(project).find(n => n.source.artifactId === art.id)!.id };
});
let requiredLessonHits = 0;
for (const { key, note } of sources) {
  const taken = task('值班交接', '读取前置检查中的经验', [key]);
  const packet = buildContextPackage(project, taken);
  assert(packet.sources.some(s => s.taskKey === key && s.required), 'required source itself must not be lost');
  if (packet.memoryLessons?.some(n => n.id === note)) requiredLessonHits++;
}
assert(synonymHit, 'known offline expression should recall the field-tested workaround');
assert.equal(duplicateSlots, 1, 'duplicate recordings cannot displace distinct experience');
assert.equal(survivingCopies, 0, 'withdrawal must stop recommending duplicate recordings');
assert.equal(requiredLessonHits, sources.length, 'each directly related lesson must outrank incidental topic matches');
console.log('memory workflow: one distinct lesson, zero after withdrawal, all four direct sources and lessons retained; offline vocabulary matched');

// Three already-running events recorded their outcomes independently. The next
// event has the same operating conditions, and many tips on one prerequisite.
const group = accepted('团体入场安排', '包团到场，由两名志愿者核验');
const solo = accepted('小场次接待', '一个入口，一名志愿者');
function tip(source: typeof group, situation: string, action: string, limitation: string) {
  return send('record_memory_note', { status: 'confirmed', situation, action, limitation,
    outcome: '实际场次已验收', artifactId: source.id, artifactHash: source.hash });
}
const twoLanes = tip(group, '大型团体到场', '准备两个核验岗', '至少两名志愿者');
const oneLane = tip(solo, '单人值守入口签到', '使用单人签到表', '仅限小型场次');
const soloGoal = '单人值守入口签到，小型活动，核对签到表';
const events = ['首场', '第二场', '第三场'].map(name => {
  const key = task(name + '签到', soloGoal, [group.key]);
  send('build_context', {}, key);
  const pinned = project.collaboration!.contextPackages.at(-1)!.memoryLessons!;
  assert(pinned.some(n => n.id === oneLane) && pinned.some(n => n.id === twoLanes));
  return key;
});
const next = task('第四场签到', soloGoal, [group.key]);
for (const [i, key] of events.entries()) {
  const submission = send('submit', { title: '签到记录', body: '独岗实际接待完毕' }, key);
  send('review', { submissionId: submission, verdict: 'accepted', checks: [true], note: '当天实际值守一人' }, key);
  const delivered = project.collaboration!.artifacts.find(a => a.key === key)!;
  for (const [lessonId, effect, reason] of [
    [oneLane, 'helpful', '单人表已验证'],
    [twoLanes, 'inapplicable', '只有一人到岗'],
  ]) send('record_memory_feedback', { lessonId, effect, reason, artifactId: delivered.id, artifactHash: delivered.hash });
  if (i === 0) {
    assert.equal(packetIds(next)[0], oneLane);
    assert.match(buildContextPackage(project, next).prompt, /只有一人到岗/, 'one counterexample accompanies an offered tip');
  }
}
tip(group, '客车包团', '提前填团体表', '仅限团体');
tip(group, '高峰时段', '准备团体分流线', '仅限大客流');
const fifth = task('第五场签到', soloGoal, [group.key]);
const pack = buildContextPackage(project, fifth);
assert.equal(pack.memoryLessons?.[0].id, oneLane, 'validated method survives competition from several predecessor tips');
assert(!pack.memoryLessons?.some(n => n.id === twoLanes), 'repeated mismatch is suppressed in the matching context');
assert((pack.memoryLessons?.length ?? 0) <= 3);
assert(pack.sources.some(s => s.required && s.id === group.id) && pack.handoffPins?.some(p => p.required && p.artifactId === group.id),
  'the required deliverable and its handoff remain available independently of optional advice');
const large = task('组织大型团体到场', '几十辆客车抵达后双岗并行核验', [group.key]);
assert(packetIds(large).includes(twoLanes), 'small-event counterexamples do not retire a useful method in a different situation');
assert(!buildContextPackage(project, large).prompt.includes('只有一人到岗'));
assert.equal(project.collaboration!.decisions.length, 0, 'feedback cannot become a project requirement');
console.log('reuse: three accepted events, repeated counterexamples scoped, positive method first on fifth event; formal handoff and separate use case retained');

// A person's use of the word "done" is distinct from a reviewed deliverable.
async function manualReviewMemory() {
  const { SampleWorkdeckDataSource } = await import('../src/data/repository');
  const { exportCollaboration } = await import('../src/data/collaboration');
  const { buildProjectBrief } = await import('../src/data/projectMemory');
  const snapshot = createEmptySnapshot({ id: 'manual-rework-boundary', name: '说明页' });
  const db = new SampleWorkdeckDataSource({ snapshot, onPersist() {} });
  const projectId = snapshot.project.id;
  const act = async (type: CollaborationCommand['type'], payload: Record<string, unknown>, key?: string) => {
    const state = await db.load();
    return db.collaborate({ projectId, taskId:key, type, payload, expectedVersion:key ? state.collaboration!.tasks[key].version : undefined, idempotencyKey:crypto.randomUUID() });
  };
  const makeTask = async (title:string) => (await act('create_task', { title, goal:title, criteria:['读者能读懂'], owner:'me' })).resourceId!;
  const source = await makeTask('简化新任务说明');
  const reader = await makeTask('核对新任务说明');
  const note = { situation:'新任务说明', action:'用日常语言解释', outcome:'读者能复述', limitation:'本页首次使用者' };
  const exportLessons = async () => JSON.parse(exportCollaboration(await db.load()).json).lessons.map((n:{id:string})=>n.id);
  assert((await db.addTaskInput(projectId, source, '我做完了，等现场确认。','manual-status')).ok);
  const draft = await db.saveTaskOutput({projectId, taskId:source, title:'第一稿', body:'已完成说明草稿，仍待读者验证。', status:'draft'});
  assert(draft.ok);
  assert(!(await db.load()).collaboration!.artifacts.length);
  assert.equal((await act('record_memory_note',{...note, artifactId:draft.outputId, status:'confirmed'})).code,'MEMORY_SOURCE_CHANGED');
  const submit = async (body:string) => {
    const result = await db.saveTaskOutput({ id:draft.outputId, projectId, taskId:source, title:'说明', body, status:'published' });
    assert(result.ok, result.message);
    const state = (await db.load()).collaboration!;
    const submission = state.submissions.find(s => s.id === state.tasks[source].latestSubmissionId)!;
    return {submission, artifact:state.artifacts.find(a => a.id === submission.artifactId)!};
  };
  const first = await submit('本稿已完成，待核对。');
  const promote = (item:typeof first.artifact,status:string) => act('record_memory_note',{...note, status, artifactId:item.id, artifactHash:item.hash});
  assert.equal((await promote(first.artifact,'confirmed')).code,'MEMORY_SOURCE_CHANGED');
  const reason = '没看懂。你讲简单点。';
  const review = await act('review',{ submissionId:first.submission.id, verdict:'needs_changes', checks:[false],note:reason },source);
  assert(review.ok,review.message);
  const returned = await db.load();
  assert.equal(returned.collaboration!.tasks[source].status,'ready');
  assert.equal((await promote(first.artifact,'candidate')).code,'MEMORY_SOURCE_CHANGED');
  assert.equal(buildContextPackage(returned,reader).memoryLessons?.length,0);
  assert(!buildContextPackage(returned,reader).prompt.includes(reason));
  assert(!returned.collaboration!.decisions.length && !returned.collaboration!.memoryNotes?.length);
  const retry = buildContextPackage(returned,source);
  assert(retry.prompt.includes(reason) && retry.prompt.includes(review.resourceId!) && retry.prompt.includes(first.artifact.id), 'same-task retry must receive reviewer wording and exact source');
  assert(buildProjectBrief(returned).entries.find(e=>e.key===source)!.nextSteps.some(text=>text.includes(reason)));
  const revised = await submit('先选一个目标，再选“讨论方案”。');
  assert(!buildContextPackage(await db.load(),source).prompt.includes(reason), 'the previous rejected submission no longer controls its replacement');
  assert((await act('review',{submissionId:revised.submission.id,verdict:'accepted',checks:[true],note:'读者能复述'},source)).ok);
  assert(!(await db.load()).collaboration!.memoryNotes?.length, 'acceptance never auto-promotes to a lesson');
  const candidate = await promote(revised.artifact,'candidate');
  assert(candidate.ok);
  assert.deepEqual(await exportLessons(),[], 'default machine memory must exclude draft lessons');
  assert(!buildContextPackage(await db.load(),reader).memoryLessons?.length);
  const pending = projectMemoryNotes(await db.load())[0];
  const confirmed = await act('record_memory_note',{...note,status:'confirmed',noteId:pending.noteId,expectedRevision:pending.revision,artifactId:revised.artifact.id,artifactHash:revised.artifact.hash});
  assert(confirmed.ok && (await exportLessons()).includes(confirmed.resourceId));
  assert(buildContextPackage(await db.load(),reader).memoryLessons?.some(n=>n.id===confirmed.resourceId));
  assert((await act('reopen',{reason:'要求更新'},source)).ok);
  assert.deepEqual(await exportLessons(),[], 'stale lessons stay in reflection history only');
  assert(!buildContextPackage(await db.load(),reader).memoryLessons?.length);
  console.log('manual memory: input/draft, submission, rejected review in scoped retry, revision, acceptance, confirmed pin, stale export exclusion');
}
manualReviewMemory().catch(error => { console.error(error); process.exitCode = 1; });
