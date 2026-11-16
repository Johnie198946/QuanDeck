import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource, readAgentConclusion } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeReceipt, RuntimeRunRecord, RuntimeAction, ObservedRuntimeSession } from '../src/data/runtimeContracts';
import { completedResults } from '../src/data/results';
import { visibleIntervals } from '../src/data/timeline';
import { deriveProjectActivity } from '../src/data/projectActivity';
import { estimateTokens, hashText, projectCommittedTokens, projectActiveCalls } from '../src/data/collaboration';
import { RUNTIME_SUBMISSION_VERSION } from '../src/data/runtimeSubmission';
import { ensureIntegration, inspectIntegration } from '../src/data/resultIntegration';

// A deterministic transport double checks the business contract, not CLI compatibility.
class Driver implements RuntimeDriver {
  prepareAttachments?: RuntimeDriver['prepareAttachments'];
  listener = (_event: RuntimeEvent) => {};
  calls: RuntimeRunInput[] = [];
  records: RuntimeRunRecord[] = [];
  controls: {runId: string; action: RuntimeAction; payload?: Record<string, unknown>}[] = [];
  recovered: unknown[] = [];
  observed: ObservedRuntimeSession[] = [];
  rejectNext = false;
  early = false;
  controlError = false;
  stopConfirmed = true;
  onStop?: () => Promise<unknown>;
  fallbackNext?: string;
  omitFallbackProof = false;
  resolutions: { runId: string; successorRunId: string }[] = [];
  clock = Date.now() + 2000;
  subscribe(listener: (event: RuntimeEvent) => void) { this.listener = listener; return () => { this.listener = () => {}; }; }
  async run(input: RuntimeRunInput): Promise<RuntimeReceipt> {
    this.calls.push(input);
    const backup = this.fallbackNext; this.fallbackNext = undefined;
    const record: RuntimeRunRecord = { ...input, runId: `run-${this.calls.length}`, sessionId: `source-${this.calls.length}`, connectionId: backup ?? input.connectionId, acceptedAt: new Date(this.clock++).toISOString(), acceptance: 'acknowledged' as const, events: [] as RuntimeEvent[], status: 'queued' as const,
      ...(backup && !this.omitFallbackProof ? { tool: 'claude', fallback: { fromConnectionId: input.connectionId, toConnectionId: backup, reason: '原 Agent 尚未启动，已使用备用连接', acceptanceNotSent: true as const } } : {}) };
    this.records.push(record);
    if (this.rejectNext) { this.rejectNext = false; record.acceptance = 'rejected'; record.status = 'failed'; record.stoppedConfirmed = true; throw Object.assign(new Error('CLI unavailable'), { rejected: true }); }
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
    if (action === 'stop') { this.emit(runId, { status: 'paused' }); await this.onStop?.(); }
    if (action === 'resume') this.emit(runId, { status: 'running' });
    if (action === 'cancel') this.emit(runId, { status: 'cancelled' });
    if (action === 'archive') this.emit(runId, { status: 'done' });
    if (action === 'reply') this.emit(runId, { requestResolved: String(payload?.requestId) });
    return { stoppedConfirmed: action === 'stop' && this.stopConfirmed };
  }
  scan = async () => ({ sessions: this.observed });
  listRuns = () => this.records;
  async resolveIncident(runId: string, resolution: { reason: 'handed_off'; successorRunId: string }) {
    this.resolutions.push({ runId, successorRunId: resolution.successorRunId });
    this.emit(runId, { incident: { id: 'old-incident', code: 'process', title: '原 Agent 已停止', message: '已交接', detectedAt: new Date(this.clock).toISOString(), kind: 'failure', status: 'resolved', resolvedReason: 'handed_off', successorRunId: resolution.successorRunId } });
  }
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
  const beforeResume = (await source.load()).sessions[attempt.sessionId].runtime!.capabilities!.context;
  assert.equal((await source.controlSession(attempt.sessionId, 'resume')).ok, false);
  assert.equal((await source.load()).sessions[attempt.sessionId].runtime!.capabilities!.context, beforeResume, 'a source rejection, including a closed rc2 session, cannot claim resumed context');
  assert.equal((await source.load()).sessions[attempt.sessionId].runtime!.controlPending, undefined);
  driver.controlError = false;
  assert((await source.controlSession(attempt.sessionId, 'resume')).ok);
  assert.equal((await source.load()).sessions[attempt.sessionId].runtime!.capabilities!.context, 'resumed-source-session', 'context changes only after source acknowledgement');

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
  await reliability();
  await managedHealthIntegration();
  console.log('runtime-data: no mock startup; deduplicated dispatch; early/stale events; project isolation; turn vs archive; mixed completion; conclusions; nested sources/results; permissions; observed scans; restart without replay');
}

