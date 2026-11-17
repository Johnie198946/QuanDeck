import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { applyCollaboration, type CollaborationCommand } from '../src/data/collaboration';
import { discussionContextIssue } from '../src/data/discussionContext';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';
import type { Snapshot } from '../src/data/types';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
let serial = 0;
function command(snapshot: Snapshot, type: CollaborationCommand['type'], payload: Record<string, unknown>, taskId?: string) {
  const result = applyCollaboration(snapshot, { projectId: snapshot.project.id, type, taskId, expectedVersion: taskId ? snapshot.collaboration!.tasks[taskId].version : undefined, payload, idempotencyKey: `return-gate-${++serial}` }, { kind: 'human' });
  assert(result.ok, result.message); return result;
}
async function fixture() {
  const base = new LocalWorkdeckDataSource();
  const projectId = (await base.createProject({ name: 'Discussion return gate' })).projectId!;
  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#111111' });
  let source = '';
  base.mutateRuntimeProject(projectId, snapshot => {
    source = command(snapshot, 'create_task', { title: '21E input', goal: 'Check facts', criteria: ['checked'], owner: 'me' }).resourceId!;
    const submissionId = command(snapshot, 'submit', { title: '21E facts', body: 'Original complete evidence' }, source).resourceId!;
    command(snapshot, 'review', { submissionId, verdict: 'accepted', checks: [true], note: 'Checked' }, source);
  });
  const target = (await base.createTaskFromHandoff(projectId, { sourceTaskKey: source, title: '14D target', idempotencyKey: `target-${++serial}` })).taskId!;
  const planId = await base.ensureTaskPlan(target);
  await base.recordDiscussionConclusion(planId, 'root', { summary: 'Direction only', confirmed: [], open: [] });
  let snapshot = await base.load();
  await base.approvePlan(planId, snapshot.ideaPlans![planId].discussion!.conclusions[0].id, projectId);
  const calls: RuntimeRunInput[] = []; let receive = (_event: RuntimeEvent) => {};
  const driver: RuntimeDriver = { subscribe: listener => { receive = listener; return () => {}; }, scan: async () => [], control: async () => {}, listRuns: () => [], run: async input => { calls.push(input); return { runId: `source-run-${serial}`, sessionId: `source-session-${serial}`, connectionId: input.connectionId, acceptedAt: new Date().toISOString() }; } };
  const runtime = createRuntimeDataSource(base, driver);
  await runtime.bindRuntimeConnection('codex', { tool: 'codex', connectionId: `connection-${serial}`, projectPath: `/discussion-return-${serial}` });
  const result = await runtime.startDiscussion(planId, 'codex');
  assert(result.ok, result.message);
  snapshot = await base.load();
  const session = snapshot.sessions[result.sessionId!];
  const reply = async () => {
    receive({ id: `reply-event-${serial}`, sequence: 1, runId: session.runtime!.runId!, sessionId: session.source!.sessionId, at: new Date(Date.now() + 1000).toISOString(), status: 'waiting_reply', turnCompleted: true, reply: { id: 'decomposition', text: '<quandeck-conclusion>' + JSON.stringify({ summary: 'Detailed method', confirmed: [], open: [], tasks: [{ key: 'leaf', title: 'Perform current evidence step', expected: 'Verified output', owner: 'agent', deps: [], phase: '执行' }], outline: [{ id: 'method', title: 'Method', kind: 'body', lines: [{ id: 'step', text: 'Use the fixed evidence', state: 'tentative' }] }] }) + '</quandeck-conclusion>' } });
    await runtime.flushRuntime();
  };
  return { base, runtime, projectId, source, target, planId, sessionId: session.id, reply, snapshot };
}

async function run() {
  const valid = await fixture();
  try {
    const before = valid.snapshot.collaboration!.contextPackages.find(context => context.id === valid.snapshot.sessions[valid.sessionId].runtime!.collaboration!.contextPackageId)!;
    const changedProgress = structuredClone(valid.snapshot);
    changedProgress.collaboration!.tasks[valid.target].version++;
    assert.equal(discussionContextIssue(changedProgress, changedProgress.sessions[valid.sessionId]), undefined, 'unrelated live status/version changes do not invalidate fixed input content');
    assert.equal(discussionContextIssue(valid.snapshot, valid.snapshot.sessions[valid.sessionId]), undefined);
    const tampered = structuredClone(valid.snapshot);
    tampered.collaboration!.contextPackages.find(context => context.id === before.id)!.prompt += 'changed';
    assert.match(discussionContextIssue(tampered, tampered.sessions[valid.sessionId])!, /固定上下文/);
    await valid.reply();
    const after = await valid.base.load();
    assert.equal(Object.keys(after.orchestrations?.[valid.target]?.items ?? {}).length, 1, 'valid post-approval reply still materializes its authorized decomposition');
    assert(after.ideaPlans![valid.planId].discussion!.conclusions.at(-1)!.adopted);
  } finally { valid.runtime.dispose(); }

  for (const change of ['task-spec', 'source-version', 'user-condition', 'plan-version'] as const) {
    const test = await fixture();
    try {
      test.base.mutateRuntimeProject(test.projectId, snapshot => {
        if (change === 'task-spec') command(snapshot, 'revise_task', { goal: 'A materially changed goal', criteria: ['New acceptance'], reason: 'User changed scope' }, test.target);
        if (change === 'user-condition') command(snapshot, 'record_decision', { kind: 'constraint', text: 'Do not use the previous method' }, test.target);
        if (change === 'plan-version') snapshot.ideaPlans![test.planId].draftVersion++;
        if (change === 'source-version') {
          command(snapshot, 'reopen', { reason: 'Revised evidence' }, test.source);
          const submissionId = command(snapshot, 'submit', { title: '21E revised', body: 'New evidence version' }, test.source).resourceId!;
          command(snapshot, 'review', { submissionId, verdict: 'accepted', checks: [true], note: 'Checked revision' }, test.source);
        }
      });
      const before = await test.base.load(), planBefore = JSON.stringify({ draft: before.ideaPlans![test.planId].draft, drafts: before.ideaPlans![test.planId].drafts, conclusions: before.ideaPlans![test.planId].discussion!.conclusions, adopted: before.ideaPlans![test.planId].adopted });
      await test.reply();
      const after = await test.base.load();
      assert.equal(JSON.stringify({ draft: after.ideaPlans![test.planId].draft, drafts: after.ideaPlans![test.planId].drafts, conclusions: after.ideaPlans![test.planId].discussion!.conclusions, adopted: after.ideaPlans![test.planId].adopted }), planBefore, change + ': stale input cannot change current plan facts');
      assert.equal(Object.keys(after.orchestrations?.[test.target]?.items ?? {}).length, 0, change + ': stale reply cannot auto-import tasks');
      assert(after.sessions[test.sessionId].rounds.some(round => round.id === 'decomposition'), change + ': preserve the original reply in source history');
      assert.equal(after.sessions[test.sessionId].runtime!.submissionIssue?.code, 'DISCUSSION_CONTEXT_STALE');
      assert.match(after.sessions[test.sessionId].runtime!.submissionIssue!.message, /请先停止并归档原讨论，再从当前方向重新开始/);
    } finally { test.runtime.dispose(); }
  }
  console.log('discussion stale return: valid decomposition, task spec/source/condition/plan changes, raw history and context integrity passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
