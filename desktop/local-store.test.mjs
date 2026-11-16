import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createLocalStore } from './app/local-store.mjs';
const key = 'quandeck.projects.v1';
const library = () => ({ schema: 1, projects: { real: { collaboration: { specs: [], decisions: [], artifacts: [], submissions: [], reviews: [], checkpoints: [], events: [], contextPackages: [], receipts: {} } } }, agents: [] });

async function fixture(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quandeck-store-')), opened = [];
  const open = (dir = directory) => { const store = createLocalStore(dir); opened.push(store); return store; };
  try { await fn(directory, open); } finally { for (const store of opened.reverse()) store.close(); await rm(directory, { recursive: true, force: true }); }
}
test('SQLite survives restart, concurrent handles read current values, renderer migration cannot overwrite', () => fixture(async (directory, open) => {
  const first = open();
  first.migrate({ 'quandeck.demo.v3': '{"mock":true}', [key]: JSON.stringify(library()) });
  assert.equal(first.storage.getItem('quandeck.demo.v3'), null);
  const second = open(); second.migrate({ [key]: JSON.stringify({ schema: 1, projects: {}, agents: [] }) });
  assert.ok(second.read(key, {}).projects.real);
  second.write('settings', { compact: true }); assert.deepEqual(first.read('settings'), { compact: true });
  await writeFile(path.join(directory, 'workspace.json'), 'stale broken legacy');
  assert.ok(open().read(key).projects.real);
}));
test('legacy migration preserves exact recovery copy and invalid legacy never masks itself with an empty database', () => fixture(async (directory, open) => {
  const original = JSON.stringify({ [key]: JSON.stringify(library()), settings: '{"compact":true}' });
  await writeFile(path.join(directory, 'workspace.json'), original);
  await writeFile(path.join(directory, 'workspace.sqlite.importing-abandoned'), 'interrupted migration');
  assert.equal(open().read('settings').compact, true);
  assert.equal(await readFile(path.join(directory, 'workspace.json.pre-sqlite'), 'utf8'), original);
  const invalid = path.join(directory, 'invalid');
  const { mkdir } = await import('node:fs/promises'); await mkdir(invalid);
  await writeFile(path.join(invalid, 'workspace.json'), 'broken');
  assert.throws(() => createLocalStore(invalid), /原文件已保留/);
  await assert.rejects(access(path.join(invalid, 'workspace.sqlite')));
}));
test('immutable history, receipts and snapshot commit atomically; direct SQL update and deletion are rejected', () => fixture(async (_directory, open) => {
  const store = open(), data = library();
  data.projects.real.collaboration.events.push({ id: 'event-1', sequence: 1, detail: '用户原始条件' });
  data.projects.real.collaboration.receipts['command-1'] = { fingerprint: 'original', result: { ok: true } };
  store.write(key, data);
  const changed = structuredClone(data); changed.projects.real.collaboration.events[0].detail = '篡改';
  changed.projects.real.collaboration.specs.push({ id: 'spec-2', goal: 'should roll back' });
  assert.throws(() => store.write(key, changed), /不可修改/);
  assert.deepEqual(store.read(key), data);
  const removed = structuredClone(data); removed.projects.real.collaboration.events = [];
  assert.throws(() => store.write(key, removed), /不可修改/);
  const forged = structuredClone(data); forged.projects.real.collaboration.receipts['command-1'].fingerprint = 'changed';
  assert.throws(() => store.write(key, forged), /不可修改/);
  assert.throws(() => store.storage.removeItem(key), /不可变协作历史/);
  data.projects.real.collaboration.events.push({ id: 'event-2', sequence: 2, detail: '追加修订' }); store.write(key, data);
  const db = new DatabaseSync(store.file);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM immutable_facts').get().n, 3);
    assert.throws(() => db.exec('DELETE FROM immutable_facts'), /immutable fact/);
    assert.throws(() => db.exec("UPDATE immutable_facts SET payload='forged'"), /immutable fact/);
  } finally { db.close(); }
}));
test('backup is independently restorable and includes attachments with SHA256; corrupt databases never silently reset', () => fixture(async (directory, open) => {
  const store = open(); store.write(key, library());
  const item = await store.saveAttachment('project-a', { name: '成果.txt', type: 'text/plain', bytes: Buffer.from('真实成果') });
  assert.equal(item.sha256.length, 64);
  assert.equal((await open().attachment('project-a', item.id)).toString(), '真实成果');
  await assert.rejects(() => store.attachment('project-b', item.id), /ENOENT/);
  await assert.rejects(() => store.attachment('../', item.id), /标识无效/);
  const backup = path.join(directory, 'snapshot'); const result = store.backup(backup);
  assert.equal(result.files, 2); assert.ok(open(backup).read(key).projects.real);
  assert.equal((await open(backup).attachment('project-a', item.id)).toString(), '真实成果');
  const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.find(f => f.path.includes(item.id)).sha256, item.sha256);
  assert.throws(() => store.backup(backup), /未覆盖/);
  await store.removeAttachment('project-a', item.id); await assert.rejects(store.attachment('project-a', item.id), /ENOENT/);
  const brokenDir = path.join(directory, 'broken'); const { mkdir } = await import('node:fs/promises'); await mkdir(brokenDir);
  await writeFile(path.join(brokenDir, 'workspace.sqlite'), 'corrupt sqlite');
  assert.throws(() => createLocalStore(brokenDir), /原文件已保留/);
  assert.equal(await readFile(path.join(brokenDir, 'workspace.sqlite'), 'utf8'), 'corrupt sqlite');
  const futureDir = path.join(directory, 'future'); await mkdir(futureDir);
  const future = new DatabaseSync(path.join(futureDir, 'workspace.sqlite')); future.exec('PRAGMA user_version=99'); future.close();
  assert.throws(() => createLocalStore(futureDir), /原文件已保留/);
  const unchanged = new DatabaseSync(path.join(futureDir, 'workspace.sqlite'));
  try { assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version, 99); } finally { unchanged.close(); }
}));

