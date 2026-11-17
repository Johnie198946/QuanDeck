import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { deriveDeliveryMap, deriveGoalAutomation, latestGoalPlan } from '../src/data/goalDelivery';
import { canExecutePlanTaskDirectly, materializeDirectTaskPlan } from '../src/data/directTaskPlan';
import { readPlanTasks } from '../src/data/projectWorkflow';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput, RuntimeRunRecord } from '../src/data/runtimeContracts';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key)}});
class Driver implements RuntimeDriver {
  id = globalThis.crypto.randomUUID(); calls: RuntimeRunInput[] = []; records: RuntimeRunRecord[] = []; listener = (_event: RuntimeEvent) => {}; clock = Date.now() + 1000;
  subscribe(fn: (event: RuntimeEvent) => void) {this.listener = fn; return () => {};}
  async run(input: RuntimeRunInput) {this.calls.push(input); const record: RuntimeRunRecord = {...input, runId: `leaf-${this.id}-${this.calls.length}`, sessionId: `source-${this.id}-${this.calls.length}`, acceptedAt: new Date(this.clock++).toISOString(), acceptance: 'acknowledged', status: 'queued', events: []}; this.records.push(record); return record;}
  emit(record: RuntimeRunRecord, fields: Partial<RuntimeEvent>) {const event: RuntimeEvent = {...fields, id: `event-${record.runId}-${record.events!.length}`, sequence: record.events!.length, at: new Date(this.clock += 1000).toISOString(), runId: record.runId, sessionId: record.sessionId}; record.events!.push(event); if (fields.status) record.status = fields.status; this.listener(event);}
  async control() {return {stoppedConfirmed: true};}
  scan = async () => []; listRuns = () => this.records;
}
const draft = (key: string, parentKey?: string) => ({key, parentKey, title: key, expected: `交付 ${key}`, deps: [], owner: 'agent', phase: '执行'});

