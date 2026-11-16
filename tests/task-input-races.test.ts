import assert from 'node:assert/strict';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { createRuntimeDataSource } from '../src/data/runtimeDataSource';
import { readTaskInputDraft, storeTaskInputDraft, clearTaskInputDraft, newTaskInputDraft, sameTaskInputDraft, hasTaskInput, taskInputClipboardFiles, hasTaskInputFileTransfer } from '../src/data/taskInput';
import type { RuntimeDriver, RuntimeEvent } from '../src/data/runtimeContracts';

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

(async () => {
  const key = 'quandeck.task-input.project-a.task-a';
  storage.setItem(key, '旧版纯文本\n  保留空白');
  const submitted = readTaskInputDraft(storage, key);
  assert.equal(submitted.text, '旧版纯文本\n  保留空白');
  assert.deepEqual(readTaskInputDraft(storage, key), submitted, 'migration persists a stable ID before any save');
  assert.notEqual(readTaskInputDraft(storage, 'other-key').id, submitted.id);
  const jsonText = '{"ordinary":"a user draft, not our storage schema"}';
  storage.setItem('legacy-json', jsonText);
  assert.equal(readTaskInputDraft(storage, 'legacy-json').text, jsonText, 'legacy JSON-looking input remains ordinary text');
  const newer = newTaskInputDraft('导航回来后输入的新内容');
  storeTaskInputDraft(storage, key, newer);
  assert.equal(clearTaskInputDraft(storage, key, submitted), false, 'a delayed receipt cannot clear a newer draft after remount');
  assert.deepEqual(readTaskInputDraft(storage, key), newer);
  assert.equal(clearTaskInputDraft(storage, key, { ...newer, text: 'different' }), false, 'ID alone does not own a changed body');
  assert.equal(clearTaskInputDraft(storage, key, { ...newer, id: submitted.id }), false, 'same body under another ID is also a new version');
  assert(clearTaskInputDraft(storage, key, newer));
  assert.equal(storage.getItem(key), null);

  const image = { id: 'image-1', name: '路线.png', type: 'image/png', size: 20 };
  const spreadsheet = { id: 'sheet-1', name: '行程.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 25 };
  const fileOnly = newTaskInputDraft('', [image, spreadsheet]);
  assert(hasTaskInput(fileOnly), 'attachments without text are a valid draft');
  storeTaskInputDraft(storage, key, fileOnly);
  assert.deepEqual(readTaskInputDraft(storage, key), fileOnly, 'file-only draft metadata survives remount');
  const replacedFiles = { ...fileOnly, attachments: [spreadsheet] };
  storeTaskInputDraft(storage, key, replacedFiles);
  assert.equal(sameTaskInputDraft(fileOnly, replacedFiles), false, 'same note ID cannot hide changed attachment selection');
  assert.equal(clearTaskInputDraft(storage, key, fileOnly), false, 'late upload/send receipt cannot clear a newer attachment selection');
  assert.deepEqual(readTaskInputDraft(storage, key).attachments, [spreadsheet]);
  assert(clearTaskInputDraft(storage, key, replacedFiles));
  assert.equal(hasTaskInput(newTaskInputDraft('  ')), false);
  assert.throws(() => newTaskInputDraft('invalid', [image, image]), /附件/);
  assert.throws(() => newTaskInputDraft('', [{ ...image, size: 26 * 1024 * 1024 }]), /25 MB/);
  assert.equal(hasTaskInputFileTransfer({types:['text/plain']} as unknown as DataTransfer),false,'internal task drags are not intercepted as files');
  assert.equal(hasTaskInputFileTransfer({types:['Files','text/plain']} as unknown as DataTransfer),true,'file drags are captured even when filenames have text metadata');
  const pastedImage = { name: 'pasted.png', type: 'image/png' } as File;
  const pastedDoc = { name: '要求.docx', type: 'application/octet-stream' } as File;
  const clipboard = { items: [
    { kind: 'string', getAsFile: () => null },
    { kind: 'file', getAsFile: () => pastedImage },
    { kind: 'file', getAsFile: () => pastedDoc },
  ], files: [pastedImage, pastedDoc] } as unknown as DataTransfer;
  assert.deepEqual(taskInputClipboardFiles(clipboard), [pastedImage, pastedDoc], 'file items are not duplicated through files fallback');
  assert.deepEqual(taskInputClipboardFiles({ items: [], files: [pastedDoc] } as unknown as DataTransfer), [pastedDoc]);
  assert.deepEqual(taskInputClipboardFiles({ items: [{ kind: 'string', getAsFile: () => null }], files: [] } as unknown as DataTransfer), [], 'plain text paste remains the native textarea operation');

  const base = new LocalWorkdeckDataSource();
  const projectId = (await base.createProject({ name: 'Input races' })).projectId!;
  const firstTask = (await base.createTaskWithAttachments('Task A', [], projectId)).taskId!;
  const secondTask = (await base.createTaskWithAttachments('Task B', [], projectId)).taskId!;
  const unknown = newTaskInputDraft('保存已受理，回执尚未返回');
  storeTaskInputDraft(storage, key, unknown);
  assert((await base.addTaskInput(projectId, firstTask, unknown.text, unknown.id)).ok);
  const remounted = readTaskInputDraft(storage, key);
  assert.equal(remounted.id, unknown.id);
  assert((await base.addTaskInput(projectId, firstTask, remounted.text, remounted.id)).ok);
  assert.equal((await base.load()).tasks[firstTask].inputs?.length, 1, 'retrying an unknown save after remount stays idempotent');
  assert(clearTaskInputDraft(storage, key, remounted));

  await base.registerAgent({ id: 'codex', name: 'Codex', short: 'Codex', color: '#556677' });
  let listener = (_event: RuntimeEvent) => {}, runNumber = 0, eventNumber = 0;
  const controls: string[] = [], entered = deferred(), release = deferred();
  let blockedRun = '', rejectControl = false;
  const emit = (runId: string, status: RuntimeEvent['status']) => listener({ id: `event-${++eventNumber}`, sequence: eventNumber, at: new Date(Date.now() + eventNumber * 1000).toISOString(), runId, sessionId: runId.replace('run-', 'source-'), status });
  const driver: RuntimeDriver = {
    subscribe: callback => { listener = callback; return () => {}; }, listRuns: () => [], scan: async () => ({ sessions: [] }),
    run: async input => ({ runId: `run-${++runNumber}`, sessionId: `source-${runNumber}`, connectionId: input.connectionId, acceptedAt: new Date().toISOString() }),
    control: async runId => {
      controls.push(runId);
      if (runId === blockedRun) { entered.resolve(); await release.promise; }
      if (rejectControl) { rejectControl = false; throw new Error('source rejected'); }
      emit(runId, 'waiting_reply');
    },
  };
  const source = createRuntimeDataSource(base, driver);
  await source.bindRuntimeConnection('codex', { tool: 'codex', connectionId: 'connection-a', projectPath: '/project-a' });
  assert((await source.dispatch(firstTask, 'codex')).ok);
  assert((await source.dispatch(secondTask, 'codex')).ok);
  let snapshot = await source.load();
  const first = snapshot.sessions[snapshot.tasks[firstTask].sessionIds[0]];
  const second = snapshot.sessions[snapshot.tasks[secondTask].sessionIds[0]];
  const firstRun = first.runtime!.runId!, secondRun = second.runtime!.runId!;
  emit(firstRun, 'waiting_reply'); emit(secondRun, 'waiting_reply'); await source.flushRuntime();
  blockedRun = firstRun;
  const inFlight = source.controlSession(first.id, 'reply', { prompt: 'first' });
  // No intermediate await: this reaches the exact old-snapshot race during locateSession.
  const duplicate = source.controlSession(first.id, 'reply', { prompt: 'duplicate' });
  assert.equal((await duplicate).ok, false);
  await entered.promise;
  assert((await source.controlSession(second.id, 'reply', { prompt: 'independent session' })).ok, 'different sessions remain concurrent');
  assert.deepEqual(controls, [firstRun, secondRun], 'only one control reaches the busy source');
  blockedRun = ''; release.resolve(); assert((await inFlight).ok);
  assert((await source.controlSession(first.id, 'reply', { prompt: 'after success' })).ok, 'success releases the lock');
  rejectControl = true;
  assert.equal((await source.controlSession(first.id, 'reply', { prompt: 'rejected' })).ok, false);
  assert((await source.controlSession(first.id, 'reply', { prompt: 'retry rejection' })).ok, 'source failure releases the lock');
  const originalList = base.listProjects.bind(base);
  base.listProjects = async () => { throw new Error('lookup failed'); };
  await assert.rejects(source.controlSession(first.id, 'reply', { prompt: 'lookup' }), /lookup failed/);
  base.listProjects = originalList;
  assert((await source.controlSession(first.id, 'reply', { prompt: 'after lookup failure' })).ok, 'exceptions before control also release the lock');
  emit(firstRun, 'running'); await source.flushRuntime();
  assert.equal((await source.controlSession(first.id, 'reply', { prompt: 'too early' })).ok, false);
  emit(firstRun, 'waiting_reply'); await source.flushRuntime();
  assert((await source.controlSession(first.id, 'reply', { prompt: 'after validation rejection' })).ok, 'early validation returns release the lock');
  snapshot = await source.load();
  assert.equal(snapshot.sessions[first.id].runtime?.controlPending, undefined);
  source.dispose();
  console.log('task-input races: legacy migration, stable retry ID, compare-and-clear, per-session exclusion, independent-session concurrency and finally release');
})().catch(error => { console.error(error); process.exitCode = 1; });