test('raw intake, classifier decisions and summary versions cannot be rewritten by later projections', () => fixture(async (_directory, open) => {
  const store = open(), data = library();
  data.projects.real.intelligence = {
    intakes: [{ id: 'input-1', text: '明天下午核对交通方案' }],
    classifications: [{ id: 'classification-1', inputId: 'input-1', result: { decision: 'keep_note' } }],
    summaryVersions: [{ id: 'summary-1', sourceSeq: 1, overview: '尚未完成' }],
    suggestionEvents: [], intakeStates: { 'input-1': { status: 'completed' } }, jobs: {}, suggestions: {},
  };
  store.write(key, data);
  const tampered = structuredClone(data);
  tampered.projects.real.intelligence.summaryVersions[0].overview = '已完成全部工作';
  tampered.projects.real.intelligence.jobs['job-2'] = { status: 'completed' };
  assert.throws(() => store.write(key, tampered), /不可修改/);
  assert.deepEqual(store.read(key), data, 'summary tampering rolls back its accompanying mutable state');
  const changedInput = structuredClone(data); changedInput.projects.real.intelligence.intakes[0].text = '伪造原始指令';
  assert.throws(() => store.write(key, changedInput), /不可修改/);
  data.projects.real.intelligence.summaryVersions.push({ id: 'summary-2', sourceSeq: 2, overview: '新增交付，等待验收' });
  data.projects.real.intelligence.jobs['job-2'] = { status: 'completed' }; store.write(key, data);
  assert.equal(open().read(key).projects.real.intelligence.summaryVersions.length, 2);
}));

test('attachments pinned by submitted artifact history cannot be silently deleted', () => fixture(async (_directory, open) => {
  const store = open(), data = library();
  const item = await store.saveAttachment('real', { name: '交付.txt', bytes: Buffer.from('版本一') });
  data.projects.real.collaboration.artifacts.push({ id: 'artifact-v1', attachments: [item], body: '交付附件' });
  store.write(key, data);
  await assert.rejects(store.removeAttachment('real', item.id), /成果历史/);
  assert.equal((await store.attachment('real', item.id)).toString(), '版本一');
}));