async function reliability() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(), driver = new Driver(), source = createRuntimeDataSource(base, driver);
  const project = (await source.createProject({ name: '可靠执行' })).projectId!;
  assert((await source.collaborate({ projectId: project, idempotencyKey: 'health-integration-policy', type: 'set_policy', payload: { maxParallel: 20, projectTokens: 1000000 } })).ok);
  await source.registerAgent({ id: 'primary', name: '主用', short: '主用', color: '#123456' });
  await source.registerAgent({ id: 'backup', name: '备用', short: '备用', color: '#654321' });
  await source.bindRuntimeConnection('primary', { tool: 'codex', connectionId: 'primary-c', projectPath: '/shared' });
  await source.bindRuntimeConnection('backup', { tool: 'claude', connectionId: 'backup-c', projectPath: '/shared' });
  const attachment = { id: 'handoff-input', name: '用户需求.txt', size: 40, type: 'text/plain' };
  const prepared: { connectionId: string; ids: string[] }[] = [];
  const prepare = async (input: Parameters<NonNullable<RuntimeDriver['prepareAttachments']>>[0]) => {
    prepared.push(input);
    return input.ids.map(id => ({ id, name: attachment.name, path: `/shared/.quandeck/attachments/${id}.txt` }));
  };
  driver.prepareAttachments = prepare;
  const task = (await source.createIdea('有证据的备用接管')).taskId;
  assert((await source.setTaskAttachments(project, task, [attachment])).ok);
  driver.fallbackNext = 'backup-c'; driver.early = true;
  const first = await source.dispatch(task, 'primary');
  assert(first.ok); await source.flushRuntime();
  let snapshot = await source.load();
  const session = snapshot.sessions[snapshot.tasks[task].sessionIds[0]];
  assert.equal(session.agentId, 'backup');
  assert.equal(session.source?.tool, 'claude');
  assert.equal(session.runtime?.connection.connectionId, 'backup-c');
  assert.equal(session.runtime?.fallback?.fromAgentId, 'primary');
  const fallbackBinding = session.runtime!.collaboration!;
  assert.equal(snapshot.collaboration!.runs[fallbackBinding.runId].executor, 'backup', 'managed execution is attributed to the actual provider');
  assert.equal(snapshot.collaboration!.tasks[task].activeRunId, fallbackBinding.runId);
  assert.equal(snapshot.collaboration!.executionLinks!.find(link => link.runId === fallbackBinding.runId)!.agentId, 'backup');
  assert.equal(snapshot.collaboration!.executionLinks!.find(link => link.runId === fallbackBinding.runId)!.connectionId, 'backup-c');
  assert.equal(snapshot.collaboration!.executionLinks!.find(link => link.runId === fallbackBinding.runId)!.tool, 'claude');
  assert(snapshot.collaboration!.events.some(event => event.type === 'run_executor_fallback' && event.detail.includes('primary → backup')));
  assert.deepEqual(driver.calls[0].allowedFallbackConnectionIds, ['backup-c']);
  assert.equal(prepared[0].connectionId, 'primary-c');
  assert.match(driver.calls[0].prompt, /\/shared\/\.quandeck\/attachments\/handoff-input\.txt/, 'preflight fallback uses the delivered files in the verified shared folder');
  assert(snapshot.timeline?.intervals.some(interval => interval.sessionId === session.id && interval.agentId === 'backup'), 'early activity belongs to the effective Agent');
  assert(!snapshot.timeline?.intervals.some(interval => interval.sessionId === session.id && interval.agentId === 'primary'));
  const beforeAttention = structuredClone(snapshot.timeline), lastAt = session.lastActivity;
  driver.emit(session.runtime!.runId!, { incident: { id: 'stall', code: 'suspected_stall', title: '暂时没有新进展', message: '可以继续等待', detectedAt: new Date(driver.clock).toISOString(), kind: 'attention', status: 'open' } });
  await source.flushRuntime(); snapshot = await source.load();
  assert.equal(snapshot.sessions[session.id].lastActivity, lastAt, 'watchdog must not pretend source activity');
  assert.deepEqual(snapshot.timeline, beforeAttention, 'watchdog must not extend actual duration');
  assert.equal(snapshot.sessions[session.id].runtime?.incident?.code, 'suspected_stall');

  const child = (await source.addManualSubtask(task, task, '处理子任务')).itemId!;
  driver.fallbackNext = 'backup-c';
  assert((await source.dispatchWork(task, child, 'primary')).ok);
  snapshot = await source.load();
  const item = snapshot.orchestrations![task].items[child], attempt = snapshot.orchestrations![task].attempts[item.attemptIds[0]];
  assert.equal(snapshot.orchestrations![task].executors[attempt.executorId].agentId, 'backup');
  assert.equal(item.suggestedAgentId, 'backup');

  const failedBackupTask = (await source.createIdea('备用启动也失败')).taskId;
  driver.fallbackNext = 'backup-c'; driver.rejectNext = true;
  assert(!(await source.dispatch(failedBackupTask, 'primary')).ok);
  snapshot = await source.load();
  const failedBackup = snapshot.sessions[snapshot.tasks[failedBackupTask].sessionIds[0]];
  assert.equal(failedBackup.agentId, 'backup', 'failure is attributed to the adapter actually attempted');
  assert(failedBackup.runtime?.runId, 'pre-start failure retains its owned local run for notification lookup');
  assert.equal(failedBackup.source, undefined, 'local run identity must not fabricate source acceptance');
  assert.equal(failedBackup.runtime?.acceptedAt, undefined);
  assert(!snapshot.collaboration!.executionLinks!.some(link => link.sessionId === failedBackup.id), 'failed preflight is not a source admission');

  const unsafe = (await source.createIdea('拒绝无凭证换身份')).taskId;
  driver.fallbackNext = 'backup-c'; driver.omitFallbackProof = true;
  const unsafeResult = await source.dispatch(unsafe, 'primary'); driver.omitFallbackProof = false;
  assert(!unsafeResult.ok);
  const unknownId = (await source.load()).tasks[unsafe].sessionIds[0], beforeUnknown = driver.calls.length;
  assert(!(await source.load()).collaboration!.executionLinks!.some(link => link.sessionId === unknownId), 'unknown identity does not invent provenance');
  assert.equal((await source.handoffSession(unknownId, 'backup')).ok, false);
  assert.equal(driver.calls.length, beforeUnknown, 'unknown acceptance cannot be replayed on another provider');
  const recoveredBackup = driver.records.at(-1)!;
  assert(!(await source.reconcile(unknownId)).ok, 'a changed connection still needs its verified fallback receipt');
  recoveredBackup.tool = 'claude';
  recoveredBackup.fallback = { fromConnectionId: 'primary-c', toConnectionId: 'backup-c', reason: '已取得原始启动前检查回执', acceptanceNotSent: true };
  assert((await source.reconcile(unknownId)).ok);
  snapshot = await source.load();
  assert.equal(snapshot.sessions[unknownId].agentId, 'backup');
  assert.equal(snapshot.collaboration!.runs[snapshot.sessions[unknownId].runtime!.collaboration!.runId].executor, 'backup');
  assert.equal(driver.calls.length, beforeUnknown, 'reconciliation attaches the existing backup source without replay');

  const handoffTask = (await source.createIdea('运行中明确交接')).taskId;
  assert((await source.setTaskAttachments(project, handoffTask, [attachment])).ok);
  const priorChild = (await source.addManualSubtask(handoffTask, handoffTask, '已独立留存的笔记')).itemId!;
  await source.saveTaskOutput({ taskId: handoffTask, workItemId: priorChild, title: '已完成的笔记', body: '保留这段成果', status: 'published' });
  const started = await source.dispatch(handoffTask, 'primary');
  assert(started.ok);
  const originalSnapshot = await source.load(), originalId = originalSnapshot.tasks[handoffTask].sessionIds[0], original = originalSnapshot.sessions[originalId], originalRun = original.runtime!.runId!;
  driver.emit(originalRun, { reply: { id: 'real-reply', text: '完成了第一部分，文件已保存。' }, tokens: 88 });
  await source.flushRuntime();
  const oldIdentity = structuredClone((await source.load()).sessions[originalId].source);
  let callCount = driver.calls.length;
  driver.controlError = true;
  assert(!(await source.handoffSession(originalId, 'backup')).ok);
  assert.equal(driver.calls.length, callCount, 'failed stop never starts a competing writer');
  driver.controlError = false; driver.stopConfirmed = false;
  assert(!(await source.handoffSession(originalId, 'backup')).ok);
  assert.equal(driver.calls.length, callCount, 'status paused without confirmed process exit is insufficient');
  driver.stopConfirmed = true;
  driver.prepareAttachments = async () => { throw new Error('附件暂时无法读取'); };
  const attachmentsBlocked = await source.handoffSession(originalId, 'backup');
  assert(!attachmentsBlocked.ok && attachmentsBlocked.message?.includes('附件未能交付'));
  assert.equal(driver.calls.length, callCount, 'failed handoff attachment delivery cannot create a replacement execution');
  assert.equal((await source.load()).sessions[originalId].runtime!.handedOffTo, undefined);
  driver.prepareAttachments = prepare;
  const otherProject = (await source.createProject({ name: '查看另一个项目' })).projectId!;
  await source.switchProject(project);
  driver.onStop = async () => {
    assert(!(await source.controlSession(originalId, 'resume')).ok, 'original cannot resume during the handoff lock');
    return source.switchProject(otherProject);
  };
  const results = await Promise.all([source.handoffSession(originalId, 'backup'), source.handoffSession(originalId, 'backup')]);
  driver.onStop = undefined;
  assert(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(driver.calls.length, callCount + 1, 'double-click handoff launches exactly one new execution');
  assert.equal((await source.load()).project.id, otherProject, 'background handoff never changes navigation');
  snapshot = (await source.listProjects()).find(value => value.project.id === project)!;
  const next = snapshot.sessions[results[0].sessionId!];
  assert.notEqual(next.id, originalId); assert.notEqual(next.source?.sessionId, oldIdentity?.sessionId);
  assert.equal(next.taskId, handoffTask); assert.equal(next.agentId, 'backup');
  assert.equal(next.runtime?.predecessorSessionId, originalId);
  assert.equal(snapshot.sessions[originalId].runtime?.handedOffTo, next.id);
  assert.deepEqual(driver.resolutions.at(-1), { runId: originalRun, successorRunId: next.runtime!.runId });
  assert.equal(snapshot.sessions[originalId].runtime?.incident?.resolvedReason, 'handed_off');
  assert.equal(snapshot.sessions[originalId].linkedAsHistory, true);
  assert.equal(snapshot.sessions[originalId].tokens, 88);
  const originalBinding = original.runtime!.collaboration!, nextBinding = next.runtime!.collaboration!;
  assert.notEqual(originalBinding.runId, nextBinding.runId);
  assert.notEqual(originalBinding.contextPackageId, nextBinding.contextPackageId);
  assert(nextBinding.claimEpoch > originalBinding.claimEpoch);
  assert.equal(snapshot.collaboration!.runs[originalBinding.runId].status, 'cancelled', 'confirmed stop fences the predecessor claim');
  assert.equal(snapshot.collaboration!.tasks[handoffTask].activeRunId, nextBinding.runId);
  assert.equal(snapshot.collaboration!.runs[nextBinding.runId].executor, 'backup');
  assert.equal(snapshot.collaboration!.executionLinks!.filter(link => link.taskId === handoffTask && !link.workItemId).length, 2, 'each actual handoff admission appends its own source link');
  assert.equal(snapshot.collaboration!.runs[originalBinding.runId].usageFinal, undefined, 'a stop receipt is not a final billing receipt');
  assert(projectCommittedTokens(snapshot) >= snapshot.collaboration!.runs[originalBinding.runId].reservedTokens + snapshot.collaboration!.runs[nextBinding.runId].reservedTokens);
  const nextContext = snapshot.collaboration!.contextPackages.find(context => context.id === nextBinding.contextPackageId)!;
  assert.equal(nextContext.prompt, driver.calls.at(-1)!.prompt);
  assert.equal(prepared.at(-1)!.connectionId, 'backup-c', 'manual handoff revalidates and prepares attachments for the explicit destination');
  assert.match(nextContext.prompt, /\/shared\/\.quandeck\/attachments\/handoff-input\.txt/);
  assert.equal(nextContext.hash, hashText(nextContext.prompt));
  assert.equal(nextContext.estimatedTokens, estimateTokens(nextContext.prompt));
  assert(nextContext.estimatedTokens <= nextContext.tokenBudget, 'handoff text participates in the fixed context budget');
  assert(!nextContext.prompt.includes(JSON.stringify(originalBinding)), 'old submission authority is not included in the new execution prompt');
  assert.equal(snapshot.sessions[originalId].rounds[0].reply, '完成了第一部分，文件已保存。');
  assert.deepEqual(snapshot.sessions[originalId].source, oldIdentity);
  assert(driver.calls.at(-1)!.prompt.includes('保留这段成果'));
  assert(driver.calls.at(-1)!.prompt.includes('完成了第一部分'));
  assert.deepEqual(driver.calls.at(-1)!.allowedFallbackConnectionIds, [], 'explicit target must not silently change again');
  callCount = driver.calls.length;
  assert(!(await source.controlSession(originalId, 'resume')).ok);
  assert(!(await source.retryDispatch(originalId)).ok);
  assert.equal(driver.calls.length, callCount);
  assert((await source.handoffSession(originalId, 'backup')).ok);
  assert.equal(driver.calls.length, callCount, 'repeating a completed handoff returns its persisted successor');
  driver.emit(originalRun, { submission: { schemaVersion: RUNTIME_SUBMISSION_VERSION, idempotencyKey: 'late-original', binding: originalBinding, kind: 'result', payload: { title: 'Late original result', body: 'Old execution must not submit into the successor claim' } } });
  await source.flushRuntime();
  snapshot = (await source.listProjects()).find(value => value.project.id === project)!;
  assert.equal(snapshot.sessions[originalId].runtime!.submissionReceipts!.at(-1)!.code, 'STALE_CLAIM');
  assert.equal(snapshot.collaboration!.tasks[handoffTask].activeRunId, nextBinding.runId);
  assert.equal(snapshot.collaboration!.tasks[handoffTask].status, 'running');
  await source.switchProject(project);
  const candidateTask = (await source.createIdea('待验收不能被交接绕过')).taskId;
  assert((await source.dispatch(candidateTask, 'primary')).ok);
  const candidateSession = (await source.load()).tasks[candidateTask].sessionIds[0];
  await source.saveTaskOutput({ taskId: candidateTask, title: '候选成果', body: '等待负责人验收', status: 'published' });
  callCount = driver.calls.length;
  assert(!(await source.handoffSession(candidateSession, 'backup')).ok);
  assert.equal(driver.calls.length, callCount, 'handoff cannot silently reopen a candidate awaiting review');
  source.dispose();
}
async function managedHealthIntegration() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(), driver = new Driver(), source = createRuntimeDataSource(base, driver);
  const projectId = (await source.createProject({ name: '健康与成果整合' })).projectId!;
  await source.registerAgent({ id: 'primary', name: '主用', short: '主用', color: '#123456' });
  await source.registerAgent({ id: 'backup', name: '备用', short: '备用', color: '#654321' });
  await source.bindRuntimeConnection('primary', { tool: 'codex', connectionId: 'origin', projectPath: '/results' });
  await source.bindRuntimeConnection('backup', { tool: 'claude', connectionId: 'target', projectPath: '/results' });
  assert((await source.collaborate({ projectId, idempotencyKey: 'wide-policy', type: 'set_policy', payload: { maxParallel: 20, projectTokens: 1000000 } })).ok);
  const taskId = (await source.createIdea('来源必须跟随原始成果')).taskId;
  const first = await source.dispatch(taskId, 'primary'); assert(first.ok, first.message);
  let snapshot = await source.load();
  const original = snapshot.sessions[snapshot.tasks[taskId].sessionIds.at(-1)!], originalBinding = original.runtime!.collaboration!;
  driver.emit(original.runtime!.runId!, { status: 'done', tokens: 120, submission: { schemaVersion: RUNTIME_SUBMISSION_VERSION, idempotencyKey: 'original-candidate', binding: originalBinding, kind: 'result', payload: { title: '原始成果', body: '经过负责人核对的原始资料', sourceIds: [] } } });
  await source.flushRuntime(); snapshot = await source.load();
  const originalSubmission = snapshot.collaboration!.tasks[taskId].latestSubmissionId!;
  const accepted = await source.collaborate({ projectId, taskId, type: 'review', idempotencyKey: 'accept-original', expectedVersion: snapshot.collaboration!.tasks[taskId].version, payload: { submissionId: originalSubmission, verdict: 'accepted', note: '负责人完成核对', checks: snapshot.collaboration!.specs.find(spec => spec.key === taskId)!.criteria.map(() => true) } });
  assert(accepted.ok, accepted.message);
  snapshot = await source.load();
  const artifactId = snapshot.collaboration!.tasks[taskId].acceptedArtifactId!;
  const integration = await source.integrate({ projectId, type: 'create', idempotencyKey: 'integrate-original', payload: { title: '汇总原始成果', sourceIds: [artifactId] } });
  assert(integration.ok, integration.message);
  snapshot = await source.load();
  const pinned = structuredClone(inspectIntegration(snapshot, integration.draftId!).revision.sourcePins), originalArtifact = structuredClone(snapshot.collaboration!.artifacts.find(artifact => artifact.id === artifactId)!);
  const originalLink = structuredClone(snapshot.collaboration!.executionLinks!.find(link => link.runId === originalBinding.runId)!);
  assert.equal(pinned[0].sourceSessionId, original.source!.sessionId);
  assert.equal(pinned[0].runId, originalBinding.runId);
  assert((await source.collaborate({ projectId, taskId, type: 'reopen', idempotencyKey: 'reopen-for-update', expectedVersion: snapshot.collaboration!.tasks[taskId].version, payload: { reason: '明确要求修订' } })).ok);
  const revision = await source.dispatch(taskId, 'primary'); assert(revision.ok, revision.message);
  const revisionSessionId = (await source.load()).tasks[taskId].sessionIds.at(-1)!;
  const handoff = await source.handoffSession(revisionSessionId, 'backup'); assert(handoff.ok, handoff.message);
  snapshot = await source.load();
  const successor = snapshot.sessions[handoff.sessionId!];
  assert.equal(snapshot.collaboration!.executionLinks!.filter(link => link.taskId === taskId).length, 3);
  assert.deepEqual(snapshot.collaboration!.executionLinks!.find(link => link.runId === originalBinding.runId), originalLink);
  assert.deepEqual(snapshot.collaboration!.artifacts.find(artifact => artifact.id === artifactId), originalArtifact);
  assert.deepEqual(inspectIntegration(snapshot, integration.draftId!).revision.sourcePins, pinned, 'new attempts do not redirect already pinned artifact sources');
  assert.notEqual(pinned[0].sourceSessionId, successor.source!.sessionId);
  const linksBeforeReplay = structuredClone(snapshot.collaboration!.executionLinks);
  assert((await source.reconcile(successor.id)).ok);
  assert((await source.reconcile(successor.id)).ok);
  assert((await source.syncRuntime()).ok);
  assert.deepEqual((await source.load()).collaboration!.executionLinks, linksBeforeReplay, 'reconciliation and restart receipts do not append or rewrite links');

  // Reviewing is its own task. A handoff must keep the original candidate pinned,
  // and its new opinion must not become user acceptance of that candidate.
  const candidateTask = (await source.createIdea('独立复核的交接')).taskId;
  const candidate = await source.dispatch(candidateTask, 'primary'); assert(candidate.ok, candidate.message);
  snapshot = await source.load(); const candidateSession = snapshot.sessions[snapshot.tasks[candidateTask].sessionIds.at(-1)!];
  driver.emit(candidateSession.runtime!.runId!, { status: 'waiting_reply', submission: { schemaVersion: RUNTIME_SUBMISSION_VERSION, idempotencyKey: 'review-candidate', binding: candidateSession.runtime!.collaboration!, kind: 'result', payload: { title: '待复核的内容', body: '复核必须读取这个候选版本', sourceIds: [] } } });
  await source.flushRuntime(); snapshot = await source.load();
  const candidateId = snapshot.collaboration!.tasks[candidateTask].latestSubmissionId!;
  const review = await source.startReview(candidateId, 'primary'); assert(review.ok, review.message);
  assert.deepEqual(driver.calls.at(-1)!.allowedFallbackConnectionIds, [], 'review selection never silently changes the reviewer');
  const handedReview = await source.handoffSession(review.sessionId!, 'backup'); assert(handedReview.ok, handedReview.message);
  snapshot = await source.load(); const reviewer = snapshot.sessions[handedReview.sessionId!], reviewBinding = reviewer.runtime!.collaboration!;
  assert.equal(reviewer.runtime!.reviewSubmissionId, candidateId);
  assert.equal(reviewer.runtime!.purpose, 'review');
  const reviewContext = snapshot.collaboration!.contextPackages.find(context => context.id === reviewBinding.contextPackageId)!;
  const candidateSource = reviewContext.sources.find(value => value.freshness === 'candidate')!;
  assert.equal(candidateSource.excerpt, '复核必须读取这个候选版本');
  const humanReviewCount = snapshot.collaboration!.reviews.length;
  driver.emit(reviewer.runtime!.runId!, { status: 'done', submission: { schemaVersion: RUNTIME_SUBMISSION_VERSION, idempotencyKey: 'review-after-handoff', binding: reviewBinding, kind: 'result', payload: { title: '复核意见', body: '已逐条检查，但仍需负责人验收', sourceIds: [candidateSource.id] } } });
  await source.flushRuntime(); snapshot = await source.load();
  assert.equal(snapshot.sessions[reviewer.id].runtime!.submissionReceipts!.at(-1)!.ok, true);
  assert.equal(snapshot.collaboration!.tasks[candidateTask].status, 'in_review');
  assert.equal(snapshot.collaboration!.reviews.length, humanReviewCount);

  // Integration reviews and new backup executions share admission and budget limits.
  const limitedProject = (await source.createProject({ name: '共享调用限额' })).projectId!;
  await source.bindRuntimeConnection('primary', { tool: 'codex', connectionId: 'limited-primary', projectPath: '/limited' });
  await source.bindRuntimeConnection('backup', { tool: 'claude', connectionId: 'limited-backup', projectPath: '/limited' });
  const limitedTask = (await source.createIdea('共享限额不能被交接绕过')).taskId;
  const limitedStart = await source.dispatch(limitedTask, 'primary'); assert(limitedStart.ok, limitedStart.message);
  snapshot = await source.load(); const limitedSession = snapshot.sessions[snapshot.tasks[limitedTask].sessionIds.at(-1)!], reserved = snapshot.collaboration!.runs[limitedSession.runtime!.collaboration!.runId].reservedTokens;
  base.mutateRuntimeProject(limitedProject, d => { ensureIntegration(d).reviewJobs = { 'pending-review': { id: 'pending-review', draftId: 'fixture-draft', revisionId: 'fixture-revision', fingerprint: 'fixture', status: 'running', createdAt: new Date().toISOString(), reservedTokens: reserved, actualTokens: null, usageFinal: false } }; });
  assert((await source.collaborate({ projectId: limitedProject, type: 'set_policy', idempotencyKey: 'one-call', payload: { maxParallel: 1 } })).ok);
  const beforeLimit = driver.calls.length;
  const parallelBlocked = await source.handoffSession(limitedSession.id, 'backup');
  assert(!parallelBlocked.ok && parallelBlocked.message?.includes('并发'), JSON.stringify(parallelBlocked));
  assert.equal(driver.calls.length, beforeLimit);
  snapshot = await source.load();
  assert.equal(projectActiveCalls(snapshot), 2, 'failed handoff transaction retains the paused owned run and review slot');
  assert.equal(snapshot.sessions[limitedSession.id].runtime!.handedOffTo, undefined);
  base.mutateRuntimeProject(limitedProject, d => { d.integration!.reviewJobs!['pending-review'].status = 'failed'; });
  assert((await source.collaborate({ projectId: limitedProject, type: 'set_policy', idempotencyKey: 'limited-budget', payload: { maxParallel: 20, projectTokens: reserved * 2 } })).ok);
  const budgetBlocked = await source.handoffSession(limitedSession.id, 'backup');
  assert(!budgetBlocked.ok && budgetBlocked.message?.includes('预算'), JSON.stringify(budgetBlocked));
  assert.equal(driver.calls.length, beforeLimit);
  base.mutateRuntimeProject(limitedProject, d => { Object.assign(d.integration!.reviewJobs!['pending-review'], { actualTokens: 0, usageFinal: true }); });
  const afterBilling = await source.handoffSession(limitedSession.id, 'backup'); assert(afterBilling.ok, afterBilling.message);
  assert.equal(driver.calls.length, beforeLimit + 1, 'a real settled review bill makes its reservation available');
  assert((await source.collaborate({ projectId: limitedProject, type: 'set_policy', idempotencyKey: 'small-context', payload: { contextTokens: 256, projectTokens: 1000000 } })).ok);
  const beforeContext = driver.calls.length;
  const contextBlocked = await source.handoffSession(afterBilling.sessionId!, 'primary');
  assert(!contextBlocked.ok && contextBlocked.message?.includes('预算'), JSON.stringify(contextBlocked));
  assert.equal(driver.calls.length, beforeContext, 'oversized handoff context never reaches a provider');
  source.dispose();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
