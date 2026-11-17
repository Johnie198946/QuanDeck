import assert from 'node:assert/strict';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { applyCollaboration, estimateTokens } from '../src/data/collaboration';
import { buildProjectMemory } from '../src/data/projectMemory';
import { createAIProvider, summaryInputForModel } from '../src/data/aiProvider';
import { buildSummaryInput, compactSummaryInput, ensureIntelligence, finishSummaryJob,
  SUMMARY_INPUT_TOKEN_BUDGET, SUMMARY_TASK_PAGE_SIZE, type SummaryInput, type IntelligenceJob } from '../src/data/intelligence';
import type { RuntimeDriver, RuntimeAssistInput } from '../src/data/runtimeContracts';

function fixture(count = 45): SummaryInput {
  return {
    projectId: 'synthetic-summary', projectName: 'Summary scope', sourceSeq: 12, sourceEventIds: ['RAW_EVENT'],
    ledger: Array.from({ length: count }, (_, index) => ({ key: 'task-' + String(index).padStart(3, '0'),
      title: 'Task ' + index, owner: 'me', status: index === count - 1 ? 'blocked' : 'ready',
      version: 1, specRevision: 1, goal: 'Deliver scoped result ' + index, criteria: ['Check evidence'] })),
    facts: [{ id: 'condition-1', kind: 'confirmed-user-condition', text: 'Keep all output offline.' },
      { id: 'RAW_EVENT', kind: 'event', text: 'RAW_AUDIT_MUST_NOT_BE_SENT' }],
    factRefs: ['condition-1', 'RAW_EVENT'], blackboard: { running: [], review: [], blocked: [], ready: [] },
    rejectedActions: [], referenceDate: '2026-01-01', timeZone: 'Asia/Shanghai',
    previousSummary: { id: 'old', version: 1, sourceSeq: 0, overview: 'OLD_SUMMARY_MUST_NOT_BE_SENT', hash: 'old', truncated: false },
  };
}
const legacy = fixture(), frozen = JSON.stringify(legacy);
const selected = summaryInputForModel(legacy);
assert.equal(JSON.stringify(legacy), frozen, 'projection does not mutate the fixed queued input');
assert.equal(selected.ledger.length, SUMMARY_TASK_PAGE_SIZE);
assert.equal(selected.ledger[0].key, 'task-044', 'blocked work comes before ready work');
assert.equal(selected.coverage!.taskTotal, 45);
assert.equal(selected.coverage!.omittedTasks, 25);
assert.equal(selected.coverage!.mode, 'partial');
assert.equal(selected.coverage!.tokenBudget, SUMMARY_INPUT_TOKEN_BUDGET);
assert(estimateTokens(JSON.stringify(selected)) <= SUMMARY_INPUT_TOKEN_BUDGET);
assert.deepEqual(compactSummaryInput(selected), selected, 'queue, transport and validation select exactly the same facts');
for (const marker of ['RAW_EVENT', 'RAW_AUDIT', 'OLD_SUMMARY']) assert(!JSON.stringify(selected).includes(marker));
assert.deepEqual(selected.factRefs, [...selected.facts.map(f => f.id).filter(id => id === 'condition-1'), ...selected.ledger.map(row => row.key)]);

const oversized = fixture(2);
oversized.ledger[0].goal = 'LONG_TASK_REQUIREMENT_DO_NOT_CUT_' + '完整要求'.repeat(2500);
oversized.facts.push({ id: 'huge-handoff', taskKey: 'task-001', kind: 'current-task-handoff', text: 'LONG_HANDOFF_DO_NOT_CUT_' + '完整结论'.repeat(2500) });
const bounded = compactSummaryInput(oversized);
assert.equal(bounded.ledger.length, 1);
assert.equal(bounded.coverage!.omittedTasks, 1);
assert.equal(bounded.coverage!.omittedArtifacts, 1);
assert(!JSON.stringify(bounded).includes('DO_NOT_CUT'), 'oversized facts are omitted as a whole, never shortened into a claim');
assert(!bounded.factRefs.includes('huge-handoff'));

