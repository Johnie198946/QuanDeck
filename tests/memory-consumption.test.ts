import { verifyDiscussionMemory } from './discussion-memory-assertions';
import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { buildContextPackage, type CollaborationCommand } from '../src/data/collaboration';
import { feedbackOptions, projectMemoryNotes } from '../src/data/projectMemoryNotes';
import { obsoleteSessionLessonNotice, providedSessionMemory } from '../src/data/discussionMemory';
import { readContextEvidence } from '../src/data/contextEvidence';
import { RUNTIME_SUBMISSION_VERSION } from '../src/data/runtimeSubmission';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';

async function verifyMemoryConsumption() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  let emit = (_event: RuntimeEvent) => {};
  const calls: RuntimeRunInput[] = [];
  const replies: Record<string, unknown>[] = [];
  const driver: RuntimeDriver = {
    subscribe(listener) { emit = listener; return () => {}; },
    control: async (_id, _action, payload) => { if (payload) replies.push(payload); }, scan: async () => [], listRuns: () => [],
    async run(input) {
      calls.push(input);
      return { runId: 'transport-' + calls.length, sessionId: 'session-' + calls.length,
        connectionId: input.connectionId, acceptedAt: new Date().toISOString() };
    },
  };
  const base = new LocalWorkdeckDataSource(), runtime = createRuntimeDataSource(base, driver);
  const projectId = (await base.createProject({ name: '松湾', description: '离线检票' })).projectId!;
  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'C', color: '#111111' });
  await runtime.bindRuntimeConnection('codex', { connectionId: 'isolated-memory', tool: 'codex', projectPath: '/synthetic' });
  async function command(type: CollaborationCommand['type'], payload: Record<string, unknown>, taskId?: string) {
    const t = taskId ? (await base.load()).collaboration!.tasks[taskId] : undefined;
    const result = await base.collaborate({ type, payload, projectId, taskId, expectedVersion: t?.version, idempotencyKey: crypto.randomUUID() });
    assert(result.ok, result.message); return result.resourceId!;
  }
  const task = (title: string) => command('create_task', { title, goal: title, criteria: ['现场核对'], owner: 'agent' });
  const annotate = (key: string, text: string, expectedRevision: number) =>
    command('write_task_annotation', {text, expectedRevision}, key);
  const upstream = await task('甲组');
  const marker = crypto.randomUUID();
  const sub = await command('submit', { title: '实测', body: '复核编号 ' + marker }, upstream);
  await command('review', { submissionId: sub, verdict: 'accepted', checks: [true], note: '已核对' }, upstream);
  const a = (await base.load()).collaboration!.artifacts[0];
  const noteId = await command('record_memory_note', { status: 'confirmed', artifactId: a.id, artifactHash: a.hash,
    situation: '断网验票', action: '值班人登记纸质票册', outcome: '已通过演练', limitation: '仅限现场双岗' });
  const supplyTask = await task('后勤');
  const supplyReport = await command('submit', { title: '设备演练', body: '设备记录' }, supplyTask);
  await command('review', { submissionId: supplyReport, verdict: 'accepted', checks: [true], note: '实测' }, supplyTask);
  const battery = (await base.load()).collaboration!.artifacts.find(item => item.key === supplyTask)!;
  const supply = await command('record_memory_note', { status: 'confirmed', artifactId: battery.id, artifactHash: battery.hash,
    situation: '电池更换', action: '蓝色箱配电池', outcome: '设备正常', limitation: '仅限新型号' });
  const planId = await base.ensureProjectPlan(projectId);
  const plan = (await base.load()).ideaPlans![planId];
  const begun = await runtime.sendDirectionMessage({ projectId, planId, scope: 'root', draftVersion: plan.draftVersion,
    agentId: 'codex', text: '请讨论如何更换电池', messageId: 'supply-question' });
  assert(begun.ok, begun.message);
  let snap = await base.load();
  verifyDiscussionMemory(snap, begun.sessionId!, planId, supply, noteId);
  const discussion = snap.collaboration!.contextPackages.at(-1)!;
  assert.equal(discussion.prompt, calls.at(-1)!.prompt);
  assert.deepEqual(discussion.memoryLessons?.map(pin => pin.id), [supply], 'the explicit question selects its own topic');
  assert.deepEqual(buildContextPackage(snap, discussion.key).memoryLessons?.map(pin => pin.id), [noteId],
    'without an explicit topic, project planning uses the project goal even with an opaque project name');
  const planner = snap.sessions[begun.sessionId!]!;
  const original = planner.runtime!.collaboration!;
  const waitForReply = (seq: number) => {
    emit({ id: 'discussion-wait-' + seq, runId: planner.runtime!.runId!, sessionId: planner.source!.sessionId,
      status: 'waiting_reply', sequence: seq, at: new Date().toISOString() });
    return runtime.flushRuntime();
  };
  await waitForReply(1);
  const secondQuestion = { projectId, planId, scope: 'root', draftVersion: plan.draftVersion,
    agentId: 'codex', text: '断网验票时应该采取什么办法？', messageId:'gate-followup' };
  const next = await runtime.sendDirectionMessage(secondQuestion);
  assert(next.ok, next.message);
  assert.equal(next.sessionId, begun.sessionId);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].displayPrompt, secondQuestion.text);
  assert.match(String(replies[0].prompt), /值班人登记纸质票册/);
  assert(!String(replies[0].prompt).includes('蓝色箱配电池'), 'different topic does not resend the old lesson');
  assert((await runtime.sendDirectionMessage(secondQuestion)).ok);
  assert.equal(replies.length, 1, 'an acknowledged followup is not sent again');
  snap = await base.load();
  const used = snap.sessions[planner.id].runtime!.controlDeliveries!['direction:gate-followup'];
  assert.equal(used.status, 'sent');
  assert(used.sentAt && Date.parse(used.sentAt) >= Date.parse(used.at), 'acknowledgement time is written after transport confirms');
  assert.deepEqual(used.memoryLessons?.map(pin => pin.id), [noteId]);
  assert.deepEqual(snap.collaboration!.contextPackages.find(p => p.id === original.contextPackageId)!.memoryLessons?.map(pin => pin.id), [supply], 'supplement never rewrites the original packet');
  const followupRead = {projectId, contextPackageId:original.contextPackageId, artifactId:a.id, hash:a.hash};
  assert.equal(readContextEvidence(snap, followupRead, original).text, '复核编号 ' + marker);
  const uncertain = structuredClone(snap);
  uncertain.sessions[planner.id].runtime!.controlDeliveries!['direction:gate-followup'].status = 'unknown';
  assert.throws(() => readContextEvidence(uncertain, followupRead, original), {code:'SOURCE_NOT_IN_CONTEXT'});
  const scopedTask = await task('安排电池更换');
  const planNote = await annotate(scopedTask, '路线图放在左栏', 0);
  const scopedPlan = await base.ensureTaskPlan(scopedTask);
  const setup = await base.load();
  const generic = {projectId, planId:scopedPlan, scope:'s-goal', draftVersion:setup.ideaPlans![scopedPlan].draftVersion,
    agentId:'codex', text:'你的方案是什么', messageId:'section-question'};
  assert((await runtime.sendDirectionMessage(generic)).ok);
  const scoped = await base.load();
  const sectionPackage = scoped.collaboration!.contextPackages.at(-1)!;
  assert.match(calls.at(-1)!.prompt, /路线图放在左栏/);
  assert.equal(sectionPackage.taskAnnotationPins?.[0]?.id, planNote);
  const replacement = await annotate(scopedTask, '路线图放在右栏', 1);
  const planningSession = scoped.sessions[scoped.collaboration!.runs[sectionPackage.runId!].sessionId!];
  emit({id:'scoped-plan-wait',sequence:1,status:'waiting_reply',runId:planningSession.runtime!.runId!,
    sessionId:planningSession.source!.sessionId,at:new Date().toISOString()});
  await runtime.flushRuntime();
  assert((await runtime.sendDirectionMessage({...generic,text:'再核对一下布局',messageId:'revise-layout'})).ok);
  assert.match(String(replies.at(-1)!.prompt), /路线图放在右栏/);
  assert(!String(replies.at(-1)!.prompt).includes('路线图放在左栏'));
  assert.equal((await base.load()).sessions[planningSession.id].runtime!.controlDeliveries!['direction:revise-layout'].taskAnnotationPins?.[0].id,replacement);
  assert.deepEqual(sectionPackage.memoryLessons?.map(p => p.id), [supply], 'broad questions follow the current section goal');
  assert.deepEqual(buildContextPackage(scoped, sectionPackage.key, {discussionTopic:'请说明周围湖泊水质'}).memoryLessons, [], 'an explicit topic change may yield zero matches');
  const reader = await task('离线检票');
  const readerNote = await annotate(reader, '检票标记用墨蓝', 0);
  assert.deepEqual(buildContextPackage(await base.load(),reader,{sourceIds:[]}).memoryLessons, [],
    'an explicitly narrowed source list does not widen through a lesson');
  const started = await runtime.dispatch(reader, 'codex');
  assert(started.ok, started.message);
  snap = await base.load();
  const received = calls.at(-1)!, session = snap.sessions[snap.tasks[reader].sessionIds[0]];
  const fixed = snap.collaboration!.contextPackages.find(p => p.id === received.collaboration!.contextPackageId)!;
  assert.equal(received.prompt, fixed.prompt);
  assert.equal(fixed.taskAnnotationPins?.[0].id, readerNote);
  assert(fixed.taskAnnotationPins?.[0].author);
  assert.match(received.prompt, /检票标记用墨蓝/);
  assert(!received.prompt.includes('路线图放在右栏'), 'unrelated task notes stay out of the prompt');
  assert(!received.prompt.includes(marker), 'evidence body is fetched on demand');
  assert(!fixed.sources.some(s => s.id === a.id), 'lesson matched without incidental raw-source retrieval');
  assert.deepEqual(fixed.memoryLessons?.map(pin => pin.id), [noteId]);
  assert.equal(snap.collaboration!.memoryFeedback?.length ?? 0, 0, 'delivery does not imply adoption');

  const progress = async (sequence: number, data: Partial<RuntimeEvent>) => {
    emit({id:'execution-' + sequence, sequence, runId:session.runtime!.runId!, sessionId:session.source!.sessionId!,
      at:new Date().toISOString(), ...data});
    await runtime.flushRuntime();
  };
  await progress(1, {status:'waiting_permission', request:{id:'allow-device-test', kind:'permission', prompt:'是否允许检查电池？'}});
  const readerRevision = await annotate(reader, '检票标记用松绿', 1);
  assert((await runtime.controlSession(session.id, 'reply', {requestId:'allow-device-test',decision:'approved'})).ok);
  assert(!String(replies.at(-1)!.prompt).includes('相关项目经验'), 'a permission response never receives memory advice');
  assert(!String(replies.at(-1)!.prompt).includes('检票标记'), 'a note is never a tool permission response');
  await progress(2, {status:'waiting_reply', requestResolved:'allow-device-test', request:{id:'arrival-time', kind:'question', prompt:'选定时间？'}});
  assert((await runtime.controlSession(session.id, 'reply', {requestId:'arrival-time', prompt:'电池更换后再到场'})).ok);
  assert.equal(replies.at(-1)!.prompt, '电池更换后再到场', 'preserve the exact human answer');
  await progress(3, {status:'waiting_reply', requestResolved:'arrival-time'});
  assert.deepEqual(providedSessionMemory(await base.load(),session.id).map(x=>x.note.id),[noteId]);
  const extra = '还需安排电池更换，有什么现场做法？';
  assert((await runtime.controlSession(session.id, 'reply', {prompt:extra})).ok);
  assert.equal(replies.at(-1)!.displayPrompt,extra);
  assert.match(String(replies.at(-1)!.prompt), /蓝色箱配电池/);
  assert(!String(replies.at(-1)!.prompt).includes('值班人登记纸质票册'));
  const withSupplement = await base.load();
  assert.match(String(replies.at(-1)!.prompt), /检票标记用松绿/);
  assert(!String(replies.at(-1)!.prompt).includes('检票标记用墨蓝'));
  assert(Object.values(withSupplement.sessions[session.id].runtime!.controlDeliveries!).some(d =>
    d.status === 'sent' && d.taskAnnotationPins?.some(pin => pin.id === readerRevision && pin.key === reader && pin.revision === 2)));
  assert.equal(fixed.taskAnnotationPins?.[0].id, readerNote);
  assert.deepEqual(providedSessionMemory(withSupplement,session.id).map(x=>x.note.id),[noteId,supply]);
  const supplyRead = {projectId, contextPackageId:fixed.id, artifactId:battery.id, hash:battery.hash};
  assert.equal(readContextEvidence(withSupplement, supplyRead, received.collaboration!).text, '设备记录');
  const unknown = structuredClone(withSupplement);
  const supplement = Object.values(unknown.sessions[session.id].runtime!.controlDeliveries!).find(v => v.memoryLessons?.length)!;
  supplement.status='unknown';
  assert.throws(() => readContextEvidence(unknown,supplyRead,received.collaboration!), {code:'SOURCE_NOT_IN_CONTEXT'});

  // This deterministic consumer only sees the transmitted prompt and its bound evidence API.
  const lessonLine = received.prompt.split('\n').find(line => line.startsWith('{"id":"memory-note:'))!;
  const lesson = JSON.parse(lessonLine);
  const binding = received.collaboration!;
  const request = { projectId, contextPackageId: binding.contextPackageId, artifactId: lesson.source.artifactId, hash: lesson.source.hash };
  const answer = await base.readEvidenceForAgent(request, binding) as { text: string };
  assert.equal(answer.text, '复核编号 ' + marker);
  const legacy = structuredClone(snap);
  delete legacy.collaboration!.contextPackages.find(p => p.id === fixed.id)!.memoryLessons![0].sourceArtifactId;
  assert.throws(() => readContextEvidence(legacy, request, binding), { code: 'SOURCE_NOT_IN_CONTEXT' });
  assert.throws(() => readContextEvidence(snap, {...request, hash: 'wrong'}, binding), {code: 'SOURCE_NOT_IN_CONTEXT'});
  assert.throws(() => readContextEvidence(snap, {...request, projectId: 'other'}, binding), {code: 'READ_SCOPE_REVOKED'});
  const consumerBody = [lesson.action, lesson.limitation, answer.text].join('。');
  emit({ id: 'result', runId: session.runtime!.runId!, sessionId: session.source!.sessionId,
    at: new Date().toISOString(), sequence: 4, status: 'done', submission: {
      schemaVersion: RUNTIME_SUBMISSION_VERSION, binding, idempotencyKey: 'candidate-with-evidence', kind: 'result',
      payload: { title: '现场便签', body: consumerBody, sourceIds: [request.artifactId,battery.id] },
    } });
  await runtime.flushRuntime();
  snap = await base.load();
  const result = snap.collaboration!.submissions.find(x => x.key === reader)!;
  assert(result, JSON.stringify(snap.sessions[snap.tasks[reader].sessionIds[0]].runtime!.submissionReceipts));
  const artifact = snap.collaboration!.artifacts.find(x => x.id === result.artifactId)!;
  assert.equal(artifact.body, '值班人登记纸质票册。仅限现场双岗。复核编号 ' + marker);
  assert.deepEqual(artifact.sourceIds, [a.id,battery.id]);
  assert.deepEqual(feedbackOptions(snap, artifact.id), [], 'candidate output alone cannot improve the lesson rating');
  await command('review', { submissionId: result.id, verdict:'accepted', checks:[true], note:'编号和适用条件均正确' }, reader);
  const acceptedSnapshot = await base.load();
  assert.deepEqual(feedbackOptions(acceptedSnapshot, artifact.id).map(x=>x.note.id), [noteId,supply], 'the original and follow-up tips may be assessed against the accepted outcome');
  const late = structuredClone(acceptedSnapshot);
  const delayed = Object.values(late.sessions[session.id].runtime!.controlDeliveries!).find(v => v.memoryLessons?.length)!;
  delayed.sentAt = new Date(Date.parse(result.at) + 1000).toISOString();
  assert.deepEqual(feedbackOptions(late, artifact.id).map(x=>x.note.id),[noteId], 'a delivery acknowledged later is not attributed to an earlier submission');
  const feedback = { lessonId: noteId, artifactId: artifact.id, artifactHash: artifact.hash,
    effect:'helpful', reason:'双岗登记使用该做法，并复核了原始编号' };
  await command('record_memory_feedback', feedback); await command('record_memory_feedback', feedback);
  assert.equal((await base.load()).collaboration!.memoryFeedback!.length, 1);
  const reviewKey = await command('create_task',{title:'B42',goal:'离线验票',owner:'me',criteria:['核对表格']});
  const reviewNote = await annotate(reviewKey, '检票示例要写现场时间', 0);
  const reviewId = await command('submit',{title:'候选表格',body:'仅供复核'},reviewKey);
  const independent = await runtime.startReview(reviewId,'codex');
  assert(independent.ok, independent.message);
  const reviewCall = calls.at(-1)!;
  assert.equal(reviewCall.purpose,'review');
  assert.match(reviewCall.prompt, /检票示例要写现场时间/);
  assert(!reviewCall.prompt.includes('检票标记用松绿'));
  assert.equal((await base.load()).collaboration!.contextPackages.at(-1)?.taskAnnotationPins?.[0].id,reviewNote);
  assert.match(reviewCall.prompt, /值班人登记纸质票册/, 'independent review selects lessons for the candidate’s business goal');
  assert.equal((await base.load()).collaboration!.tasks[reviewKey].status,'in_review');
  // An older run may have started with an explicitly empty source list.
  // Its packet has no record of that choice, so new turns must preserve its evidence boundary.
  const limited = await task('在午后整理海报');
  assert((await runtime.dispatch(limited,'codex')).ok);
  const current = await base.load(), legacyRun = current.sessions[current.tasks[limited].sessionIds[0]];
  const legacyContextId = legacyRun.runtime!.collaboration!.contextPackageId;
  base.mutateRuntimeProject(projectId, d => {
    const historical = d.collaboration!.contextPackages.find(pack => pack.id === legacyContextId)!;
    assert.deepEqual(historical.memoryLessons,[]);
    delete historical.lessonSourceScope;
  });
  emit({id:'legacy-wait',sequence:1,runId:legacyRun.runtime!.runId!,sessionId:legacyRun.source!.sessionId!,
    at:new Date().toISOString(),status:'waiting_reply'});
  await runtime.flushRuntime();
  assert((await runtime.controlSession(legacyRun.id,'reply',{prompt:extra})).ok);
  assert.equal(replies.at(-1)!.prompt,extra);
  const resumedPin = await annotate(limited, '下次展示先放海报样图', 0);
  emit({id:'legacy-pause',sequence:2,runId:legacyRun.runtime!.runId!,sessionId:legacyRun.source!.sessionId!,
    at:new Date().toISOString(),status:'paused'});
  await runtime.flushRuntime();
  assert((await runtime.controlSession(legacyRun.id,'resume')).ok);
  assert.match(String(replies.at(-1)!.prompt),/下次展示先放海报样图/);
  assert(Object.values((await base.load()).sessions[legacyRun.id].runtime!.controlDeliveries!).some(
    row => row.status === 'sent' && row.taskAnnotationPins?.[0]?.id === resumedPin));
  const other = await task('离线检票');
  assert((await runtime.dispatch(other, 'codex')).ok);
  const second = calls.at(-1)!.collaboration!;
  await command('record_memory_note',{status:'withdrawn',noteId:snap.collaboration!.memoryNotes!.find(n=>n.id===lesson.id)!.noteId,expectedRevision:lesson.revision});
  await assert.rejects(base.readEvidenceForAgent({...request,contextPackageId:second.contextPackageId},second), {code:'SOURCE_NOT_IN_CONTEXT'});
  assert(!buildContextPackage(await base.load(),other).memoryLessons?.some(p=>p.id===noteId));
  await assert.rejects(base.readEvidenceForAgent(followupRead, original), {code:'SOURCE_NOT_IN_CONTEXT'});
  const sentBeforeWithdrawal = replies.length;
  await waitForReply(2);
  assert(!(await runtime.sendDirectionMessage({...secondQuestion,messageId:'withdrawn-followup'})).ok, 'a withdrawn turn supplement invalidates the previous discussion');
  assert.equal(replies.length, sentBeforeWithdrawal);

  // Delete actual source tasks while independent consumers keep their acknowledged sessions.
  assert((await base.deleteTask(upstream, projectId)).ok);
  const continuing = await task('更换电池');
  assert((await runtime.dispatch(continuing, 'codex')).ok);
  const beforeDeletion = await base.load();
  const bindingBeforeDeletion = calls.at(-1)!.collaboration!;
  const boundSource = { ...supplyRead, contextPackageId: bindingBeforeDeletion.contextPackageId };
  const sourceBeforeDeletion = await base.readEvidenceForAgent(boundSource, bindingBeforeDeletion) as { text: string };
  assert.equal(sourceBeforeDeletion.text, '设备记录');
  const executing = beforeDeletion.sessions[beforeDeletion.tasks[continuing].sessionIds[0]];
  const section = beforeDeletion.sessions[beforeDeletion.collaboration!.runs[sectionPackage.runId!].sessionId!];
  assert((await base.deleteTask(supplyTask, projectId)).ok);
  const reloaded = await new LocalWorkdeckDataSource().load();
  assert.equal(reloaded.tasks[supplyTask], undefined);
  assert(projectMemoryNotes(reloaded).find(n => n.id === supply)?.stale);
  assert.deepEqual(providedSessionMemory(reloaded, executing.id).map(x => x.note.id), [supply]);
  assert(obsoleteSessionLessonNotice(reloaded, session.id).includes(supply), 'also correct an acknowledged supplement');
  const unknownDelivery = structuredClone(reloaded);
  const priorSupplement = Object.values(unknownDelivery.sessions[session.id].runtime!.controlDeliveries!)
    .find(receipt => receipt.memoryLessons?.some(pin => pin.id === supply))!;
  priorSupplement.status = 'unknown';
  assert(!obsoleteSessionLessonNotice(unknownDelivery, session.id).includes(supply));
  await assert.rejects(base.readEvidenceForAgent(boundSource, bindingBeforeDeletion), { code: 'SOURCE_NOT_IN_CONTEXT' });
  assert.deepEqual(feedbackOptions(reloaded, artifact.id), []);
  for (const open of [executing, section]) {
    emit({ id: 'after-deletion-' + open.id, sequence: 1, runId: open.runtime!.runId!, sessionId: open.source!.sessionId,
      at: new Date().toISOString(), status: 'waiting_reply' });
    await runtime.flushRuntime();
  }
  const changeRequest = async (sequence: number, data: Partial<RuntimeEvent>) => {
    emit({ id: 'after-deletion-request-' + sequence, sequence, runId: executing.runtime!.runId!,
      sessionId: executing.source!.sessionId, at: new Date().toISOString(), ...data });
    await runtime.flushRuntime();
  };
  await changeRequest(2, { status: 'waiting_permission', request: { id: 'device', kind: 'permission', prompt: '允许检查？' } });
  assert((await runtime.controlSession(executing.id, 'reply', { requestId: 'device', decision: 'approved' })).ok);
  assert(!String(replies.at(-1)!.prompt).includes(supply));
  await changeRequest(3, { status: 'waiting_reply', requestResolved: 'device', request: { id: 'time', kind: 'question', prompt: '几点？' } });
  assert((await runtime.controlSession(executing.id, 'reply', { requestId: 'time', prompt: '下午两点' })).ok);
  assert.equal(replies.at(-1)!.prompt, '下午两点');
  await changeRequest(4, { status: 'waiting_reply', requestResolved: 'time' });
  const continuationText = '请继续给出更换电池的办法';
  assert((await runtime.controlSession(executing.id, 'reply', { prompt: continuationText })).ok);
  assert.equal(replies.at(-1)!.displayPrompt, continuationText);
  assert(String(replies.at(-1)!.prompt).includes(supply), 'the open execution receives the obsolete version ID');
  assert.match(String(replies.at(-1)!.prompt), /已失效/);
  assert(!String(replies.at(-1)!.prompt).includes('蓝色箱配电池'));
  const sentBeforeDeletedDiscussion = replies.length;
  const closed = await runtime.sendDirectionMessage({ ...generic, messageId: 'deleted-source-followup' });
  assert.equal(closed.ok, false);
  assert.match(closed.message!, /失效/);
  assert.equal(replies.length, sentBeforeDeletedDiscussion);
  const newTask = await task('更换电池');
  assert((await runtime.dispatch(newTask, 'codex')).ok);
  assert(!calls.at(-1)!.prompt.includes(supply));
  const newPlan = await base.ensureTaskPlan(newTask);
  const newVersion = (await base.load()).ideaPlans![newPlan].draftVersion;
  assert((await runtime.sendDirectionMessage({ ...generic, planId: newPlan, draftVersion: newVersion,
    text: '如何更换电池？', messageId: 'fresh-after-deletion' })).ok);
  assert(!calls.at(-1)!.prompt.includes(supply));
  runtime.dispose();
  console.log('memory consumption: scoped discussion, dispatch, on-demand source, cited candidate, acceptance, measured feedback, withdrawal and source deletion across open and fresh sessions passed');
}
verifyMemoryConsumption().catch(error => { console.error(error); process.exitCode = 1; });
