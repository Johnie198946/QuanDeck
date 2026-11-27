import assert from 'node:assert/strict';
import { readContextEvidence } from '../src/data/contextEvidence';
import { findResultContinuation, listResultContinuations, continuationPrompt } from '../src/data/resultContinuation';
import { noteTaskKey } from '../src/data/noteTaskSource';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { executionDrafts } from '../src/data/results';
import { readRuntimeSubmission, RUNTIME_SUBMISSION_VERSION } from '../src/data/runtimeSubmission';
import { hashText, estimateTokens, runContinuationReference, runContinuationReferences } from '../src/data/collaboration';
import { firstSystemAgent } from '../src/data/systemAgent';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord, RuntimeAction } from '../src/data/runtimeContracts';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
class Transport implements RuntimeDriver {
  verifyDeliveryFiles?:RuntimeDriver['verifyDeliveryFiles'];
  verifyTaskWorkspace?: RuntimeDriver['verifyTaskWorkspace'];
  prepareAttachments?: RuntimeDriver['prepareAttachments'];
  workspace?: RuntimeRunRecord['taskWorkspace'];
  prepareSourceAttachments?: RuntimeDriver['prepareSourceAttachments'];
  calls: RuntimeRunInput[] = []; records: RuntimeRunRecord[] = []; unknown = false;
  controlPayload?: Record<string, unknown>;
  clock = Date.now() + 1000; listener = (_event: RuntimeEvent) => {};
  subscribe(listener: (event: RuntimeEvent) => void) { this.listener = listener; return () => {}; }
  async run(input: RuntimeRunInput) {
    this.calls.push(input); const run: RuntimeRunRecord = { ...input, runId: `provider-${this.calls.length}`, sessionId: `source-${this.calls.length}`, acceptedAt: new Date(this.clock++).toISOString(), acceptance: this.unknown ? 'unknown' : 'acknowledged', status: 'queued', events: [] };
    if (this.workspace) run.taskWorkspace = structuredClone(this.workspace);
    this.records.push(run); if (this.unknown) throw new Error('acknowledgement lost'); return run;
  }
  emit(run: RuntimeRunRecord, fields: Partial<RuntimeEvent>) { const event: RuntimeEvent = { ...fields, id: `event-${run.runId}-${run.events!.length}`, sequence: run.events!.length, at: new Date(this.clock += 1000).toISOString(), runId: run.runId, sessionId: run.sessionId }; run.events!.push(event); if (fields.status) run.status = fields.status; this.listener(event); }
  async control(runId: string, action: RuntimeAction, payload?: Record<string, unknown>) { this.controlPayload = payload; this.emit(this.records.find(run => run.runId === runId)!, { status: action === 'archive' ? 'done' : action === 'cancel' ? 'cancelled' : action === 'resume' || action === 'reply' ? 'running' : 'paused' }); }
  recovered: (RuntimeRunInput & Partial<RuntimeRunRecord>)[] = [];
  async recover(input: RuntimeRunInput & Partial<RuntimeRunRecord>) { this.recovered.push(input); }
  scan = async () => [];
  listRuns = () => this.records;
}
async function main() {
  const base = new LocalWorkdeckDataSource(), transport = new Transport(), source = createRuntimeDataSource(base, transport);
  const projectId = (await source.createProject({ name: 'Managed collaboration' })).projectId!;
  await source.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#123456' });
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'managed-test', projectPath: '/managed-test' });
  const agentsSnapshot = await source.load();
  assert.equal(firstSystemAgent(agentsSnapshot, [{ tool: 'codex' }])?.id, 'codex', 'the sole user-configured agent is selected');
  assert.equal(firstSystemAgent({ ...agentsSnapshot, defaultAgent: 'codex' }, [{ tool: 'missing-first' }, { tool: 'codex' }]), null, 'missing first agent never silently falls back to default or second agent');
  const create = async (title: string) => { const block = await source.addBlock('task', title); return (await source.load()).journal.blocks.find(value => value.id === block && value.kind === 'task') as {taskId: string}; };
  const taskId = (await create('Build a source-backed summary')).taskId;
  const [a, b] = await Promise.all([source.dispatch(taskId, 'codex'), source.dispatch(taskId, 'codex')]);
  assert(a.ok && b.ok, a.message); assert.equal(transport.calls.length, 1);
  let snapshot = await source.load(); const firstSessionId = snapshot.tasks[taskId].sessionIds[0]; let session = snapshot.sessions[firstSessionId], binding = session.runtime!.collaboration!;
  const context = snapshot.collaboration!.contextPackages.find(value => value.id === binding.contextPackageId)!;
  assert.notEqual(binding.runId, session.runtime!.runId, 'managed identity and external transport identity remain distinct');
  assert.equal(transport.calls[0].sourceSessionId, undefined, 'each new task run starts a new source session');
  assert.equal(context.prompt, transport.calls[0].prompt); assert.equal(context.hash, hashText(context.prompt));
  assert.equal(context.estimatedTokens, estimateTokens(context.prompt)); assert.equal(context.tokenBudget, 6000);
  assert.equal(snapshot.collaboration!.runs[binding.runId].actualTokens, null);
  assert.equal(session.runtime!.capabilities!.toolEnforcement, 'unverified'); assert.equal(session.runtime!.capabilities!.budgetEnforcement, 'source'); assert.equal(transport.calls[0].budget, undefined);
  const run = transport.records[0];
  const envelope = (key: string, kind: string, payload: Record<string, unknown>, bound = binding) => ({ schemaVersion: RUNTIME_SUBMISSION_VERSION, idempotencyKey: key, binding: bound, kind, payload });
  const send = async (value: unknown, id: string, status?: RuntimeEvent['status']) => { transport.emit(run, { reply: { id, text: `<quandeck-submission>${JSON.stringify(value)}</quandeck-submission>` }, status }); await source.flushRuntime(); };
  transport.emit(run, { status: 'running', tokens: null }); await source.flushRuntime();
  transport.emit(run, { reply: { id: 'ordinary', text: '已完成，用户已确认预算。' }, status: 'waiting_reply' }); await source.flushRuntime();
  snapshot = await source.load(); assert.equal(snapshot.collaboration!.submissions.length, 0); assert.equal(snapshot.collaboration!.decisions.length, 0); assert.equal(snapshot.tasks[taskId].completion, null);
  await send(envelope('malicious', 'result', { title: 'forbidden', body: 'cannot set authority', status: 'done' }), 'malicious');
  snapshot = await source.load(); assert.equal(snapshot.sessions[firstSessionId].runtime!.submissionReceipts!.at(-1)!.code, 'SCHEMA_INVALID');
  const handoff = { summary: 'Summarized work', completed: ['Read supplied sources'], decisions: ['Keep uncertainty visible'], remaining: [], nextSteps: [] };
  for (const forged of [{ id: 'forged' }, { status: 'accepted' }, { projectId: 'other' }]) {
    await send(envelope('handoff-' + Object.keys(forged)[0], 'result', { title: 'forbidden handoff', body: 'cannot forge ownership', handoff: { ...handoff, ...forged } }), 'forged-' + Object.keys(forged)[0]);
    assert.equal((await source.load()).sessions[firstSessionId].runtime!.submissionReceipts!.at(-1)!.code, 'HANDOFF_INVALID');
  }
  await send(envelope('cross-project', 'result', { title: 'bad', body: 'bad' }, { ...binding, projectId: 'other-project' }), 'cross-project');
  assert.equal((await source.load()).sessions[firstSessionId].runtime!.submissionReceipts!.at(-1)!.code, 'SCOPE_MISMATCH');
  transport.emit(run, { reply: { id: 'unsafe-fallback', text: 'A complete report using the rejected source.' }, status: 'waiting_reply', turnCompleted: true }); await source.flushRuntime();
  assert.equal((await source.load()).collaboration!.submissions.length, 0, 'a security rejection cannot be bypassed by plain final prose');
  await send(envelope('checkpoint', 'checkpoint', { completed: ['Read supplied sources'], remaining: ['Write candidate'], note: 'No external writes performed' }), 'checkpoint');
  assert.equal((await source.load()).collaboration!.checkpoints.length, 1);
  assert.equal((await source.load()).sessions[firstSessionId].runtime!.submissionIssue!.code, 'SCOPE_MISMATCH', 'checkpoint does not hide rejected delivery');
  const result = envelope('candidate-1', 'result', { title: 'Candidate summary', body: 'Summary with explicit unknowns', sourceIds: [], unresolved: ['A date still needs checking'], nextSteps: ['Check date'], handoff });
  await send(result, 'candidate', 'done');
  snapshot = await source.load();
  assert.equal(snapshot.collaboration!.handoffs!.at(-1)!.content.summary, handoff.summary);
  assert.deepEqual(snapshot.collaboration!.handoffs!.at(-1)!.content.remaining, ['A date still needs checking'], 'provided handoff cannot hide the canonical submission blocker');
  assert.equal(snapshot.collaboration!.tasks[taskId].status, 'in_review', snapshot.sessions[firstSessionId].runtime!.submissionReceipts!.at(-1)!.message);
  assert.equal(snapshot.tasks[taskId].completion, null, 'run ended but candidate still requires review');
  assert.equal(snapshot.sessions[firstSessionId].runtime!.submissionIssue, undefined, 'a corrected successful result clears the submission error');
  assert.equal(snapshot.sessions[firstSessionId].runtime!.submissionReceipts!.at(-1)!.kind, 'result');
  assert.equal(snapshot.collaboration!.runs[binding.runId].status, 'succeeded');
  await send(result, 'replayed'); assert.equal((await source.load()).collaboration!.submissions.length, 1, 'a replay cannot create another candidate');
  snapshot = await source.load();
  const originalSubmission = snapshot.collaboration!.tasks[taskId].latestSubmissionId!;
  const aiReview = await source.startReview(originalSubmission, 'codex'); assert(aiReview.ok, aiReview.message);
  snapshot = await source.load(); const reviewer = snapshot.sessions[aiReview.sessionId!], reviewBinding = reviewer.runtime!.collaboration!, reviewRun = transport.records.at(-1)!;
  assert.equal(reviewer.runtime!.purpose, 'review'); assert.notEqual(reviewer.taskId, taskId);
  const reviewContext = snapshot.collaboration!.contextPackages.find(value => value.id === reviewBinding.contextPackageId)!;
  const candidateSource = reviewContext.sources.find(value => value.freshness === 'candidate')!;
  assert.equal(candidateSource.excerpt, 'Summary with explicit unknowns', 'review reads the pinned full candidate');
  transport.emit(reviewRun, { reply: { id: 'review-advice', text: `<quandeck-submission>${JSON.stringify(envelope('review-advice', 'result', { title: 'Independent review', body: 'Checked evidence; date remains unresolved.', sourceIds: [candidateSource.id] }, reviewBinding))}</quandeck-submission>` }, status: 'done' }); await source.flushRuntime();
  snapshot = await source.load(); assert.equal(snapshot.collaboration!.tasks[reviewer.taskId!].status, 'in_review'); assert.equal(snapshot.collaboration!.tasks[taskId].status, 'in_review'); assert.equal(snapshot.collaboration!.reviews.length, 0, 'AI review opinion is never a human acceptance');
  const blockedReview = await source.collaborate({ projectId, idempotencyKey: 'human-review-unresolved', type: 'review', taskId, expectedVersion: snapshot.collaboration!.tasks[taskId].version, payload: { submissionId: snapshot.collaboration!.tasks[taskId].latestSubmissionId, verdict: 'accepted', note: 'The date is still unknown', checks: [true] } });
  assert.equal(blockedReview.code, 'INCOMPLETE_DELIVERY', 'an unslotted task cannot bypass an explicit unresolved blocker');
  const corrected = await source.collaborate({ projectId, idempotencyKey: 'human-corrected-result', type: 'submit', taskId, expectedVersion: snapshot.collaboration!.tasks[taskId].version, payload: { title: 'Date verified', body: 'The missing date was verified against the original evidence.', unresolved: [], nextSteps: [] } });
  assert(corrected.ok, corrected.message);
  snapshot = await source.load();
  const review = await source.collaborate({ projectId, idempotencyKey: 'human-review', type: 'review', taskId, expectedVersion: snapshot.collaboration!.tasks[taskId].version, payload: { submissionId: snapshot.collaboration!.tasks[taskId].latestSubmissionId, verdict: 'accepted', note: 'Checked the deliverable', checks: [true] } });
  assert(review.ok, review.message); assert((await source.load()).tasks[taskId].completion);
  transport.emit(run, { status: 'running', tokens: 100 }); await source.flushRuntime();
  snapshot = await source.load(); assert.equal(snapshot.collaboration!.tasks[taskId].status, 'done', 'late lifecycle cannot reopen accepted task');
  assert.equal(snapshot.collaboration!.runs[binding.runId].actualTokens, 100, 'late usage is real accounting, independent of completion');
  transport.emit(reviewRun, { reply: { id: 'outdated-review', text: `<quandeck-submission>${JSON.stringify(envelope('outdated-review', 'result', { title: 'Late opinion', body: 'Original review target no longer current.' }, reviewBinding))}</quandeck-submission>` } }); await source.flushRuntime();
  assert.equal((await source.load()).sessions[reviewer.id].runtime!.submissionReceipts!.at(-1)!.code, 'REVIEW_TARGET_STALE');

  const plainTask = (await create('Collect the final public answer')).taskId;
  assert((await source.dispatch(plainTask, 'codex')).ok);
  const plainRun = transport.records.at(-1)!;
  snapshot = await source.load(); const plainBinding = snapshot.sessions[snapshot.tasks[plainTask].sessionIds[0]].runtime!.collaboration!;
  transport.emit(plainRun, { submission: envelope('plain-progress','checkpoint',{completed:['Research'],remaining:['Report'],note:'Final report follows'},plainBinding) }); await source.flushRuntime();
  transport.emit(plainRun, { reply: { id: 'public-answer', text: '## Deliverable\nA complete, reviewable report.' }, status: 'waiting_reply' });
  await source.flushRuntime();
  assert.match(executionDrafts(await source.load(), plainTask, null)[0].text, /reviewable report/);
  transport.emit(plainRun, { status: 'waiting_reply', turnCompleted: true }); await source.flushRuntime();
  snapshot = await source.load();
  const collected = snapshot.collaboration!.tasks[plainTask].latestSubmissionId;
  assert(collected, 'a verified successful source turn collects a report despite earlier checkpoint');
  assert.equal(snapshot.tasks[plainTask].completion, null);
  assert.match(executionDrafts(snapshot, plainTask, null)[0].text, /reviewable report/);
  transport.emit(plainRun, { status: 'done' }); await source.flushRuntime();
  assert.equal((await source.load()).collaboration!.submissions.filter(value => value.key === plainTask).length, 1);


  // A native workspace receipt fences both forms of submission, including the two-event
  // plain reply/turn-completed path. A corrected structured submission can retry.
  transport.workspace = { role:'code', source:'/project', directory:'/task', branch:'task-branch', baseSha:'a'.repeat(40) };
  const codingTask = (await create('给列表加分页')).taskId;
  assert((await source.dispatch(codingTask, 'codex')).ok);
  const codingRun=transport.records.at(-1)!;
  const codingSessionId=(await source.load()).tasks[codingTask].sessionIds[0];
  const codingSession=(await source.load()).sessions[codingSessionId];
  assert.deepEqual(codingSession.runtime!.taskWorkspace,transport.workspace);
  const candidate=envelope('coding-result','result',{title:'分页',body:'完成并验证了分页功能。'},codingSession.runtime!.collaboration!);
  transport.verifyTaskWorkspace=async id=>{assert.equal(id,codingRun.runId);throw Error('请将发版号交给集成任务');};
  transport.emit(codingRun,{reply:{id:'coding-plain',text:'已经完成分页功能，验证结果符合任务要求。'},status:'waiting_reply'});
  await source.flushRuntime();
  transport.emit(codingRun,{turnCompleted:true,status:'waiting_reply'});
  await source.flushRuntime();
  assert.equal((await source.load()).sessions[codingSessionId].runtime!.submissionIssue?.code,'TASK_WORKTREE_UNVERIFIED');
  transport.emit(codingRun,{submission:candidate});await source.flushRuntime();
  assert.equal((await source.load()).collaboration!.tasks[codingTask].latestSubmissionId,undefined);
  transport.verifyTaskWorkspace=async id=>{assert.equal(id,codingRun.runId);};
  transport.emit(codingRun,{submission:candidate});await source.flushRuntime();
  assert.ok((await source.load()).collaboration!.tasks[codingTask].latestSubmissionId);
  transport.workspace=undefined;
  transport.verifyTaskWorkspace=undefined;

  const brokenTask = (await create('Recover a malformed final payload')).taskId;
  assert((await source.dispatch(brokenTask, 'codex')).ok);
  const brokenRun = transport.records.at(-1)!;
  transport.emit(brokenRun, { reply: {id:'bad-json',text:'<quandeck-submission>{broken}</quandeck-submission>'}, status:'waiting_reply',turnCompleted:true }); await source.flushRuntime();
  snapshot=await source.load(); const brokenSessionId=snapshot.tasks[brokenTask].sessionIds[0];
  assert.equal(snapshot.sessions[brokenSessionId].runtime!.submissionIssue!.code,'SCHEMA_INVALID');
  assert.equal(snapshot.collaboration!.tasks[brokenTask].latestSubmissionId,undefined,'rejected envelope itself never becomes a fallback result');
  transport.emit(brokenRun,{reply:{id:'repaired-public',text:'## Deliverable\nThe completed source-backed report is here.'},status:'waiting_reply',turnCompleted:true});await source.flushRuntime();
  snapshot=await source.load();assert(snapshot.collaboration!.tasks[brokenTask].latestSubmissionId,'later independent valid prose can recover a parsing error');assert.equal(snapshot.sessions[brokenSessionId].runtime!.submissionIssue,undefined);
  const blockedTask = (await create('Inspect an existing project folder')).taskId;
  assert((await source.dispatch(blockedTask, 'codex')).ok);
  snapshot = await source.load();
  const blockedSessionId = snapshot.tasks[blockedTask].sessionIds[0];
  const blockedBinding = snapshot.sessions[blockedSessionId].runtime!.collaboration!;
  const blockedRun = transport.records.at(-1)!;
  const reason = '需要包含源码的项目文件夹。';
  const blocker = (payload: Record<string, unknown>, bound = blockedBinding) =>
    `<quandeck-submission>${JSON.stringify(envelope('needs-workspace', 'blocker', payload, bound))}`;
  const malformedBlockers = [
    [blocker({ reason }, { ...blockedBinding, projectId: 'other-project' }), 'SCOPE_MISMATCH'],
    [blocker({ reason, status: 'accepted' }), 'SCHEMA_INVALID'],
    [blocker({ reason }) + '\nMore prose', 'SCHEMA_INVALID'],
    [`<quandeck-submission>${JSON.stringify(envelope('unfinished-result', 'result', { title: 'Draft', body: 'Unverified' }, blockedBinding))}`, 'SCHEMA_INVALID'],
  ];
  for (const [index, [text, code]] of malformedBlockers.entries()) {
    transport.emit(blockedRun, { reply: { id: `bad-blocker-${index}`, text }, status: 'waiting_reply', turnCompleted: true });
    await source.flushRuntime();
    assert.equal((await source.load()).sessions[blockedSessionId].runtime!.submissionIssue?.code, code);
  }
  const rawBlocker = blocker({ reason });
  transport.emit(blockedRun, { reply: { id: 'workspace-blocker', text: rawBlocker }, status: 'waiting_reply', turnCompleted: true });
  await source.flushRuntime();
  snapshot = await source.load();
  const blockedSession = snapshot.sessions[blockedSessionId];
  assert.equal(blockedSession.runtime!.submissionReceipts!.at(-1)?.kind, 'blocker');
  assert.equal(blockedSession.runtime!.submissionReceipts!.at(-1)?.ok, true);
  assert.equal(blockedSession.runtime!.submissionIssue?.code, 'AGENT_BLOCKED');
  assert.equal(blockedSession.runtime!.submissionIssue?.message, reason);
  assert.equal(blockedSession.rounds.at(-1)?.reply, rawBlocker);
  assert.equal(snapshot.collaboration!.runs[blockedBinding.runId].status, 'waiting_input');
  assert.equal(snapshot.collaboration!.tasks[blockedTask].latestSubmissionId, undefined);
  const details = '源码已作为项目材料补充，请继续。';
  assert((await source.controlSession(blockedSessionId, 'reply', { prompt: details })).ok);
  assert.equal(transport.controlPayload?.displayPrompt, details);
  const continuationPrompt = String(transport.controlPayload?.prompt);
  assert.match(continuationPrompt, /上轮 Agent 回报的阻塞：需要包含源码的项目文件夹/);
  assert.doesNotMatch(continuationPrompt, /上次交付未入库/);

  const questionTask=(await create('Do not collect a follow-up question')).taskId;
  assert((await source.dispatch(questionTask,'codex')).ok);const questionRun=transport.records.at(-1)!;
  transport.emit(questionRun,{reply:{id:'needs-input',text:'请提供酒店名称，是否可以继续？'},status:'waiting_reply',turnCompleted:true});await source.flushRuntime();
  snapshot=await source.load();assert.equal(snapshot.collaboration!.tasks[questionTask].latestSubmissionId,undefined);assert.equal(snapshot.sessions[snapshot.tasks[questionTask].sessionIds[0]].runtime!.submissionIssue!.code,'RESULT_REQUIRED');
  const permissionTask=(await create('Do not collect while permission pending')).taskId;
  assert((await source.dispatch(permissionTask,'codex')).ok);const permissionRun=transport.records.at(-1)!;
  transport.emit(permissionRun,{request:{id:'pending',kind:'permission',prompt:'允许访问'},status:'waiting_permission'});await source.flushRuntime();
  transport.emit(permissionRun,{reply:{id:'premature',text:'## Report\nThis result is still awaiting permission.'},status:'waiting_reply',turnCompleted:true});await source.flushRuntime();
  assert.equal((await source.load()).collaboration!.tasks[permissionTask].latestSubmissionId,undefined);
  const quoted=envelope('quoted','result',{title:'Protocol report',body:'Use <quandeck-submission> and </quandeck-submission> as delimiters.'});
  assert('envelope' in readRuntimeSubmission(`<quandeck-submission>${JSON.stringify(quoted)}</quandeck-submission>`)!,'a JSON body may quote delimiters without issuing another command');
  assert('error' in readRuntimeSubmission(`<quandeck-submission>${JSON.stringify(quoted)}</quandeck-submission><quandeck-submission>${JSON.stringify(quoted)}</quandeck-submission>`)!,'concatenated envelopes remain rejected');

  const revisedTask = (await create('Version fencing')).taskId;
  const dispatched = await source.dispatch(revisedTask, 'codex'); assert(dispatched.ok, dispatched.message);
  snapshot = await source.load(); const revisedSessionId = snapshot.tasks[revisedTask].sessionIds[0], old = snapshot.sessions[revisedSessionId].runtime!.collaboration!, oldRun = transport.records.at(-1)!;
  const revision = await source.collaborate({ projectId, idempotencyKey: 'revise-spec', type: 'revise_task', taskId: revisedTask, expectedVersion: snapshot.collaboration!.tasks[revisedTask].version, payload: { goal: 'Updated objective', criteria: ['Verify current objective'], reason: 'User changed the scope' } });
  assert(revision.ok, revision.message);
  transport.emit(oldRun, { reply: { id: 'late', text: `<quandeck-submission>${JSON.stringify(envelope('late', 'result', { title: 'Old result', body: 'Must not overwrite current scope' }, old))}</quandeck-submission>` } }); await source.flushRuntime();
  snapshot = await source.load(); assert.equal(snapshot.sessions[revisedSessionId].runtime!.submissionReceipts!.at(-1)!.code, 'STALE_CLAIM'); assert.equal(snapshot.collaboration!.tasks[revisedTask].specRevision, 2);
  assert.equal((await source.controlSession(revisedSessionId, 'resume')).ok, false, 'old context cannot resume after specification change');

  const unknownTask = (await create('Unknown admission')).taskId; transport.unknown = true;
  const unknown = await source.dispatch(unknownTask, 'codex'); assert.equal(unknown.ok, false);
  const count = transport.calls.length; await source.dispatch(unknownTask, 'codex'); assert.equal(transport.calls.length, count, 'unknown acceptance is never blindly resent');
  const unknownSessionId = (await source.load()).tasks[unknownTask].sessionIds[0];
  assert.equal((await source.retryDispatch(unknownSessionId)).ok, false);
  const admitted = transport.records.at(-1)!; admitted.acceptance = 'acknowledged';
  assert((await source.reconcile(unknownSessionId)).ok);
  snapshot = await source.load(); const reconciledBinding = snapshot.sessions[unknownSessionId].runtime!.collaboration!;
  assert.equal(snapshot.collaboration!.runs[reconciledBinding.runId].status, 'queued', 'a real receipt reconciles the existing lost run without dispatching again');
  transport.emit(admitted, { reply: { id: 'reconciled-candidate', text: `<quandeck-submission>${JSON.stringify(envelope('reconciled-result', 'result', { title: 'Recovered output', body: 'Existing source confirmed without duplication' }, reconciledBinding))}</quandeck-submission>` }, status: 'done' }); await source.flushRuntime();
  assert.equal((await source.load()).collaboration!.tasks[unknownTask].status, 'in_review');
  assert.equal(transport.calls.length, count);
  transport.unknown = false;
  const idea = await source.createIdea('Plan the handoff'); const discussion = await source.startDiscussion(idea.planId, 'codex'); assert(discussion.ok, discussion.message);
  snapshot = await source.load(); const planning = snapshot.sessions[discussion.sessionId!];
  assert.notEqual(planning.taskId, idea.taskId); assert.equal(planning.runtime!.purpose, 'discussion'); assert(snapshot.collaboration!.tasks[planning.taskId!]); assert.equal(snapshot.tasks[idea.taskId].sessionIds.length, 0);
  assert.equal(readRuntimeSubmission('example: <quandeck-submission>{}</quandeck-submission>'), null);
  assert.equal(readRuntimeSubmission('ordinary completion claim'), null);
  assert('error' in readRuntimeSubmission('<quandeck-submission>{}</quandeck-submission>')!);
  const persistedPrompt = snapshot.collaboration!.contextPackages.find(value => value.id === planning.runtime!.collaboration!.contextPackageId)!.prompt;
  transport.records.find(value => value.runId === planning.runtime!.runId)!.status = 'paused';
  await source.syncRuntime(); snapshot = await source.load();
  assert.equal(snapshot.sessions[planning.id].status, 'paused'); assert.equal(snapshot.collaboration!.contextPackages.find(value => value.id === planning.runtime!.collaboration!.contextPackageId)!.prompt, persistedPrompt); assert.equal(transport.calls.length, count + 1);
  await source.createProject({ name: 'DSH restart boundaries' });
  await source.registerAgent({ id: 'dsh', name: 'DSH', short: 'DSH', color: '#123456' });
  await source.bindRuntimeConnection('dsh', { tool: 'dsh', connectionId: 'rc2-test', projectPath: '/rc2-test', protocol: 'legacy-rc2', capabilities: { resume: false } });
  const rc2Task = (await create('Preserve rc2 source history')).taskId;
  assert((await source.dispatch(rc2Task, 'dsh')).ok);
  const rc2Record = transport.records.at(-1)!;
  rc2Record.status = 'paused'; rc2Record.protocol = 'legacy-rc2'; rc2Record.controls = { canResume: false, canReply: false };
  const restored = await source.syncRuntime(); assert(restored.ok); assert(!restored.message?.includes('等待手动继续'));
  snapshot = await source.load();
  const rc2SessionId = snapshot.tasks[rc2Task].sessionIds[0], managedRc2 = snapshot.sessions[rc2SessionId].runtime!.collaboration!.runId;
  assert.equal(snapshot.sessions[rc2SessionId].runtime!.protocol, 'legacy-rc2');
  assert.match(snapshot.collaboration!.runs[managedRc2].error!, /不能恢复/);
  source.dispose();
  const emptyTransport = new Transport(), recoveredSource = createRuntimeDataSource(new LocalWorkdeckDataSource(), emptyTransport);
  assert((await recoveredSource.syncRuntime()).ok);
  const recovered = await recoveredSource.load();
  assert.match(recovered.collaboration!.runs[managedRc2].error!, /不能恢复/);
  assert.equal(recovered.sessions[rc2SessionId].runtime!.capabilities!.context, 'new-source-session');
  assert.equal(emptyTransport.calls.length, 0, 'restart never replays a closed rc2 source');
  assert.equal(emptyTransport.recovered.find(record => record.runId === rc2Record.runId)?.protocol, 'legacy-rc2', 'runtime recovery retains protocol restrictions');
  recoveredSource.dispose();
  await durableSubmissionReplay();
  await concurrentFileEventFence();
  await boundedContextDispatch();
  await reworkAttachmentDispatch();
  await selectedResultDispatch();
  await projectDispatchIndex();
  console.log('runtime collaboration contract passed');
}
async function durableSubmissionReplay(){
  memory.clear();
  const base=new LocalWorkdeckDataSource(),transport=new Transport(),runtime=createRuntimeDataSource(base,transport);
  const projectId=(await runtime.createProject({name:'固定文件请求幂等'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});
  await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'replay-test',projectPath:'/replay-test'});
  const blockId=await runtime.addBlock('task','Frozen file request'),snapshot=await runtime.load();
  const taskId=(snapshot.journal.blocks.find(block=>block.id===blockId) as {taskId:string}).taskId;
  const defined=await runtime.applyDeliveryChange(projectId,{planId:`delivery:${taskId}`,taskId,expectedVersion:0,idempotencyKey:'define-file',reason:'Require a real file',operations:[{type:'add',slot:{id:'file',title:'Frozen document',taskKey:taskId,contract:{revision:1,kind:'file',format:'md',required:true,criteria:['Read file']}}}]});assert(defined.ok,defined.message);
  const slot=defined.slots[0];assert((await runtime.dispatch(taskId,'codex')).ok);
  let state=await runtime.load();const sessionId=state.tasks[taskId].sessionIds[0],binding=state.sessions[sessionId].runtime!.collaboration!,run=transport.records[0];
  const request={schemaVersion:RUNTIME_SUBMISSION_VERSION,idempotencyKey:'logical-file-result',binding,kind:'result',payload:{title:'Frozen delivery',body:'See the independently verified file.',deliveryItems:[{slotId:slot.id,contractRevision:slot.contract!.revision,path:'result.md'}]}};
  const commandKey=`agent:${binding.runId}:${request.idempotencyKey}`;
  let checks=0;
  transport.verifyDeliveryFiles=async()=>{checks++;throw Error('file not ready');};
  const send=async(value:unknown)=>{transport.emit(run,{submission:value});await runtime.flushRuntime();return runtime.load();};
  state=await send(request);assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.code,'DELIVERY_FILE_UNVERIFIED');assert.equal(state.sessions[sessionId].runtime!.submissionCommands?.[commandKey],undefined,'a failed verification cannot reserve a successful request');
  transport.verifyDeliveryFiles=async()=>{checks++;return [{attachmentId:'frozen-result',name:'result.md',bytes:15,sha256:hashText('frozen delivery'),verifiedAt:new Date().toISOString(),path:'result.md'}];};
  state=await send(request);assert.equal(checks,2);assert(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.ok);assert(state.sessions[sessionId].runtime!.submissionCommands?.[commandKey]);assert(state.collaboration!.receipts[commandKey]);
  const resourceId=state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.resourceId,count=state.collaboration!.submissions.length;
  transport.verifyDeliveryFiles=async()=>{checks++;throw Error('original file was removed or overwritten');};
  state=await send(request);assert.equal(checks,2,'successful replay never rereads the mutable original path');assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.resourceId,resourceId);assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.replayed,true);assert.equal(state.collaboration!.submissions.length,count);
  state=await send({...request,payload:{...request.payload,body:'changed content'}});assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.code,'IDEMPOTENCY_CONFLICT');assert.equal(checks,2,'conflicting requests cannot trigger another filesystem read');
  state=await send({...request,kind:'checkpoint',payload:{completed:[],remaining:[],note:'different command'}});assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.code,'IDEMPOTENCY_CONFLICT');
  state=await send({...request,binding:{...binding,contextPackageId:'different-context'}});assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.code,'SCOPE_MISMATCH');
  const reopened=await runtime.collaborate({projectId,taskId,type:'reopen',idempotencyKey:'reopen-after-result',expectedVersion:state.collaboration!.tasks[taskId].version,payload:{reason:'New work requested'}});assert(reopened.ok,reopened.message);
  state=await send(request);assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.replayed,true);assert.equal(state.collaboration!.tasks[taskId].status,'ready','replay cannot undo newer task state');assert.equal(checks,2);
  runtime.dispose();
  const restoredTransport=new Transport();restoredTransport.records=[run];restoredTransport.clock=transport.clock;restoredTransport.verifyDeliveryFiles=async()=>{throw Error('restarted process must not touch original path');};
  const restored=createRuntimeDataSource(new LocalWorkdeckDataSource(),restoredTransport);restoredTransport.emit(run,{submission:request});await restored.flushRuntime();state=await restored.load();assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.resourceId,resourceId);assert.equal(state.sessions[sessionId].runtime!.submissionReceipts!.at(-1)!.replayed,true);restored.dispose();

  // A late transaction failure must persist neither the domain submission nor
  // its original-request receipt; a retry is still a fresh, valid attempt.
  memory.clear();const atomicBase=new LocalWorkdeckDataSource(),atomicTransport=new Transport(),atomicRuntime=createRuntimeDataSource(atomicBase,atomicTransport);
  const atomicProject=(await atomicRuntime.createProject({name:'Atomic submission'})).projectId!;
  await atomicRuntime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});await atomicRuntime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'atomic-test',projectPath:'/atomic-test'});
  const atomicBlock=await atomicRuntime.addBlock('task','Atomic proof');state=await atomicRuntime.load();const atomicTask=(state.journal.blocks.find(block=>block.id===atomicBlock) as {taskId:string}).taskId;assert((await atomicRuntime.dispatch(atomicTask,'codex')).ok);
  state=await atomicRuntime.load();const atomicSession=state.tasks[atomicTask].sessionIds[0],atomicBinding=state.sessions[atomicSession].runtime!.collaboration!,atomicRun=atomicTransport.records[0];
  const atomicRequest={schemaVersion:RUNTIME_SUBMISSION_VERSION,idempotencyKey:'atomic',binding:atomicBinding,kind:'result',payload:{title:'Atomic result',body:'One transaction'}};
  const atomicKey=`agent:${atomicBinding.runId}:atomic`,mutate=atomicBase.mutateRuntimeProject.bind(atomicBase);
  atomicBase.mutateRuntimeProject=(project,operation)=>mutate(project,d=>{operation(d);if(d.sessions[atomicSession]?.runtime?.submissionCommands?.[atomicKey])throw Error('simulated commit rejection');});
  atomicTransport.emit(atomicRun,{submission:atomicRequest});await assert.rejects(atomicRuntime.flushRuntime(),/simulated commit rejection/);state=await atomicRuntime.load();assert.equal(state.sessions[atomicSession].runtime!.submissionCommands?.[atomicKey],undefined);assert.equal(state.collaboration!.receipts[atomicKey],undefined);assert.equal(state.collaboration!.submissions.length,0);
  atomicBase.mutateRuntimeProject=mutate;atomicTransport.emit(atomicRun,{submission:atomicRequest});await atomicRuntime.flushRuntime();state=await atomicRuntime.load();assert(state.sessions[atomicSession].runtime!.submissionCommands?.[atomicKey]);assert(state.collaboration!.receipts[atomicKey]);assert.equal(state.collaboration!.submissions.length,1);atomicRuntime.dispose();
}
void main();

