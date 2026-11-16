import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import type { RuntimeDriver, RuntimeRunInput } from '../src/data/runtimeContracts';
import { MAX_ATTACHMENT_BYTES } from '../src/data/taskAttachments';

const memory = new Map<string, string>();
let failSave = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failSave) throw new Error('quota'); memory.set(key, value); },
  removeItem: (key: string) => memory.delete(key),
} });
const file = { id: 'file-1', name: '需求.txt', type: 'text/plain', size: 12 };
const childFile = { ...file, id: 'file-2', name: '补充.txt' };

(async () => {
  const base = new LocalWorkdeckDataSource();
  const a = (await base.createProject({ name: '有附件的项目' })).projectId!;
  const task = await base.createTaskWithAttachments('按附件完成任务', [file], a);
  assert(task.ok && task.taskId);
  const taskId = task.taskId!;
  const itemId = (await base.addManualSubtask(taskId, taskId, '核对补充资料')).itemId!;
  assert((await base.setTaskAttachments(a, taskId, [childFile], itemId, [])).ok);
  const reopened = new LocalWorkdeckDataSource();
  assert.deepEqual((await reopened.load()).tasks[taskId].attachments, [file]);
  assert.deepEqual((await reopened.load()).orchestrations![taskId].items[itemId].attachments, [childFile]);
  assert.equal((await base.setTaskAttachments(a, taskId, [], undefined, [])).ok, false, 'stale upload cannot replace another upload');
  assert.equal((await base.setTaskAttachments(a, taskId, [], 'unknown')).ok, false);
  await assert.rejects(base.setTaskAttachments(a, taskId, [file, file]), /无效/);
  await assert.rejects(base.setTaskAttachments(a, taskId, [{ ...file, size: MAX_ATTACHMENT_BYTES + 1 }]), /25 MB/);
  await assert.rejects(base.setTaskAttachments(a, taskId, [{ ...file, id: '../foreign' }]), /无效/);
  const before = await base.load();
  failSave = true;
  await assert.rejects(base.createTaskWithAttachments('不能保存', [file], a), /未保存/);
  await assert.rejects(base.setTaskAttachments(a, taskId, [], undefined, [file.id]), /未保存/);
  failSave = false;
  assert.deepEqual(await base.load(), before, 'failed storage never exposes a saved task or detached reference');
  const b = (await base.createProject({ name: '另一个项目' })).projectId!;
  assert.equal((await base.setTaskAttachments(b, taskId, [file])).ok, false, 'task cannot be found in a different project');
  assert.equal((await base.createTaskWithAttachments('错误项目', [file], 'unknown')).ok, false);
  assert((await base.setTaskAttachments(a, taskId, [file], undefined, [file.id])).ok, 'pending upload remains bound to its original project after a switch');
  assert.equal((await base.load()).project.id, b);
  await base.switchProject(a);
  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#556677' });
  const calls: RuntimeRunInput[] = [];
  let prepared: unknown;
  const driver: RuntimeDriver = {
    subscribe: () => () => {}, listRuns: () => [], scan: async () => ({ sessions: [] }), control: async () => {},
    run: async input => { calls.push(input); return { runId: `run-${calls.length}`, sessionId: `source-${calls.length}`, connectionId: input.connectionId, acceptedAt: new Date().toISOString(), acceptance: 'acknowledged' }; },
  };
  const source = createRuntimeDataSource(base, driver);
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-a', projectPath: '/project-a' });
  assert.equal((await source.dispatchWork(taskId, itemId, 'codex')).ok, false, 'unsupported attachment transport cannot pretend to deliver files');
  assert.equal(calls.length, 0); assert.equal(Object.keys((await base.load()).sessions).length, 0);
  driver.prepareAttachments = async () => { throw new Error('disk write failed'); };
  const failed = await source.dispatchWork(taskId, itemId, 'codex');
  assert.equal(failed.ok, false); assert.match(failed.message!, /disk write failed/);
  assert.equal(calls.length, 0); assert.equal(Object.keys((await base.load()).sessions).length, 0, 'failed copy does not leave a claimed or queued run');
  driver.prepareAttachments = async input => { prepared = input; return []; };
  assert.equal((await source.dispatchWork(taskId, itemId, 'codex')).ok, false, 'incomplete file receipt must block dispatch');
  for (const change of ['attachments', 'connection']) {
    let resume!: () => void, notify!: () => void;
    const started = new Promise<void>(resolve => { notify = resolve; });
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    driver.prepareAttachments = async input => { notify(); await blocked; return input.ids.map(id => ({ id, name: file.name, path: `/project-a/${id}.txt` })); };
    const pending = source.dispatchWork(taskId, itemId, 'codex');
    await started;
    if (change === 'attachments') await base.setTaskAttachments(a, taskId, [childFile]);
    else await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-new', projectPath: '/project-new' });
    resume();
    const result = await pending;
    assert.equal(result.ok, false, `${change} changed during export must prevent dispatch`);
    assert.match(result.message!, /已变化/);
    assert.equal(calls.length, 0); assert.equal(Object.keys((await base.load()).sessions).length, 0);
    await base.setTaskAttachments(a, taskId, [file]);
    await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-a', projectPath: '/project-a' });
  }
  driver.prepareAttachments = async input => { prepared = input; return input.ids.map(id => ({ id, name: id === file.id ? file.name : childFile.name, path: `/project-a/.quandeck/attachments/${id}.txt` })); };
  assert((await source.dispatchWork(taskId, itemId, 'codex')).ok);
  assert.deepEqual(prepared, { projectId: a, taskId, workItemId: itemId, connectionId: 'connection-a', ids: [file.id, childFile.id] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /file-1\.txt/); assert.match(calls[0].prompt, /file-2\.txt/);
  const snapshot = await source.load();
  assert(snapshot.collaboration!.contextPackages.some(context => context.prompt.includes('/project-a/.quandeck/attachments/file-1.txt')), 'delivered file paths are preserved in the actual audited prompt');
  source.dispose();
  console.log('task attachments: persistent task/child references, failed-save rollback, project binding, conflict detection and dispatch delivery/error gating');
})().catch(error => { console.error(error); process.exitCode = 1; });