const priorities = fixture(5);
priorities.ledger.forEach((row, index) => { row.status = ['done', 'ready', 'running', 'in_review', 'blocked'][index]; });
assert.deepEqual(compactSummaryInput(priorities).ledger.map(row => row.status), ['blocked', 'in_review', 'running', 'ready', 'done']);
const staleFacts = fixture(1);
staleFacts.ledger[0].requiresRevalidation = true;
staleFacts.facts.push({ id: 'stale-handoff', taskKey: 'task-000', kind: 'current-task-handoff', text: 'STALE_CLAIM_MUST_NOT_BE_SENT' });
assert(!JSON.stringify(compactSummaryInput(staleFacts)).includes('STALE_CLAIM'));

const snapshot = createEmptySnapshot({ id: 'source-project', name: 'No Agent required', description: 'User background stays available' });
const created = applyCollaboration(snapshot, { projectId: snapshot.project.id, type: 'create_task',
  idempotencyKey: 'test-create', payload: { title: 'Deliver one result', goal: 'Keep original requirements', criteria: ['Check full result'], owner: 'me' } }, { kind: 'human' });
assert(created.ok);
const before = JSON.stringify(snapshot);
const built = buildSummaryInput(snapshot);
assert.equal(JSON.stringify(snapshot), before, 'building an advisory summary creates no facts or background jobs');
assert.equal(built.projectMemory, undefined);
assert.equal(built.projectContext!.background, snapshot.project.description);
assert.equal(built.ledger[0].goal, 'Keep original requirements');
assert.equal(Object.keys(snapshot.intelligence?.jobs ?? {}).length, 0);
assert.deepEqual(compactSummaryInput(built), built);

const oldMemory = buildProjectMemory(snapshot);
oldMemory.projectSpec = { bundleId: 'spec-bundle', versionId: 'spec-v1', version: 1, hash: 'hash',
  sections: [{ title: 'Long specification', body: 'SPEC_BODY_MUST_NOT_BE_SENT'.repeat(1000) }], sources: [] };
const oldJob = { ...fixture(1), projectMemory: oldMemory };
const oldSent = summaryInputForModel(oldJob);
assert.equal(oldSent.projectContext?.spec?.versionId, 'spec-v1');
assert(!JSON.stringify(oldSent).includes('SPEC_BODY_MUST_NOT_BE_SENT'));
assert.equal(oldSent.projectMemory, undefined);

const state = ensureIntelligence(snapshot);
const job: IntelligenceJob = { id: 'legacy-queued-summary', kind: 'summary', status: 'running', agentId: 'codex',
  createdAt: '2026-01-01T00:00:00Z', input: { ...legacy, projectId: snapshot.project.id } };
state.jobs[job.id] = job;
const unseen = legacy.ledger.find(row => !selected.ledger.some(sent => sent.key === row.key))!;
const result = { overview: 'Only selected facts', completed: [], current: [], issues: [], nextActions: [] };
const beforeReject = JSON.stringify(snapshot);
assert.equal(finishSummaryJob(snapshot, job.id, { ...result, current: [{ text: 'Unsent task', taskKey: unseen.key, factRefs: [unseen.key] }] }).code, 'FACT_REFERENCE_INVALID');
assert.equal(finishSummaryJob(snapshot, job.id, { ...result, issues: [{ text: 'Unsent audit', factRefs: ['RAW_EVENT'] }] }).code, 'FACT_REFERENCE_INVALID');
assert.equal(JSON.stringify(snapshot), beforeReject, 'invalid references do not partially persist a summary');

const fakeDone = fixture(1); fakeDone.ledger[0].status = 'done';
state.jobs[job.id].input = { ...fakeDone, projectId: snapshot.project.id };
assert.equal(finishSummaryJob(snapshot, job.id, { ...result, completed: [{ text: 'Completed without evidence', taskKey: 'task-000', factRefs: ['task-000'] }] }).code, 'FACT_REFERENCE_INVALID');
state.jobs[job.id].input = { ...legacy, projectId: snapshot.project.id };
const completed = finishSummaryJob(snapshot, job.id, { ...result,
  current: [{ text: 'Selected task only', taskKey: selected.ledger[0].key, factRefs: [selected.ledger[0].key] }] });
