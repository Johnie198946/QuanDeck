import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource, readAgentConclusion } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeReceipt, RuntimeRunRecord, RuntimeAction, ObservedRuntimeSession } from '../src/data/runtimeContracts';
import { completedResults } from '../src/data/results';
import { visibleIntervals } from '../src/data/timeline';
import { deriveProjectActivity } from '../src/data/projectActivity';

// A deterministic transport double checks the business contract, not CLI compatibility.
class Driver implements RuntimeDriver {
  listener = (_event: RuntimeEvent) => {};
  calls: RuntimeRunInput[] = [];
  records: RuntimeRunRecord[] = [];
  controls: {runId: string; action: RuntimeAction; payload?: Record<string, unknown>}[] = [];
  recovered: unknown[] = [];
  observed: ObservedRuntimeSession[] = [];
  rejectNext = false;
  early = false;
  controlError = false;
  clock = Date.now() + 2000;
  subscribe(listener: (event: RuntimeEvent) => void) { this.listener = listener; return () => { this.listener = () => {}; }; }
  async run(input: RuntimeRunInput): Promise<RuntimeReceipt> {
    this.calls.push(input);
    const record = { ...input, runId: `run-${this.calls.length}`, sessionId: `source-${this.calls.length}`, connectionId: input.connectionId, acceptedAt: new Date(this.clock++).toISOString(), acceptance: 'acknowledged' as const, events: [] as RuntimeEvent[], status: 'queued' as const };
    this.records.push(record);
    if (this.rejectNext) { this.rejectNext = false; throw Object.assign(new Error('CLI unavailable'), { rejected: true }); }
    if (this.early) { this.emit(record.runId, { status: 'running' }); this.emit(record.runId, { step: { completed: 1, total: 3, label: 'read files' }, tokens: 12 }); }
    await Promise.resolve();
    return record;
  }
  emit(runId: string, values: Partial<RuntimeEvent>) {
    const record = this.records.find(r => r.runId === runId)!;
    const event: RuntimeEvent = { id: `event-${runId}-${record.events!.length}`, sequence: record.events!.length + 1, at: new Date(this.clock += 60000).toISOString(), runId, sessionId: record.sessionId, ...values };
    record.events!.push(event); if (event.status) record.status = event.status;
    this.listener(event); return event;
  }
  async control(runId: string, action: RuntimeAction, payload?: Record<string, unknown>) {
    this.controls.push({ runId, action, payload });
    if (this.controlError) throw new Error('request was not accepted');
    if (action === 'stop') this.emit(runId, { status: 'paused' });
    if (action === 'resume') this.emit(runId, { status: 'running' });
    if (action === 'cancel') this.emit(runId, { status: 'cancelled' });
    if (action === 'archive') this.emit(runId, { status: 'done' });
    if (action === 'reply') this.emit(runId, { requestResolved: String(payload?.requestId) });
  }
  scan = async () => ({ sessions: this.observed });
  listRuns = () => this.records;
  async recover(input: RuntimeRunInput & Partial<RuntimeReceipt>) { this.recovered.push(input); }
  async adopt(input: RuntimeRunInput & {sourceSessionId: string}) {
    const observed = this.observed.find(s => s.sessionId === input.sourceSessionId && s.connectionId === input.connectionId)!;
    if (!observed) throw new Error('source not found');
    const record: RuntimeRunRecord = { ...input, runId: `adopted-${input.sourceSessionId}`, sessionId: input.sourceSessionId, acceptedAt: observed.updatedAt, status: 'paused', events: [] };
    this.records.push(record); return record;
  }
}

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key),
} });
async function main() {
  const base = new LocalWorkdeckDataSource(), driver = new Driver(), source = createRuntimeDataSource(base, driver);
  assert.deepEqual((await source.load()).tasks, {}); assert.equal(source.demo, undefined);
  const a = (await source.createProject({ name: 'Project A' })).projectId!;
  assert((await source.collaborate({ projectId: a, idempotencyKey: 'integration-policy', type: 'set_policy', payload: { maxParallel: 20, projectTokens: 1000000 } })).ok);
  await source.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#123456' });
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-a', projectPath: '/a' });
  const block = await source.addBlock('task', 'Build real runtime');
  const taskId = ((await source.load()).journal.blocks.find(b => b.id === block) as {taskId: string}).taskId;
  driver.early = true;
  const [first, duplicate] = await Promise.all([source.dispatch(taskId, 'codex'), source.dispatch(taskId, 'codex')]);
  assert(first.ok && duplicate.ok); assert.equal(driver.calls.length, 1, 'double click sends once');
  await source.flushRuntime();
  let snapshot = await source.load();
  const sid = snapshot.tasks[taskId].sessionIds[0], runId = snapshot.sessions[sid].runtime!.runId!;
  assert.equal(snapshot.sessions[sid].status, 'running'); assert.equal(snapshot.sessions[sid].tokens, 12, 'early events replay');
  assert.equal(snapshot.sessions[sid].source!.sessionId, 'source-1');
  const b = (await source.createProject({ name: 'Project B' })).projectId!;
  const taskBBlock = await source.addBlock('task', 'B task');
  const taskB = ((await source.load()).journal.blocks.find(b => b.id === taskBBlock) as {taskId: string}).taskId;
  assert.equal((await source.dispatch(taskB, 'codex')).ok, false, 'project B never reuses project A directory');
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-b', projectPath: '/b' });
  const replyEvent = driver.emit(runId, { reply: { id: 'final-1', text: 'Built a real event bridge.' }, tokens: 100 });
  driver.emit(runId, { status: 'waiting_reply', step: { completed: 3, total: 3, label: 'completed turn' } });
  await source.flushRuntime();
  assert.equal((await source.load()).project.id, b, 'background receipt never changes selected project');
  snapshot = (await source.listProjects()).find(s => s.project.id === a)!;
  assert.equal(snapshot.sessions[sid].rounds.length, 1);
  assert.equal(snapshot.tasks[taskId].completion, null, 'turn end and 100 percent are not completion');
  driver.listener(replyEvent); await source.flushRuntime();
  assert.equal((await source.listProjects()).find(s => s.project.id === a)!.sessions[sid].rounds.length, 1, 'duplicate events do not duplicate rounds');
  await source.switchProject(a);
  const human = (await source.addManualSubtask(taskId, taskId, 'Check the result')).itemId!;
  assert((await source.controlSession(sid, 'archive')).ok);
  snapshot = await source.load();
  assert.equal(snapshot.sessions[sid].status, 'archived'); assert.equal(snapshot.tasks[taskId].completion, null, 'unfinished human branch blocks automatic parent completion');
  assert.equal(completedResults(snapshot, taskId, null)[0].text, 'Built a real event bridge.');
  assert((await source.saveTaskOutput({ taskId, workItemId: human, title: 'Manual check', body: 'Checked result against requested criteria', status: 'published', complete: true })).ok);
  assert.equal((await source.load()).tasks[taskId].completion, null, 'each task requires its own candidate and review');

  // Source final reply is a conclusion, with preserved source identity; discussion does not execute business work.
  const idea = await source.createIdea('我要去芭提雅');
  const discussion = await source.startDiscussion(idea.planId, 'codex');
  assert(discussion.ok && discussion.sessionId);
  const discussionSession = (await source.load()).sessions[discussion.sessionId!];
  driver.emit(discussionSession.runtime!.runId!, { reply: { id: 'discussion-final', text: '<quandeck-conclusion>{"summary":"先确定出行条件","confirmed":["目的地：芭提雅"],"open":["去几天？"]}</quandeck-conclusion>' } });
  driver.emit(discussionSession.runtime!.runId!, { status: 'waiting_reply' });
  await source.flushRuntime();
  snapshot = await source.load();
  const conclusion = snapshot.ideaPlans![idea.planId].discussion!.conclusions[0];
  assert.equal(conclusion.source, 'agent'); assert.equal(conclusion.sourceRef!.sessionId, discussionSession.source!.sessionId);
  assert.deepEqual(conclusion.confirmed, []); assert(conclusion.open.includes('Agent 提议，待用户确认：目的地：芭提雅')); assert.deepEqual(snapshot.tasks[idea.taskId].sessionIds, []);
  assert((await source.adoptDiscussionConclusion(idea.planId, conclusion.id)).ok);
  assert.equal(snapshot.tasks[idea.taskId].completion, null);
  assert.deepEqual(readAgentConclusion('ordinary reply'), { summary: 'ordinary reply', confirmed: [], open: [] });

  const childId = (await source.addManualSubtask(idea.taskId, idea.taskId, 'Research transport')).itemId!;
  assert((await source.dispatchWork(idea.taskId, childId, 'codex')).ok);
  snapshot = await source.load();
  const attempt = Object.values(snapshot.orchestrations![idea.taskId].attempts)[0], childRun = snapshot.sessions[attempt.sessionId].runtime!.runId!;
  driver.emit(childRun, { child: { id: 'nested', title: 'Check rail times', status: 'running', sessionId: 'real-child-session' } });
  driver.emit(childRun, { child: { id: 'nested', title: 'Check rail times', status: 'done', sessionId: 'real-child-session', reply: 'Rail times confirmed.', tokens: 42 } });
  driver.emit(childRun, { status: 'waiting_permission', request: { id: 'approve-1', kind: 'permission', prompt: 'Allow network access?' } });
  await source.flushRuntime(); snapshot = await source.load();
  const children = Object.values(snapshot.orchestrations![idea.taskId].items);
  assert(children.some(item => item.parentTaskId === childId && item.title === 'Check rail times'));
  assert(Object.values(snapshot.orchestrations![idea.taskId].attempts).some(run => run.rounds.some(round => round.reply === 'Rail times confirmed.')), 'unreviewed child output is preserved as a source reply');
  assert(!completedResults(snapshot, idea.taskId, null).some(result => result.text === 'Rail times confirmed.'), 'source child completion is not an accepted task result');
  // Actual source child states remain exclusive in records, task tree, progress and totals.
  for (const status of ['queued', 'running', 'paused', 'cancelled', 'failed', 'done'] as const) {
    const stateId = `stateful-child-${status}`, sourceId = `stateful-source-${status}`, title = `Source lifecycle ${status}`;
    driver.emit(childRun, { child: { id: stateId, title, status, sessionId: sourceId } });
    await source.flushRuntime(); const view = await source.load();
    const work = Object.values(view.orchestrations![idea.taskId].items).find(item => item.title === title)!;
    const execution = view.orchestrations![idea.taskId].attempts[work.attemptIds[0]];
    assert.equal(view.sessions[attempt.sessionId].subAgents.find(child => child.id === stateId)!.status, status);
    assert.equal(work.status, status === 'done' ? 'paused' : status === 'queued' ? 'not_started' : status); assert.equal(execution.status, status);
    const entry = deriveProjectActivity(view).entries.find(entry => entry.itemId === work.id);
    assert.equal(entry?.state, ['running', 'failed'].includes(status) ? status : undefined, 'ready/paused/cancelled must never masquerade as running or failed');
    assert.equal(Boolean(work.completedAt), false, 'provider state never replaces task review');
    if (['queued', 'paused', 'cancelled'].includes(status)) assert(!view.timeline!.intervals.some(interval => interval.workItemId === work.id && interval.end === null));
    // The same rule applies to an observed child without a projected task tree.
    const standalone = structuredClone(view); standalone.orchestrations = {};
    const standaloneEntry = deriveProjectActivity(standalone).entries.find(entry => entry.source?.childSessionId === sourceId);
    assert.equal(standaloneEntry?.state, ['queued', 'running', 'failed'].includes(status) ? status : undefined);
  }
  assert.equal((await source.controlSession(attempt.sessionId, 'reply', { requestId: 'stale', decision: 'allowed-once' })).ok, false);
  assert.equal(driver.controls.filter(c => c.action === 'reply').length, 0);
  assert((await source.controlSession(attempt.sessionId, 'reply', { requestId: 'approve-1', decision: 'allowed-once' })).ok);
  assert.equal((await source.load()).sessions[attempt.sessionId].runtime!.request, undefined);
  driver.emit(childRun, { status: 'waiting_permission', request: { id: 'parallel-a', kind: 'permission', prompt: 'A needs access', targetSessionId: 'child-a' } });
  driver.emit(childRun, { status: 'waiting_permission', request: { id: 'parallel-b', kind: 'permission', prompt: 'B needs access', targetSessionId: 'child-b' } });
  driver.emit(childRun, { status: 'running', step: { label: 'Another branch continues' } });
  await source.flushRuntime();
  assert.deepEqual(Object.keys((await source.load()).sessions[attempt.sessionId].runtime!.requests!), ['parallel-a', 'parallel-b'], 'running sibling cannot erase pending permission requests');
  assert((await source.controlSession(attempt.sessionId, 'reply', { requestId: 'parallel-a', decision: 'rejected' })).ok, 'older still-pending permission remains actionable');
  assert.deepEqual(Object.keys((await source.load()).sessions[attempt.sessionId].runtime!.requests!), ['parallel-b']);
  assert((await source.controlSession(attempt.sessionId, 'reply', { requestId: 'parallel-b', decision: 'allowed-once' })).ok);
  assert.deepEqual(Object.keys((await source.load()).sessions[attempt.sessionId].runtime!.requests!), []);
  driver.controlError = true;
  assert.equal((await source.controlSession(attempt.sessionId, 'cancel')).ok, false);
  assert.notEqual((await source.load()).sessions[attempt.sessionId].status, 'cancelled', 'failed request cannot pretend cancellation');
  driver.controlError = false;

  // Editing unrelated user content cannot extrapolate runtime duration.
  driver.emit(childRun, { status: 'running' }); await source.flushRuntime();
  const beforeRanges = visibleIntervals(await source.load());
  await source.addBlock('text', 'An unrelated user note');
  assert.deepEqual(visibleIntervals(await source.load()), beforeRanges);

  // Scan captures genuine observation, does not create business tasks, and deduplicates by connection + session.
  driver.observed = [{ sessionId: 'external-1', connectionId: 'connection-a', title: 'External real conversation', updatedAt: new Date(driver.clock + 1000).toISOString(), status: 'archived', tokens: 15, replies: [{ id: 'ext-msg', text: 'External report', at: new Date(driver.clock + 1000).toISOString() }] }];
  const count = Object.keys((await source.load()).tasks).length;
  await source.scanAgent('codex'); await source.scanAgent('codex');
  snapshot = await source.load();
  assert.equal(Object.keys(snapshot.tasks).length, count);
  assert.equal(Object.values(snapshot.sessions).filter(s => s.source?.sessionId === 'external-1').length, 1);
  const observed = Object.values(snapshot.sessions).find(s => s.source?.sessionId === 'external-1')!;
  const callsBeforeAdopt = driver.calls.length;
  assert((await source.prepareSourceSession(observed.id)).ok);
  assert.equal(driver.calls.length, callsBeforeAdopt, 'opening an observed conversation does not send a task');
  assert.equal((await source.load()).sessions[observed.id].status, 'archived', 'read-only source import does not reopen archived history');
  const created = await source.createTaskFromSession(observed.id);
  assert(created.ok && created.taskId);
  const createdAgain = await source.createTaskFromSession(observed.id);
  assert.equal(createdAgain.taskId, created.taskId, 'creating from the same conversation is idempotent');
  const textBlock = await source.addBlock('text', '保留我写的任务原文');
  driver.observed.push({ sessionId: 'external-2', connectionId: 'connection-a', title: 'Source title', updatedAt: new Date(driver.clock + 2000).toISOString(), status: 'paused', replies: [{ id: 'prior', text: 'Keep this history', at: new Date(driver.clock + 2000).toISOString() }] });
  await source.scanAgent('codex');
  const secondObserved = Object.values((await source.load()).sessions).find(s => s.source?.sessionId === 'external-2')!;
  const converted = await source.createTaskFromSession(secondObserved.id, textBlock);
  assert.equal((await source.load()).tasks[converted.taskId!].title, '保留我写的任务原文');
  const requires = await source.linkSession(secondObserved.id, idea.taskId);
  assert.equal(requires.requiresRebind, true);
  assert.equal((await source.load()).sessions[secondObserved.id].taskId, converted.taskId);
  assert.equal((await source.linkSession(secondObserved.id, idea.taskId, {replace: true, expectedTaskId: 'stale'})).ok, false);
  assert((await source.linkSession(secondObserved.id, idea.taskId, {replace: true, expectedTaskId: converted.taskId})).ok);
  snapshot = await source.load();
  assert.equal(snapshot.tasks[converted.taskId!].sessionHistory![0].rounds[0].reply, 'Keep this history');
  assert.deepEqual(snapshot.tasks[converted.taskId!].sessionIds, []);
  assert.equal(snapshot.tasks[idea.taskId].sessionIds.filter(id => id === secondObserved.id).length, 1);
  assert.equal(driver.calls.length, callsBeforeAdopt, 'creating, linking and rebinding never send source prompts');
  await source.switchProject(b);
  assert.equal((await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'collision', projectPath: '/a' })).ok, false, 'same working directory cannot silently feed two projects');
  await source.syncTrackedSources(); assert.equal((await source.load()).project.id, b, 'periodic scans never switch the visible project');
  await source.switchProject(a);

  // A managed source cannot be reassigned to execute a different task with the old context.
  const liveOrigin = await source.createIdea('Live source origin');
  const liveTarget = await source.createIdea('Live source destination');
  const liveRun = await source.dispatch(liveOrigin.taskId, 'codex');
  assert(liveRun.ok);
  const liveSessionId = (await source.load()).tasks[liveOrigin.taskId].sessionIds[0];
  const liveSourceId = (await source.load()).sessions[liveSessionId].runtime!.runId!;
  driver.emit(liveSourceId, { child: { id: 'moving-child', title: 'Work in progress', status: 'running', sessionId: 'moving-source' } });
  await source.flushRuntime();
  assert.equal((await source.linkSession(liveSessionId, liveTarget.taskId, { replace: true, expectedTaskId: liveOrigin.taskId })).ok, false);
  const beforeRepeat = driver.calls.length;
  assert((await source.dispatch(liveTarget.taskId, 'codex')).ok);
  assert.equal(driver.calls.length, beforeRepeat + 1, 'a different task receives a fresh source session and context');
  driver.emit(liveSourceId, { child: { id: 'moving-child', title: 'Work in progress', status: 'done', sessionId: 'moving-source', reply: 'Finished for the new association' } });
  await source.flushRuntime(); snapshot = await source.load();
  assert.equal(snapshot.sessions[liveSessionId].runtime!.taskId, liveOrigin.taskId, 'original dispatched context is immutable');
  assert(Object.values(snapshot.orchestrations![liveOrigin.taskId].items).length > 0);
  assert.equal(Object.values(snapshot.orchestrations?.[liveTarget.taskId]?.items ?? {}).length, 0);
  assert(Object.values(snapshot.orchestrations![liveOrigin.taskId].attempts).some(run => run.rounds.some(round => round.reply === 'Finished for the new association')));

  const retryTask = await source.createIdea('Retry a rejected submission');
  driver.rejectNext = true;
  const rejected = await source.dispatch(retryTask.taskId, 'codex');
  assert(!rejected.ok);
  const rejectedSessionId = (await source.load()).tasks[retryTask.taskId].sessionIds[0];
  const beforeRetries = driver.calls.length;
  const retried = await Promise.all([source.retryDispatch(rejectedSessionId), source.retryDispatch(rejectedSessionId)]);
  assert(retried.every(result => result.ok));
  assert.equal(driver.calls.length, beforeRetries + 1, 'double-click retry sends exactly one new attempt');
  driver.emit(childRun, { status: 'waiting_permission', request: { id: 'pre-restart-wire-id', kind: 'permission', prompt: 'Old process permission' } });
  await source.flushRuntime();

  // Restart restores source IDs and paused execution without sending the old prompt again.
  source.dispose();
  const historyDriver = new Driver();
  historyDriver.records = structuredClone(driver.records).map(record => ({ ...record, status: record.status === 'done' ? 'done' : 'paused' }));
  const savedHistory = JSON.stringify(historyDriver.records);
  const historySource = createRuntimeDataSource(new LocalWorkdeckDataSource(), historyDriver);
  await historySource.syncRuntime();
  assert.equal(historyDriver.recovered.length, 0, 'main-process restored runs are never overwritten by a second recover');
  assert.equal(JSON.stringify(historyDriver.records), savedHistory, 'source history and monotonic cursors survive bootstrap');
  assert.equal((await historySource.load()).sessions[attempt.sessionId].status, 'paused');
  assert.deepEqual((await historySource.load()).sessions[attempt.sessionId].runtime!.requests, {}, 'restart cannot retain a permission request from a terminated source process');
  historySource.dispose();
  const resumedDriver = new Driver();
  const reopened = createRuntimeDataSource(new LocalWorkdeckDataSource(), resumedDriver);
  await reopened.syncRuntime();
  assert.equal(resumedDriver.calls.length, 0); assert(resumedDriver.recovered.length > 0);
  assert(resumedDriver.recovered.some(record => (record as {sequence:number}).sequence > 0), 'restart carries cursor so new events are not discarded');
  snapshot = await reopened.load();
  assert.equal(snapshot.sessions[attempt.sessionId].status, 'paused');
  assert.equal(snapshot.runtimeConnections!.codex.projectPath, '/a');
  await reopened.switchProject(b);
  assert.equal((await reopened.load()).runtimeConnections!.codex.projectPath, '/b');
  reopened.dispose();
  console.log('runtime-data: no mock startup; deduplicated dispatch; early/stale events; project isolation; turn vs archive; mixed completion; conclusions; nested sources/results; permissions; observed scans; restart without replay');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