async function reworkAttachmentDispatch() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(), driver = new Transport(), runtime = createRuntimeDataSource(base,driver);
  const projectId = (await runtime.createProject({name:'返工资料范围'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#123456'});
  await runtime.bindRuntimeConnection('codex',{connectionId:'rework-agent',tool:'codex',projectPath:'/fixture'});
  const create = async (title: string) => (await runtime.collaborate({projectId,type:'create_task',idempotencyKey:title,payload:{title,goal:title,criteria:['能找到入口'],owner:'agent'}})).resourceId!;
  const taskId = await create('简化入口');
  const other = await create('整理活动手册');
  const file = {id:'fixture-screenshot',name:'入口截图.png',type:'image/png',size:24,sha256:'b'.repeat(64)};
  const submitted = await runtime.saveTaskOutput({projectId,taskId,title:'初稿',body:'原稿中的按钮放在右上角。',status:'published',attachments:[file]});
  assert(submitted.ok,submitted.message);
  const task = (await runtime.load()).collaboration!.tasks[taskId];
  const review = await runtime.collaborate({projectId,taskId,type:'review',expectedVersion:task.version,idempotencyKey:'return',payload:{submissionId:task.latestSubmissionId,verdict:'needs_changes',checks:[false],note:'请把按钮移到回复旁边'}});
  assert(review.ok,review.message);
  driver.prepareSourceAttachments = async request => {
    assert.equal(request.reworkReviewId,review.resourceId);
    assert.equal(request.taskId,taskId);
    return [{...file,path:'/fixture/checked/screen.png'}];
  };
  const started = await runtime.dispatch(taskId,'codex');
  assert(started.ok,started.message);
  const prompt = driver.calls.at(-1)!.prompt;
  for (const expected of ['请把按钮移到回复旁边','原稿中的按钮放在右上角','/fixture/checked/screen.png']) assert(prompt.includes(expected));
  assert((await runtime.dispatch(other,'codex')).ok);
  assert.doesNotMatch(driver.calls.at(-1)!.prompt,/fixture-screenshot|原稿中的按钮放在右上角|把按钮移到回复旁边/);
  runtime.dispose();
}

async function concurrentFileEventFence(){
  memory.clear();const base=new LocalWorkdeckDataSource(),transport=new Transport(),runtime=createRuntimeDataSource(base,transport);
  const projectId=(await runtime.createProject({name:'Concurrent file event fence'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#111111'});await runtime.bindRuntimeConnection('codex',{tool:'codex',connectionId:'race-test',projectPath:'/race-test'});
  const block=await runtime.addBlock('task','Pinned file race');let state=await runtime.load();const taskId=(state.journal.blocks.find(b=>b.id===block) as {taskId:string}).taskId;
  const defined=await runtime.applyDeliveryChange(projectId,{planId:`delivery:${taskId}`,taskId,expectedVersion:0,idempotencyKey:'race-define',reason:'Synthetic concurrency proof',operations:[{type:'add',slot:{id:'file',title:'File',taskKey:taskId,contract:{revision:1,kind:'file',format:'md',required:true,criteria:['Read']}}}]});assert(defined.ok,defined.message);assert((await runtime.dispatch(taskId,'codex')).ok);
  state=await runtime.load();const sessionId=state.tasks[taskId].sessionIds[0],binding=state.sessions[sessionId].runtime!.collaboration!,run=transport.records[0];
  let release!:()=>void,entered!:()=>void,reads=0;const reading=new Promise<void>(resolve=>entered=resolve);
  transport.verifyDeliveryFiles=async()=>{if(++reads===1){entered();await new Promise<void>(resolve=>release=resolve);}return[{attachmentId:'frozen-file',name:'race.md',bytes:5,sha256:'b'.repeat(64),verifiedAt:new Date().toISOString(),path:'race.md'}];};
  transport.emit(run,{status:'waiting_reply',tokens:5,submission:{schemaVersion:RUNTIME_SUBMISSION_VERSION,idempotencyKey:'race-result',binding,kind:'result',payload:{title:'File',body:'Fixed bytes',deliveryItems:[{slotId:defined.slots[0].id,contractRevision:1,path:'race.md'}]}}});await reading;
  // The driver polling snapshot sees seq=1 while seq=0's stream file IO is pending.
  const newer:RuntimeEvent={id:'poll-newer',sequence:1,at:new Date(transport.clock+=1000).toISOString(),runId:run.runId,sessionId:run.sessionId,status:'paused',tokens:20,stoppedConfirmed:true};run.events!.push(newer);run.status='paused';
  await runtime.syncRuntime();state=await runtime.load();const before=structuredClone(state.sessions[sessionId]);assert.equal(before.runtime!.sequence,1);assert.equal(before.status,'paused');
  release();await runtime.flushRuntime();state=await runtime.load();const after=state.sessions[sessionId];
  assert.equal(after.runtime!.sequence,1,'stale stream IO must not move cursor backwards');assert.equal(after.status,'paused');assert.equal(after.tokens,20);assert.equal(after.lastActivity,newer.at);assert.deepEqual(after.runtime!.submissionReceipts,before.runtime!.submissionReceipts,'stale event does not append another receipt or schedule follow-up work');assert.deepEqual(after.runtime!.eventIds,before.runtime!.eventIds);assert.equal(state.collaboration!.submissions.length,1);runtime.dispose();
}


async function boundedContextDispatch() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(), transport = new Transport(), source = createRuntimeDataSource(base, transport);
  const description = '完整项目要求。'.repeat(750) + 'PROJECT_REQUIREMENT_TAIL';
  const projectId = (await source.createProject({ name: 'Bounded mandatory input', description })).projectId!;
  await source.registerAgent({ id: 'codex', name: 'Codex', short: 'C', color: '#123456' });
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'bounded-test', projectPath: '/bounded-test' });
  const create = async (title: string) => {
    const blockId = await source.addBlock('task', title);
    const state = await source.load();
    return (state.journal.blocks.find(block => block.id === blockId) as { taskId: string }).taskId;
  };
  const taskId = await create('Execute a small part with full project requirements');
  const started = await source.dispatch(taskId, 'codex');
  assert(started.ok, started.message);
  assert.equal(transport.calls.length, 1);
  assert(transport.calls[0].prompt.includes(description), 'dispatch preserves original project requirements including tail');
  let snapshot = await source.load();
  const context = snapshot.collaboration!.contextPackages.at(-1)!;
  assert.equal(context.targetTokenBudget, 6000);
  assert(context.tokenBudget! > 7000 && context.tokenBudget! <= 48000);
  assert.equal(context.budgetExpansion?.reason, 'complete-required-input');
  assert.equal(context.budgetExpansion?.requiredTokens, context.tokenBudget);
  assert.equal(context.memoryEstimatedTokens, context.tokenBudget);
  assert.equal(context.transportTokenBudget, context.tokenBudget! + 10000);
  assert(context.estimatedTokens <= context.transportTokenBudget!);

  // A default expansion has a hard application bound. No provider call or claim is committed beyond it.
  const tooLarge = '不可省略的项目要求。'.repeat(4000) + 'OVER_HARD_TAIL';
  assert((await source.updateProject(projectId, { description: tooLarge })).ok);
  const rejectedTask = await create('Task exceeding required input bound');
  const before = await source.load();
  const rejected = await source.dispatch(rejectedTask, 'codex');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message!, /48000/);
  snapshot = await source.load();
  assert.equal(transport.calls.length, 1, 'over-hard mandatory input never reaches the driver');
  assert.deepEqual(snapshot.tasks[rejectedTask].sessionIds, []);
  assert.equal(snapshot.collaboration!.contextPackages.length, before.collaboration!.contextPackages.length);
  assert.equal(Object.keys(snapshot.collaboration!.runs).length, Object.keys(before.collaboration!.runs).length);
  assert.equal(snapshot.collaboration!.tasks[rejectedTask].claimEpoch, before.collaboration!.tasks[rejectedTask].claimEpoch);

  // Final transport includes extra task input. The complete assembled payload is checked before driver.run.
  assert((await source.updateProject(projectId, { description: 'Small project' })).ok);
  const finalTask = await create('Final transport budget fence');
  assert((await source.addTaskInput(projectId, finalTask, '本任务额外要求。'.repeat(2000), 'large-task-input')).ok);
  const beforeFinal = await source.load();
  const finalRejected = await source.dispatch(finalTask, 'codex');
  assert.equal(finalRejected.ok, false);
  assert.match(finalRejected.message!, /资料容量/);
  snapshot = await source.load();
  assert.equal(transport.calls.length, 1, 'over-limit final payload never reaches the driver');
  assert.deepEqual(snapshot.tasks[finalTask].sessionIds, []);
  assert.equal(snapshot.collaboration!.contextPackages.length, beforeFinal.collaboration!.contextPackages.length);
  assert.equal(snapshot.collaboration!.tasks[finalTask].claimEpoch, beforeFinal.collaboration!.tasks[finalTask].claimEpoch);
  source.dispose();
}

async function selectedResultDispatch() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(), driver = new Transport(), runtime = createRuntimeDataSource(base,driver);
  const projectId = (await runtime.createProject({name:'成果续做'})).projectId!;
  await runtime.registerAgent({id:'codex',name:'Codex',short:'C',color:'#123456'});
  await runtime.bindRuntimeConnection('codex',{connectionId:'continuation-agent',tool:'codex',projectPath:'/fixture'});
  const taskId = (await runtime.collaborate({projectId,type:'create_task',idempotencyKey:'original',payload:{title:'画导航原型',goal:'设计页面',criteria:['两层导航'],owner:'agent'}})).resourceId!;
  const saved = await runtime.saveTaskOutput({projectId,taskId,title:'导航草图',body:'顶部显示标签栏，次级页面显示返回键。',status:'published'});
  assert(saved.ok,saved.message);
  const pick = async () => listResultContinuations(await runtime.load())[0];
  const choice = await pick();
  assert(choice && choice.status==='candidate');
  assert.match(choice.ledger,/两层导航/);
  const text='这里是笔记摘录', requirement='写出路由和页面测试';
  const origin={key:noteTaskKey('design-note',0,text),title:'开发记事',noteSource:{noteId:'design-note',lineIndex:0},
    dispatch:{agentId:'codex',logic:[]},continuation:{...choice.pin,requirement}};
  const register = (selection=origin.continuation) => runtime.createTaskWithAttachments(text,[],projectId,{...origin,continuation:selection});
  assert.equal((await register({...origin.continuation,projectId:'unrelated'})).ok,false);
  assert.equal((await register({...origin.continuation,hash:'wrong'})).ok,false);
  assert.equal((await register({...origin.continuation,memoryHash:'old'})).ok,false);
  const images=Array.from({length:6},(_,i)=>({id:'img-'+i,name:'image-'+i+'.png',type:'image/png',size:10}));
  const inlineIds=images.slice(2).map(file=>file.id);
  const withImages = await runtime.createTaskWithAttachments(text,images,projectId,
    {...origin,continuation:{...origin.continuation,requirement:'标注六幅设计图'},noteImageIds:inlineIds});
  assert(withImages.ok && withImages.taskId,withImages.message);
  const overflow = await runtime.createTaskWithAttachments(text,images,projectId,
    {...origin,continuation:{...origin.continuation,requirement:'标注五幅设计图'},noteImageIds:images.slice(1).map(file=>file.id)});
  assert(!overflow.ok);
  driver.prepareAttachments = async ({ids,imageIds})=>{
    assert.deepEqual(imageIds,inlineIds);
    return ids.map(id=>({id,name:id+'.png',path:'/project/'+id+'.png',sha256:'a'.repeat(64),
      ...(imageIds?.includes(id) && {imageUrl:'data:image/png;base64,AA=='})}));
  };
  const six=await runtime.dispatchProjectTask(projectId,withImages.taskId,'codex');
  assert(six.ok,six.message);
  assert.deepEqual(driver.calls.at(-1)?.noteImageIds,inlineIds);
  assert(driver.calls.at(-1)?.prompt.includes('/project/img-0.png'));
  const ordinary=await runtime.createTaskWithAttachments(text,[],projectId,{...origin,continuation:undefined});
  const registered = await register();
  assert(registered.ok && registered.taskId && registered.dispatchMode==='start',registered.message);
  assert.notEqual(registered.taskId,ordinary.taskId);
  assert.equal((await register()).taskId,registered.taskId);
  assert.notEqual((await register({...origin.continuation,requirement:'说明无障碍设计'})).taskId,registered.taskId);
  const sent=await runtime.dispatchProjectTask(projectId,registered.taskId,'codex');
  assert(sent.ok,sent.message);
  const prompt=driver.calls.at(-1)!.prompt;
  for (const part of [text,requirement,choice.title,choice.body,choice.blackboard,choice.ledger,choice.pin.hash,'候选，尚未验收'])
    assert(prompt.includes(part),'first turn should include '+part);
  assert.deepEqual((await runtime.load()).tasks[registered.taskId].inputs![0].continuation,origin.continuation);
  const plainText='另外核对菜单一致性';
  const plain=await runtime.createTaskWithAttachments(plainText,[],projectId,{...origin,continuation:undefined,key:noteTaskKey('design-note',0,plainText)});
  const overlap=await register({...origin.continuation,requirement:plainText});
  assert.notEqual(overlap.taskId,plain.taskId,'a prior ordinary task cannot absorb a selected original');
  assert.equal(overlap.dispatchMode,'conflict','equal work with different materials is explicitly coordinated');
  assert((await runtime.load()).tasks[overlap.taskId!].inputs?.some(input=>input.continuation && 'artifactId' in input.continuation && input.continuation.artifactId===choice.pin.artifactId));
  const task = (await runtime.load()).collaboration!.tasks[taskId];
  const review = await runtime.collaborate({projectId,type:'review',taskId,expectedVersion:task.version,idempotencyKey:'return-nav',
    payload:{submissionId:task.latestSubmissionId,verdict:'needs_changes',note:'检查触屏操作',checks:[false]}});
  assert(review.ok,review.message);
  const returned=await pick();
  assert(returned.returned && returned.status==='candidate');
  assert.match(returned.blackboard,/检查触屏操作/);
  assert.equal((await register()).ok,false,'a stale preview cannot become a new dispatch');
  const revised=await runtime.saveTaskOutput({projectId,taskId,title:'导航触屏版',body:'底部使用触屏导航。',status:'published'});
  assert(revised.ok,revised.message);
  const current=await runtime.load();
  const choices=listResultContinuations(current);
  const older=choices.find(row=>row.pin.artifactId===choice.pin.artifactId)!;
  const newer=choices.find(row=>row.title==='导航触屏版')!;
  assert(older.historical && !newer.historical && older.body===choice.body);
  assert.match(continuationPrompt(current,{...older.pin,requirement} ),/历史版本，仅作参考/);
  assert.throws(()=>continuationPrompt(current,{...returned.pin,requirement}),/已更新/);
  assert.notEqual((await register({...newer.pin,requirement})).taskId, registered.taskId);
  const files = [
    {id:'original-readme',name:'README.md',size:12,type:'text/markdown'},
    {id:'revised-readme',name:'README.md',size:20,type:'text/markdown'},
    {id:'shared',name:'protocol.md',size:18,type:'text/markdown'},
  ];
  const combined = {
    requirement: '对比两个版本的布局差异并列出各自的文件',
    sources: [{...older.pin,fileIds:[files[0].id,'shared']}, {...newer.pin,fileIds:[files[1].id,'shared']}],
  };
  const sendBoth = (sources=combined.sources, selectedFiles=files) => runtime.createTaskWithAttachments(text,selectedFiles,projectId,
    {...origin,noteImageIds:[],continuation:{...combined,sources}});
  const countBefore = Object.keys((await runtime.load()).tasks).length;
  for (const invalid of [[], [combined.sources[0],combined.sources[0]], [combined.sources[0],{...combined.sources[1],projectId:'elsewhere'}],
    [combined.sources[0], {...combined.sources[1],memoryHash:'outdated'}], [combined.sources[0],{...combined.sources[1],hash:'old'}],
    [combined.sources[0],{...combined.sources[1],fileIds:['shared']}], [combined.sources[0],{...combined.sources[1],fileIds:['wrong-file']} ]]) {
    assert(!(await sendBoth(invalid)).ok,'invalid selection cannot create a partial task');
  }
  assert.equal(Object.keys((await runtime.load()).tasks).length,countBefore);
  const multi=await sendBoth();
  assert(multi.ok && multi.taskId,multi.message);
  assert.equal((await sendBoth([...combined.sources].reverse().map(s=>({...s,fileIds:[...s.fileIds].reverse()})),[...files].reverse())).taskId,multi.taskId);
  assert.equal(Object.keys((await runtime.load()).tasks).length,countBefore+1);
  driver.prepareAttachments = async ({ids}) => ids.map(id=>({id,name:files.find(f=>f.id===id)!.name,
    path:'/project/attachments/'+id+'/'+files.find(f=>f.id===id)!.name,sha256:'a'.repeat(64)}));
  const dispatch = await runtime.dispatchProjectTask(projectId,multi.taskId,'codex');
  assert(dispatch.ok,dispatch.message);
  const multiPrompt = driver.calls.at(-1)!.prompt;
  for (const [choice, file] of [[older,files[0]], [newer,files[1]]] as const) {
    const fragment = multiPrompt.split('来源：'+choice.pin.artifactId+' · sha256='+choice.pin.hash)[1].split('相关黑板：')[0];
    assert(fragment.includes(choice.body));
    assert(fragment.includes('/project/attachments/'+file.id+'/README.md'));
    assert(fragment.includes('/project/attachments/shared/protocol.md'));
    assert(!fragment.includes(file===files[0] ? 'revised-readme' : 'original-readme'));
  }
  assert(multiPrompt.includes(combined.requirement));
  const pending = await runtime.createTaskWithAttachments(text,files,projectId,{...origin,
    continuation:{...combined,requirement:'汇总版本演变时间线'}});
  assert(pending.ok && pending.taskId,pending.message);
  const latest = (await runtime.load()).collaboration!.tasks[taskId];
  assert((await runtime.collaborate({projectId,type:'review',taskId,expectedVersion:latest.version,idempotencyKey:'reject-latest-layout',
    payload:{submissionId:latest.latestSubmissionId,verdict:'needs_changes',note:'补上来源说明',checks:[false]}})).ok);
  const deliveries=driver.calls.length;
  const changed = await runtime.dispatchProjectTask(projectId,pending.taskId,'codex');
  assert.equal(changed.ok,false);
  assert.match(changed.message!,/成果或关联的项目记忆已更新/);
  assert.equal(driver.calls.length,deliveries,'a stale member blocks the whole first turn');
  assert.deepEqual((await runtime.load()).tasks[pending.taskId].sessionIds,[]);

  for (const [index, receiptTask] of [withImages.taskId!,registered.taskId!,multi.taskId!].entries()) {
    const record=driver.records.find(row=>row.taskId===receiptTask)!;
    const bound=record.collaboration!;
    if (index===1) base.mutateRuntimeProject(projectId,d=>{
      const legacy=d.collaboration!.contextPackages.find(c=>c.id===bound.contextPackageId)!;
      delete legacy.continuationReference;
    });
    const owned=await runtime.load();
    const context=owned.collaboration!.contextPackages.find(c=>c.id===bound.contextPackageId)!;
    if (index === 2) {
      const expected = [older.pin,newer.pin].sort((a,b)=>a.artifactId.localeCompare(b.artifactId));
      assert.deepEqual(context.continuationReferences,expected);
      assert.deepEqual(runContinuationReferences(owned,context),expected);
      assert.deepEqual(runContinuationReferences(owned,{...context,continuationReferences:[expected[0]]}),[]);
      const edited = structuredClone(owned);
      edited.collaboration!.artifacts.find(a=>a.id===newer.pin.artifactId)!.body+='modified';
      assert.deepEqual(runContinuationReferences(edited,context),[],'one corrupt member cannot authorize partial provenance');
      const sourceIds=expected.map(pin=>pin.artifactId);
      const submit=async (ids:string[],key:string)=>{
        driver.emit(record,{reply:{id:key,text:'<quandeck-submission>'+JSON.stringify({schemaVersion:RUNTIME_SUBMISSION_VERSION,
          idempotencyKey:key,binding:bound,kind:'result',payload:{title:'汇总两个版本',body:'逐版对照完成',sourceIds:ids}})+'</quandeck-submission>'}});
        await runtime.flushRuntime();
        const snap=await runtime.load();
        return {snap,receipt:Object.values(snap.sessions).find(s=>s.runtime?.collaboration?.runId===bound.runId)!.runtime!.submissionReceipts!.at(-1)!};
      };
      const rejected=await submit([...sourceIds,'extra-reference'],'unexpected-reference');
      assert.equal(rejected.receipt.code,'REFERENCE_INVALID');
      const accepted=await submit(sourceIds,'two-originals');
      assert(accepted.receipt.ok,accepted.receipt.message);
      const output=accepted.snap.collaboration!.artifacts.find(a=>a.runId===bound.runId)!;
      assert.deepEqual(output.continuationReferences,expected);
      assert(!output.sourceIds.some(id=>sourceIds.includes(id)),'historical references stay separate from accepted dependencies');
      continue;
    }
    assert.deepEqual(runContinuationReference(owned,context),choice.pin,'new and pre-pin runs recover the exact selected candidate after it became historical');
    assert(!runContinuationReference(owned,{...context,key:taskId}),'another task cannot use the selected reference');
    const wrongSource=structuredClone(owned);
    const foreign = wrongSource.tasks[receiptTask].inputs![0].continuation!;
    assert('projectId' in foreign);
    foreign.projectId='another-project';
    assert(!runContinuationReference(wrongSource,context));
    const edited=structuredClone(owned);
    edited.collaboration!.artifacts.find(a=>a.id===choice.pin.artifactId)!.body+='modified';
    assert(!runContinuationReference(edited,context),'a changed artifact body cannot reuse the citation');
    if (index===1) assert(!runContinuationReference(owned,{...context,prompt:'different prompt'}),'legacy selection also requires the actual frozen run prompt');
    if (index===1) {
      const sparse=structuredClone(owned);
      const oldSession=Object.values(sparse.sessions).find(row=>row.runtime?.collaboration?.runId===bound.runId);
      assert(oldSession?.runtime);
      Reflect.deleteProperty(oldSession.runtime,'context');
      assert(!runContinuationReference(sparse,context),'older records missing the prompt are not authorized by inferred ownership');
    }
    const submit=async (id:string,key:string)=>{
      driver.emit(record,{reply:{id:key,text:'<quandeck-submission>'+JSON.stringify({schemaVersion:RUNTIME_SUBMISSION_VERSION,idempotencyKey:key,binding:bound,kind:'result',payload:{title:'implemented',body:'tested implementation',sourceIds:[id]}})+'</quandeck-submission>'}});
      await runtime.flushRuntime();
      const state=await runtime.load();
      return {state,receipt:Object.values(state.sessions).find(s=>s.runtime?.collaboration?.runId===bound.runId)!.runtime!.submissionReceipts!.at(-1)!};
    };
    const rejected=await submit(newer.pin.artifactId,'unselected-'+index);
    assert.equal(rejected.receipt.code,'REFERENCE_INVALID','sibling version in the same project is outside this run');
    const accepted=await submit(choice.pin.artifactId,'original-'+index);
    assert(accepted.receipt.ok,accepted.receipt.message);
    const output=accepted.state.collaboration!.artifacts.find(a=>a.runId===bound.runId)!;
    assert.deepEqual(output.continuationReference,choice.pin);
    assert(!output.sourceIds.includes(choice.pin.artifactId),'a returned reference does not become an accepted dependency');
  }
  const oldArtifact=current.collaboration!.artifacts.find(row=>row.id===older.pin.artifactId)!;
  oldArtifact.body='[未固定的图](old/prototype.html)';
  oldArtifact.hash=hashText(oldArtifact.body);
  assert(!findResultContinuation(current,oldArtifact.id),'a mutable historical file must not be silently reused');
  runtime.dispose();
}