assert(completed.ok, completed.message);
const saved = snapshot.intelligence!.summaryVersions.at(-1)!;
assert.equal(saved.ledger.length, selected.ledger.length);
assert.deepEqual(saved.factRefs, selected.factRefs);
assert.deepEqual(saved.sourceEventIds, [], 'old job audit IDs cannot leak into saved summary provenance');
assert.equal(saved.coverage!.omittedTasks, selected.coverage!.omittedTasks);

async function checkProvider() {
  const calls: RuntimeAssistInput[] = [];
  const driver: RuntimeDriver = {
    subscribe: () => () => {}, scan: async () => [], control: async () => {}, run: async () => { throw Error('must not execute work'); },
    assist: async input => {
      calls.push(input);
      const schema = input.outputSchema as any;
      const binding = Object.fromEntries(Object.entries(schema.properties.binding.properties).map(([key, value]) => [key, (value as any).const]));
      return { requestId: input.requestId, projectId: input.projectId, connectionId: input.connectionId, tool: input.tool,
        sourceSessionId: 'synthetic-source', output: { schemaVersion: schema.properties.schemaVersion.const, binding, result },
        actualTokens: 0, startedAt: '2026-01-01T00:00:00Z', acceptedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:00Z',
        budgetEnforcement: 'soft', budgetExceeded: false, contextPolicy: 'new-isolated-session', toolPolicy: 'read-only-isolated' };
    },
  };
  const provider = createAIProvider(driver), connection = { agentId: 'codex', connectionId: 'test-connection', tool: 'codex' as const };
  await provider.generateSummary({ ...job, input: legacy }, connection);
  const call = calls[0], actual = JSON.parse(call.prompt.slice(call.prompt.lastIndexOf('\n') + 1));
  assert.deepEqual(actual, JSON.parse(JSON.stringify(selected)));
  const schema = call.outputSchema as any;
  assert.deepEqual(schema.properties.result.properties.current.items.properties.factRefs.items.enum, selected.factRefs);
  assert.deepEqual(schema.properties.result.properties.current.items.properties.taskKey.anyOf[0].enum, selected.ledger.map(row => row.key));
  assert(estimateTokens(call.prompt) <= SUMMARY_INPUT_TOKEN_BUDGET, 'rules, schema and data together respect the request budget');
  assert(!call.prompt.includes('RAW_AUDIT') && !call.prompt.includes('OLD_SUMMARY'));
  const substantial = fixture(60);
  substantial.ledger.forEach(row => { row.goal += '完整要求与需要核对的范围。'.repeat(30); });
  const substantialSelected = compactSummaryInput(substantial);
  assert(substantialSelected.ledger.length > 0 && substantialSelected.ledger.length < SUMMARY_TASK_PAGE_SIZE);
  assert.deepEqual(compactSummaryInput(substantialSelected), substantialSelected, 'budget selection remains stable at the boundary');
  await provider.generateSummary({ ...job, input: substantial }, connection);
  assert(estimateTokens(calls[1].prompt) <= SUMMARY_INPUT_TOKEN_BUDGET);
  const giantCondition = fixture(1);
  giantCondition.facts[0].text = '条件必须保持完整'.repeat(3000);
  const blocked = compactSummaryInput(giantCondition);
  assert.equal(blocked.coverage!.omittedConditions, 1);
  assert(blocked.blockedReason);
  assert.deepEqual(compactSummaryInput(blocked), blocked);
  await assert.rejects(provider.generateSummary({ ...job, input: giantCondition }, connection), /SUMMARY_CONDITIONS_TOO_LARGE/);
  assert.equal(calls.length, 2, 'missing confirmed conditions reject before sending to any model');
  console.log('summary memory budget: bounded selection, atomic omissions, old-queue fencing, no-Agent reads and actual provider scope passed');
}
void checkProvider();