test('integrated revisions, publications, AI reviews and source bindings are immutable and atomic', () => fixture(async (_directory, open) => {
  const store = open(), data = library(), project = data.projects.real;
  project.integration = { revisions: [{ id: 'rev-1', sections: [{ body: '原版' }] }], versions: [{ id: 'v1', revisionId: 'rev-1' }], events: [{ id: 'publish-1' }], reviews: [{ id: 'ai-review-1', verdict: 'clear' }], receipts: { request: { result: { ok: true } } }, bundles: { guide: { version: 1 } } };
  project.collaboration.executionLinks = [{ id: 'execution:r1', projectId: 'real', tool: 'codex', connectionId: 'first', sourceSessionId: 'provider-chat', runId: 'r1' }];
  store.write(key, data);
  for (const collection of ['revisions', 'versions', 'events', 'reviews']) {
    const changed = structuredClone(data); changed.projects.real.integration[collection][0].forged = true;
    changed.projects.real.integration.bundles.guide.version = 2;
    assert.throws(() => store.write(key, changed), /不可修改/);
    assert.deepEqual(store.read(key), data);
  }
  const rebound = structuredClone(data); rebound.projects.real.collaboration.executionLinks[0].sourceSessionId = 'replacement';
  assert.throws(() => store.write(key, rebound), /不可修改/);
  const reused = structuredClone(data); reused.projects.other = structuredClone(data.projects.real);
  reused.projects.other.collaboration.executionLinks[0].projectId = 'other';
  assert.throws(() => store.write(key, reused), /不能绑定多个项目/);
  assert.deepEqual(store.read(key), data);
  project.integration.revisions.push({ id: 'rev-2', sections: [{ body: '第二版' }] });
  project.integration.versions.push({ id: 'v2', revisionId: 'rev-2' });
  project.integration.bundles.guide.version = 2; store.write(key, data);
  assert.deepEqual(open().read(key), data);
}));

test('schema 1 upgrades in place while preserving documents and enforcing schema 2 on reopen', () => fixture(async (directory, open) => {
  const store = open(); store.write(key, library());
  const db = new DatabaseSync(store.file); db.exec('PRAGMA user_version=1'); db.close();
  const upgraded = open(); assert.deepEqual(upgraded.read(key), library());
  const backups = (await readdir(directory)).filter(name => name.startsWith('workspace.sqlite.pre-v2-'));
  assert.equal(backups.length, 1);
  const rollback = new DatabaseSync(path.join(directory, backups[0]), {readOnly:true});
  try {
    assert.equal(rollback.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(JSON.parse(rollback.prepare('SELECT value FROM documents WHERE key=?').get(key).value), library());
  } finally { rollback.close(); }
  const check = new DatabaseSync(store.file);
  try { assert.equal(check.prepare('PRAGMA user_version').get().user_version, 2); } finally { check.close(); }
}));

test('deleted project/task snapshots retain immutable facts and task-uploaded files', () => fixture(async (_directory, open) => {
  const store = open(), data = library();
  const item = await store.saveAttachment('real', { name: '任务资料.txt', bytes: Buffer.from('保留资料') });
  data.projects.real.project = { id: 'real', name: '项目' };
  data.projects.real.tasks = { task: { id: 'task', attachments: [item] } };
  data.projects.real.collaboration.events.push({ id: 'original', detail: '原始记录' });
  store.write(key, data);
  data.projects.real.deletedTasks = { task: { task: data.projects.real.tasks.task, deletedAt: '2026-11-16T08:00:00Z' } };
  delete data.projects.real.tasks.task;
  data.projects.real.project.deletedAt = '2026-11-16T08:00:00Z';
  store.write(key, data);
  assert.deepEqual(open().read(key), data);
  await assert.rejects(store.removeAttachment('real', item.id), /仍关联任务/);
  assert.equal((await store.attachment('real', item.id)).toString(), '保留资料');
  const erased = structuredClone(data); erased.projects.real.collaboration.events = [];
  assert.throws(() => store.write(key, erased), /不可修改/);
  assert.deepEqual(store.read(key), data);
}));

test('goal delivery versions keep immutable slot bindings across restart and new versions', () => fixture(async (_directory, open) => {
  const store=open(), data=library();
  data.projects.real.collaboration.goalPlans={direction:[{id:'direction',version:1,draftVersion:2,tasks:[{key:'route'}],slots:[{id:'map',taskKey:'route'}]}]};
  store.write(key,data);
  const changed=structuredClone(data);changed.projects.real.collaboration.goalPlans.direction[0].slots[0].taskKey='unrelated';
  assert.throws(()=>store.write(key,changed),/不可修改/);
  assert.deepEqual(store.read(key),data);
  data.projects.real.collaboration.goalPlans.direction.push({id:'direction',version:2,draftVersion:3,tasks:[{key:'route'},{key:'hotel'}],slots:[{id:'map',taskKey:'route'},{id:'hotel',taskKey:'hotel'}]});
  store.write(key,data);
  assert.equal(open().read(key).projects.real.collaboration.goalPlans.direction.length,2);
  const removed=structuredClone(data);removed.projects.real.collaboration.goalPlans.direction.shift();
  assert.throws(()=>store.write(key,removed),/不可修改/);
}));