async function projectDispatchIndex() {
  memory.clear();
  const driver = Object.assign(new Transport(), { contextAccess: () => 'fixture index reader' });
  const api = createRuntimeDataSource(new LocalWorkdeckDataSource(), driver);
  const makeProject = async () => (await api.createProject({name:'同名项目'})).projectId!;
  const add = async (projectId: string, title: string) =>
    (await api.createTaskWithAttachments(title, [], projectId)).taskId!;
  const a = await makeProject();
  await api.registerAgent({id:'codex',name:'Codex',short:'Codex',color:'#123456'});
  await api.bindRuntimeConnection('codex',{tool:'codex',connectionId:'fixture-memory',projectPath:'/fixture/memory'});
  const peer = await add(a,'梨园苗木');
  const target = await add(a,'翻译戏曲');
  const b = await makeProject();
  const foreign = await add(b,'船坞私有事项');
  const revision = (await api.listProjects()).find(project => project.project.id === a)!.collaboration!.tasks[peer].version;
  const receipt = await api.collaborate({projectId:a,taskId:peer,expectedVersion:revision,type:'submit',
    idempotencyKey:'fixture-index-submit',payload:{title:'清单',body:'未经选择的材料正文'}});
  assert(receipt.ok,receipt.message);
  const first = await api.dispatchProjectTask(a,target,'codex');
  assert(first.ok,first.message);
  const prompt = driver.calls[0].prompt;
  for (const value of [peer,'待验收','梨园苗木','v1 清单 [未验收]']) assert(prompt.includes(value),value);
  for (const value of [foreign,'船坞私有事项','未经选择的材料正文']) assert(!prompt.includes(value),value);

  // One long task title forces a paged index. No derived table needs an asynchronous export.
  await add(a,'归档前的索引资料'.repeat(75));
  for (let i=0; i<12; i++) await add(a, '运输记录 ' + i + '，' + '路段摘要'.repeat(40));
  const another = await add(a,'校对目录');
  assert((await api.dispatchProjectTask(a,another,'codex')).ok);
  const snap = (await api.listProjects()).find(project => project.project.id === a)!;
  const call = driver.calls[1], bound = call.collaboration!;
  const pack = snap.collaboration!.contextPackages.find(row => row.id === bound.contextPackageId)!;
  assert(pack.projectIndexHash && call.prompt.includes('artifactId=project-index'));
  assert(call.prompt.includes('fixture index reader'));
  assert(!call.prompt.includes(foreign));
  const request = {projectId:a, contextPackageId:pack.id, artifactId:'project-index', hash:pack.projectIndexHash, limit:100};
  const read = (offset:number) => readContextEvidence(snap,{...request,offset},bound);
  let page=read(0), reconstructed=page.text;
  while (page.nextOffset !== null) {
    page=read(page.nextOffset);
    reconstructed+=page.text;
  }
  assert(reconstructed.includes('运输记录 11'));
  assert(reconstructed.includes(target) && reconstructed.includes('执行中'));
  assert(!reconstructed.includes(foreign) && !reconstructed.includes('未经选择的材料正文'));
  assert.equal(hashText(reconstructed),pack.projectIndexHash);
  assert(readContextEvidence(snap,{...request,query:'运输记录 11',limit:4000},bound).text.includes('运输记录 11'));
  assert.equal(readContextEvidence(snap,{...request,query:'无匹配'},bound).text,'');
  assert.throws(()=>readContextEvidence(snap,{...request,hash:'altered'},bound),{code:'SOURCE_NOT_IN_CONTEXT'});
  assert.throws(()=>readContextEvidence(snap,{...request,projectId:b},bound),{code:'READ_SCOPE_REVOKED'});
  assert.throws(()=>readContextEvidence(snap,request,{...bound,claimEpoch:0}),{code:'READ_SCOPE_REVOKED'});
  await add(a, '并发更新之后');
  const later=(await api.listProjects()).find(project => project.project.id === a)!;
  assert.equal(readContextEvidence(later,{...request,query:'并发更新之后'},bound).text,'','paging remains pinned to the claim snapshot');
  const parallel = await add(a, '整理词典');
  assert((await api.dispatchProjectTask(a,parallel,'codex')).ok);
  const second = driver.calls[2].collaboration!;
  const beforeEnd = (await api.listProjects()).find(project => project.project.id === a)!;
  const secondDigest = beforeEnd.collaboration!.contextPackages.find(row => row.id === second.contextPackageId)!.projectIndexHash!;
  assert(secondDigest && secondDigest !== pack.projectIndexHash);
  driver.emit(driver.records[1], {status:'done',turnCompleted:true,reply:{id:'index-finish',text:'目录已完成。'}});
  await api.flushRuntime();
  const afterEnd = (await api.listProjects()).find(project => project.project.id === a)!;
  assert(!afterEnd.collaboration!.projectIndexes?.[pack.projectIndexHash], 'finished claim releases its generated index');
  const parallelPage = {projectId:a,contextPackageId:second.contextPackageId,artifactId:'project-index',hash:secondDigest};
  assert(readContextEvidence(afterEnd,parallelPage,second).text);
  driver.emit(driver.records[2], {status:'done',turnCompleted:true,reply:{id:'index-second-finish',text:'词典已完成。'}});
  await api.flushRuntime();
  const finished = (await api.listProjects()).find(project => project.project.id === a)!;
  assert(!finished.collaboration!.projectIndexes, 'completed runs leave no full derived index behind');
  api.dispose();
}