async function main() {
  const base = new LocalWorkdeckDataSource(), driver = new Driver(), runtime = createRuntimeDataSource(base, driver);
  const projectId = (await runtime.createProject({name: '叶子方向自动执行回归'})).projectId!;
  await runtime.registerAgent({id: 'codex', name: 'Codex', short: 'C', color: '#111111'});
  await runtime.bindRuntimeConnection('codex', {tool: 'codex', connectionId: 'leaf-test', projectPath: '/leaf-test'});
  const projectPlan = await runtime.ensureProjectPlan(projectId);
  await base.recordDiscussionConclusion(projectPlan, 'root', {summary: '分别完成正文和检查，再汇总', confirmed: [], open: [], tasks: readPlanTasks([draft('21E'), draft('规则正文', '21E'), draft('检查清单', '21E')].map((item, index) => ({...item, key: ['root', 'body', 'check'][index], parentKey: index ? 'root' : undefined}))), deliverables: [{id: 'body-doc', title: '规则正文', taskKey: 'body'}, {id: 'combined', title: '汇总结果', taskKey: 'root'}]});
  let snapshot = await base.load();
  const projectApproval = await base.approvePlan(projectPlan, snapshot.ideaPlans![projectPlan].discussion!.conclusions.at(-1)!.id, projectId, 1); assert(projectApproval.ok, projectApproval.message);
  snapshot = await base.load();
  const originalProgram = structuredClone(latestGoalPlan(snapshot, projectPlan)!);
  const body = originalProgram.tasks.find(binding => binding.draftKey.endsWith('-body'))!, root = originalProgram.tasks.find(binding => !binding.workItemId)!;
  const bodyPlan = await base.openLocalPlan(body.taskId, body.workItemId!);
  await base.recordDiscussionConclusion(bodyPlan, 'root', {summary: '可直接完成当前正文，无需再拆任务', confirmed: [], open: []});
  snapshot = await base.load();
  const approval = await base.approvePlan(bodyPlan, snapshot.ideaPlans![bodyPlan].discussion!.conclusions.at(-1)!.id, projectId, 1); assert(approval.ok, approval.message); assert.match(approval.message!, /直接开启当前任务/);
  assert.equal(driver.calls.length, 0, 'approval alone does not dispatch any run');
  snapshot = await base.load(); const originalKeys = Object.keys(snapshot.collaboration!.tasks).sort(), originalSlots = deriveDeliveryMap(snapshot).slots.map(slot => slot.id).sort();
  const enabled = await runtime.configureGoalAutomation(bodyPlan, {enabled: true, agentId: 'codex', expectedDraftVersion: approval.approvedDraftVersion!}, projectId); assert(enabled.ok, enabled.message); await runtime.flushRuntime();
  snapshot = await base.load(); const directProgram = latestGoalPlan(snapshot, bodyPlan)!;
  assert.equal(driver.calls.length, 1); assert.equal(driver.calls[0].purpose, 'execution', 'a confirmed leaf must execute rather than open another discussion');
  assert.equal(driver.calls[0].taskId, body.taskId); assert.equal(driver.calls[0].workItemId, body.workItemId, 'subtask authorization never expands to the entire root');
  assert.deepEqual(directProgram.tasks.map(binding => binding.key), [body.key]); assert.deepEqual(directProgram.slots, []);
  assert.deepEqual(latestGoalPlan(snapshot, projectPlan), originalProgram, 'the original project output map is immutable');
  assert.deepEqual(Object.keys(snapshot.collaboration!.tasks).sort(), originalKeys, 'direct execution creates no synthetic business tasks');
  assert.deepEqual(deriveDeliveryMap(snapshot).slots.map(slot => slot.id).sort(), originalSlots, 'direct execution adds no required output slot');
  assert.equal(snapshot.collaboration!.tasks[root.key].activeRunId, undefined, 'the parent is not claimed');
  await runtime.configureGoalAutomation(bodyPlan, {enabled: true, agentId: 'codex', expectedDraftVersion: approval.approvedDraftVersion!}, projectId); await runtime.flushRuntime(); assert.equal(driver.calls.length, 1, 'repeat authorization is idempotent');
  const record = driver.records[0], session = Object.values(snapshot.sessions).find(value => value.runtime?.runId === record.runId)!;
  driver.emit(record, {status: 'done', stoppedConfirmed: true, submission: {schemaVersion: 'quandeck.runtime.v1', idempotencyKey: 'body-result', binding: session.runtime!.collaboration!, kind: 'result', payload: {title: '规则正文', body: '已完成规则正文及来源核对。', deliverySlotIds: originalProgram.slots.filter(slot => slot.taskKey === body.key).map(slot => slot.id), sourceIds: [], unresolved: [], nextSteps: []}}});
  await runtime.flushRuntime(); snapshot = await base.load();
  assert.equal(snapshot.sessions[session.id].runtime!.submissionReceipts!.at(-1)!.ok, true);
  assert.equal(deriveGoalAutomation(snapshot, bodyPlan).status, 'assembled', 'a slot-free direct program completes from the real submitted candidate');
  assert.equal(deriveDeliveryMap(snapshot).filled, 1, 'the same submission fills the predeclared project output');
  assert.equal(snapshot.collaboration!.reviews.length, 0, 'candidate completion never invents human acceptance');

  // A changed direction keeps the same leaf binding; later decomposition keeps its parent alive.
  const beforeRevision = structuredClone(directProgram), direction = snapshot.ideaPlans![bodyPlan];
  await base.savePlanOutline(bodyPlan, [...direction.draft.sections, {id: 'format', title: '排版', kind: 'body', lines: []}], direction.draftVersion);
  const revision = await base.approvePlan(bodyPlan, undefined, projectId, direction.draftVersion + 1); assert(revision.ok, revision.message);
  snapshot = await base.load(); assert.deepEqual(snapshot.collaboration!.goalPlans![bodyPlan][0], beforeRevision); assert.equal(latestGoalPlan(snapshot, bodyPlan)!.retainedFromVersion, 1);
  await base.recordDiscussionConclusion(bodyPlan, 'root', {summary: '新增两项细分检查', confirmed: [], open: [], tasks: readPlanTasks([draft('section'), draft('citations')])});
  snapshot = await base.load(); const split = await base.approvePlan(bodyPlan, snapshot.ideaPlans![bodyPlan].discussion!.conclusions.at(-1)!.id, projectId, snapshot.ideaPlans![bodyPlan].draftVersion); assert(split.ok, split.message);
  snapshot = await base.load(); assert(!snapshot.collaboration!.tasks[body.key].archived, 'splitting a prior direct scope must not archive the parent task');
  assert.notEqual(snapshot.collaboration!.tasks[body.key].status, 'cancelled'); assert.equal(latestGoalPlan(snapshot, bodyPlan)!.tasks.length, 2);
  assert(!canExecutePlanTaskDirectly(snapshot, snapshot.ideaPlans![bodyPlan]), 'non-leaf scopes cannot bypass their children');
  assert(!materializeDirectTaskPlan(snapshot, snapshot.ideaPlans![projectPlan]), 'project directions always retain graph decomposition');
  runtime.dispose();

  // Restore an old approved leaf authorization with no graph: no second planning session.
  const restoredBase = new LocalWorkdeckDataSource(), restoredProject = (await restoredBase.createProject({name: '旧叶子授权恢复'})).projectId!;
  const taskId = (await restoredBase.createTaskWithAttachments('14D：整理正文', [], restoredProject)).taskId!, taskPlan = await restoredBase.ensureTaskPlan(taskId);
  await restoredBase.setTaskOwner(taskId, 'agent');
  await restoredBase.approvePlan(taskPlan, undefined, restoredProject, 1);
  restoredBase.mutateRuntimeProject(restoredProject, value => {value.runtimeConnections = {codex: {tool: 'codex', connectionId: 'restored-leaf', projectPath: '/restored-leaf'}}; value.collaboration!.goalAutomation = {[taskPlan]: {planId: taskPlan, planVersion: 0, draftVersion: 1, enabled: true, agentId: 'codex', version: 1, at: new Date().toISOString(), attempts: {}}};});
  const restoredDriver = new Driver(), restoredRuntime = createRuntimeDataSource(restoredBase, restoredDriver); await restoredRuntime.flushRuntime();
  assert.equal(restoredDriver.calls.length, 1); assert.equal(restoredDriver.calls[0].purpose, 'execution'); assert.equal(restoredDriver.calls[0].taskId, taskId); assert.equal(restoredDriver.calls[0].workItemId, undefined);
  await restoredRuntime.flushRuntime(); assert.equal(restoredDriver.calls.length, 1); restoredRuntime.dispose();
  const unknownBase = new LocalWorkdeckDataSource(), unknownProject = (await unknownBase.createProject({name: '未确认规划接收'})).projectId!;
  const unknownTask = (await unknownBase.createTaskWithAttachments('不能重复派发', [], unknownProject)).taskId!, unknownPlan = await unknownBase.ensureTaskPlan(unknownTask);
  await unknownBase.setTaskOwner(unknownTask, 'agent'); await unknownBase.approvePlan(unknownPlan, undefined, unknownProject, 1);
  unknownBase.mutateRuntimeProject(unknownProject, value => {value.runtimeConnections = {codex: {tool: 'codex', connectionId: 'unknown-leaf', projectPath: '/unknown-leaf'}}; value.collaboration!.goalAutomation = {[unknownPlan]: {planId: unknownPlan, planVersion: 0, draftVersion: 1, enabled: true, agentId: 'codex', version: 1, at: new Date().toISOString(), attempts: {}, decomposition: {state: 'unknown', at: new Date().toISOString()}}};});
  const unknownDriver = new Driver(), unknownRuntime = createRuntimeDataSource(unknownBase, unknownDriver); await unknownRuntime.flushRuntime();
  assert.equal(unknownDriver.calls.length, 0, 'legacy graph repair cannot bypass an uncertain decomposition admission');
  assert.equal(deriveGoalAutomation(await unknownBase.load(), unknownPlan).status, 'paused'); unknownRuntime.dispose();
  console.log('leaf auto execution: scoped dispatch, immutable output map, idempotency, completion and restore passed');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
