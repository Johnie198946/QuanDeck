import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { canReplyToTask } from '../src/data/taskInput';
import type { RuntimeDriver, RuntimeEvent, RuntimeRunInput } from '../src/data/runtimeContracts';

const memory = new Map<string, string>();
let failSave = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failSave) throw new Error('disk full'); memory.set(key, value); },
  removeItem: (key: string) => memory.delete(key),
} });

(async () => {
  const base = new LocalWorkdeckDataSource();
  const projectId = (await base.createProject({ name: 'Task input' })).projectId!;
  const taskId = (await base.createTaskWithAttachments('整理攻略', [], projectId)).taskId!;
  assert((await base.addTaskInput(projectId, taskId, '情侣两人，预算两万元', 'input-1')).ok);
  assert((await base.addTaskInput(projectId, taskId, '情侣两人，预算两万元', 'input-1')).ok, 'save retry is idempotent');
  assert.equal((await base.addTaskInput(projectId, taskId, 'changed', 'input-1')).ok, false);
  assert.equal((await base.addTaskInput(projectId, taskId, '  ', 'empty')).ok, false);
  const restored = new LocalWorkdeckDataSource();
  assert.equal((await restored.load()).tasks[taskId].inputs?.length, 1, 'notes survive an application restart');
  assert.equal((await restored.load()).tasks[taskId].title, '整理攻略', 'input does not replace task identity');
  const before = await base.load();
  failSave = true;
  await assert.rejects(base.addTaskInput(projectId, taskId, 'must stay unsaved', 'input-failed'), /未保存/);
  failSave = false;
  assert.deepEqual(await base.load(), before, 'storage failure cannot appear as a saved input');
  const otherProjectId = (await base.createProject({ name: 'Other project' })).projectId!;
  assert.equal((await base.addTaskInput(otherProjectId, taskId, 'wrong task', 'wrong')).ok, false);
  assert((await base.addTaskInput(projectId, taskId, '偏好小众体验', 'input-2')).ok, 'pending save remains bound to the original project');
  assert.equal((await base.load()).project.id, otherProjectId);
  await base.switchProject(projectId);
  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#556677' });
  const calls: RuntimeRunInput[] = [], controls: unknown[] = [];
  let listener = (_event: RuntimeEvent) => {}, sequence = 0;
  const driver: RuntimeDriver = {
    subscribe: callback => { listener = callback; return () => {}; }, listRuns: () => [], scan: async () => ({ sessions: [] }),
    control: async (runId, action, payload) => { controls.push({ runId, action, payload }); },
    run: async input => { calls.push(input); return { runId: `run-${calls.length}`, sessionId: `source-${calls.length}`, connectionId: input.connectionId, acceptedAt: new Date().toISOString() }; },
  };
  const source = createRuntimeDataSource(base, driver);
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-a', projectPath: '/project-a' });
  const file = { id: 'file-1', name: 'requirements.txt', type: 'text/plain', size: 12 };
  await base.setTaskAttachments(projectId, taskId, [file]);
  let resume!: () => void, notify!: () => void;
  const started = new Promise<void>(resolve => { notify = resolve; });
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  driver.prepareAttachments = async () => { notify(); await blocked; return [{ id: file.id, name: file.name, path: '/project-a/file.txt' }]; };
  const staleDispatch = source.dispatch(taskId, 'codex');
  await started;
  assert((await base.addTaskInput(projectId, taskId, '新增了日期要求', 'input-3')).ok);
  resume();
  assert.equal((await staleDispatch).ok, false, 'a note saved during asynchronous preparation invalidates stale dispatch');
  assert.equal(calls.length, 0);
  assert((await source.dispatch(taskId, 'codex')).ok);
  assert.match(calls[0].prompt, /情侣两人，预算两万元/);
  assert.match(calls[0].prompt, /偏好小众体验/);
  assert.match(calls[0].prompt, /新增了日期要求/);
  let snapshot = await source.load();
  assert(snapshot.collaboration!.contextPackages.some(context => context.prompt === calls[0].prompt), 'the saved audited prompt is the delivered prompt');
  const sessionId = snapshot.tasks[taskId].sessionIds[0], session = snapshot.sessions[sessionId];
  assert.equal(canReplyToTask(snapshot, session), false, 'queued executions cannot accept a second prompt');
  assert.equal((await source.controlSession(sessionId, 'reply', { prompt: 'too early' })).ok, false);
  const emit = async (values: Partial<RuntimeEvent>) => {
    listener({ id: `event-${++sequence}`, sequence, at: new Date(Date.now() + sequence * 1000).toISOString(), runId: session.runtime!.runId!, sessionId: 'source-1', ...values });
    await source.flushRuntime();
  };
  await emit({ status: 'waiting_reply' });
  snapshot = await source.load();
  assert(canReplyToTask(snapshot, snapshot.sessions[sessionId]));
  assert((await source.controlSession(sessionId, 'reply', { prompt: '周三晚出发' })).ok);
  assert.deepEqual(controls[0], { runId: session.runtime!.runId, action: 'reply', payload: { prompt: '周三晚出发' } });
  await emit({ status: 'waiting_permission', request: { id: 'approval', kind: 'permission', prompt: 'Continue?' } });
  snapshot = await source.load();
  assert.equal(canReplyToTask(snapshot, snapshot.sessions[sessionId]), false, 'free text must not bypass pending permission requests');
  source.dispose();
  console.log('task input: persistence, project binding, idempotency, failed-save rollback, actual context delivery, stale-dispatch guard and safe reply');
})().catch(error => { console.error(error); process.exitCode = 1; });
