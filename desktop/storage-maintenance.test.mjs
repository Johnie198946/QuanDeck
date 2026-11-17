import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createLocalStore } from './app/local-store.mjs';
import { createDurableOutbox, recoverWorkspaceMaintenance, projectionAdapter, storageDigest, createCoalescedDrain } from './app/storage-maintenance.mjs';
const key = 'quandeck.projects.v1';
const snapshot = (id = 'private') => ({ project: { id, name: 'Private research' }, tasks: { t: { title: 'private task' } }, sessions: {}, collaboration: { specs: [], decisions: [], artifacts: [{ id: id + '-artifact', body: 'private body' }], submissions: [], reviews: [], checkpoints: [], events: [], contextPackages: [], receipts: {} } });
const library = () => ({ schema: 1, projects: { private: snapshot() }, agents: [], activeProjectId: 'private' });
const fixture = async run => { const root = mkdtempSync(path.join(os.tmpdir(), 'quandeck-maintenance-')); const opened = []; const open = () => { const store = createLocalStore(path.join(root, 'workspace')); opened.push(store); return store; }; try { await run(root, open, opened); } finally { for (const store of opened) { try { store.close(); } catch {} } rmSync(root, { recursive: true, force: true }); } };
test('projection drain includes work enqueued during a batch without retrying unknown effects in a loop', async () => {
  let release, batches = 0; const queue = ['first'], delivered = [];
  const flush = createCoalescedDrain(async () => {
    batches++; const batch = queue.splice(0);
    if (batches === 1) await new Promise(resolve => { release = resolve; });
    delivered.push(...batch);
    return { state: 'unknown' }; // An uncertain effect alone must not trigger another drain.
  });
  const pending = flush(); queue.push('last'); assert.equal(flush(), pending); flush(); release();
  await pending; assert.deepEqual(delivered, ['first', 'last']); assert.equal(batches, 2);
  await Promise.resolve(); assert.equal(batches, 2);
});
test('projection drain preserves a request at the completion microtask boundary and retries after failure', async () => {
  let calls = 0, fail = false;
  const flush = createCoalescedDrain(() => { calls++; if (fail) throw Error('disk unavailable'); });
  const first = flush(); queueMicrotask(() => { void flush(); }); await first; assert.equal(calls, 2);
  fail = true; await assert.rejects(flush(), /disk unavailable/);
  fail = false; await flush(); assert.equal(calls, 4);
});
test('project snapshot and export outbox are atomic; duplicate keys never change payload', () => fixture(async (_root, open) => {
  const store = open(), value = library(); store.write(key, value);
  const before = store.outbox.list(); assert.equal(before.length, 1);
  const invalid = structuredClone(value); invalid.projects.private.collaboration.artifacts[0].body = 'overwrite';
  assert.throws(() => store.write(key, invalid), /不可修改/); assert.deepEqual(store.outbox.list(), before);
  assert.throws(() => store.outbox.enqueue({ id: before[0].id, projectId: 'private', kind: 'project.projection', payload: { hash: 'other' } }), /幂等键/);
}));
test('lost acknowledgement survives restart; query reconciles one actual effect without resending', () => fixture(async (_root, open) => {
  const first = open(); first.outbox.enqueue({ id: 'file-write-1', projectId: 'private', kind: 'test.file-write', payload: { text: 'test' } });
  let effects = 0; const records = new Map();
  const adapter = { idempotent: true, execute: async (item, { idempotencyKey, fence }) => { fence(); effects++; const receipt = { actualId: idempotencyKey }; records.set(item.id, receipt); return receipt; }, query: async item => records.has(item.id) ? { state: 'done', receipt: records.get(item.id) } : { state: 'not_found' } };
  assert.equal((await first.outbox.deliver('file-write-1', adapter, { fault: stage => { if (stage === 'after_execute') throw new Error('lost response'); } })).state, 'unknown');
  const second = open(); assert.equal((await second.outbox.deliver('file-write-1', adapter)).state, 'done'); assert.equal(effects, 1);
}));
test('ambiguous file state cannot be retried even after lease expires', () => fixture(async (_root, open) => {
  const store = open(); store.outbox.enqueue({ id: 'effect', projectId: 'private', kind: 'test', payload: {} });
  let calls = 0;
  const adapter = { execute: async () => { calls++; throw new Error('network lost'); }, query: async () => ({ state: 'unknown' }) };
  await store.outbox.deliver('effect', adapter); await store.outbox.deliver('effect', adapter);
  assert.equal(calls, 1); assert.equal(store.outbox.read('effect').state, 'unknown');
}));
test('parallel claims and late old executor cannot overwrite newer receipt', () => fixture(async (root, open) => {
  const store = open(), db = new DatabaseSync(store.file); let now = 100;
  try {
    const queue = createDurableOutbox(db, { clock: () => now }); queue.enqueue({ id: 'fenced', projectId: 'private', kind: 'test', payload: {} });
    let release, entered; const started = new Promise(resolve => { entered = resolve; });
    const old = queue.deliver('fenced', { execute: () => { entered(); return new Promise(resolve => { release = resolve; }); }, query: async () => ({ state: 'unknown' }) }, { owner: 'old', leaseMs: 10 });
    await started; assert.equal((await queue.deliver('fenced', { execute() { throw Error('must not start'); }, query() {} })).owner, 'old');
    now = 111; const current = await queue.deliver('fenced', { execute() { throw Error('must not repeat'); }, query: async () => ({ state: 'done', receipt: { actualId: 'verified' } }) }, { owner: 'new' });
    assert.equal(current.state, 'done'); release({ actualId: 'stale' }); await old; assert.deepEqual(queue.read('fenced').receipt, { actualId: 'verified' });
  } finally { db.close(); }
}));
test('versioned projections recover missing pointer and never import edited Markdown into facts', () => fixture(async (_root, open) => {
  const store = open(), value = library(); store.write(key, value);
  const adapter = projectionAdapter(store.directory, id => store.read(key).projects[id], p => ({ ledger: p.tasks.t.title, blackboard: 'ready', json: JSON.stringify(p) }));
  const item = store.outbox.list()[0], result = await store.outbox.deliver(item.id, adapter);
  assert.equal(result.state, 'done'); assert.equal(existsSync(path.join(result.receipt.generation, 'ledger.md')), true);
  assert.equal(existsSync(path.join(result.receipt.generation, 'project-memory.md')), true);
  assert.equal(existsSync(path.join(result.receipt.generation, 'project-memory.json')), true);
  assert.equal(existsSync(path.join(result.receipt.generation, 'export.json')), false, 'default memory has no full audit export');
  const pointer = path.join(store.directory, 'projections/private/current.json'); rmSync(pointer);
  const recovered = await adapter.query(item, { fence() {} }); assert.equal(recovered.state, 'done'); assert.equal(existsSync(pointer), true);
  writeFileSync(path.join(result.receipt.generation, 'ledger.md'), 'forged'); assert.equal((await adapter.query(item, { fence() {} })).state, 'not_found'); assert.equal(store.read(key).projects.private.tasks.t.title, 'private task');
}));
test('erasure previews dependencies; stale confirmation cannot erase changed data', () => fixture(async (_root, open) => {
  const store = open(), value = library(); value.projects.dependent = { ...snapshot('dependent'), sourceProjectId: 'private' }; store.write(key, value);
  const plan = store.previewEraseProject('private'); assert.deepEqual(plan.affectedProjectIds, ['private', 'dependent']); assert.equal(plan.counts.projects, 2);
  assert.throws(() => store.eraseProject({ token: plan.token, confirmation: 'wrong' }), /确认/);
  value.projects.private.tasks.t.title = 'changed'; store.write(key, value);
  assert.throws(() => store.eraseProject({ token: plan.token, confirmation: 'private' }), /变化/); assert.ok(store.read(key).projects.private);
}));
test('explicit erasure removes facts, runtime copies, blobs and managed backups while blocking stale writes', () => fixture(async (root, open) => {
  const store = open(), value = library(); store.write(key, value); store.write('runtime.runs', [{ runId: 'secret', projectId: 'private', prompt: 'secret text' }]);
  const file = await store.saveAttachment('private', { name: 'secret', bytes: Buffer.from('private attachment') }); const backup = path.join(root, 'backup'); store.backup(backup);
  const plan = store.previewEraseProject('private'); assert.equal(plan.backupCount, 1); assert.equal(plan.counts.attachments, 1);
  store.eraseProject({ token: plan.token, confirmation: 'private' });
  assert.deepEqual(store.read(key).projects, {}); assert.deepEqual(store.read('runtime.runs'), []); assert.equal(existsSync(backup), false);
  await assert.rejects(store.attachment('private', file.id)); assert.throws(() => store.write(key, value), /永久清除/);
  const db = new DatabaseSync(store.file); try { assert.equal(db.prepare('SELECT count(*) n FROM immutable_facts').get().n, 0); } finally { db.close(); }
}));
test('restoring an unmanaged old copy replays monotonic erasure and preserves a rollback point', () => fixture(async (root, open, opened) => {
  const store = open(); store.write(key, library()); const backup = path.join(root, 'backup'); store.backup(backup); const external = path.join(root, 'external-copy'); cpSync(backup, external, { recursive: true });
  const plan = store.previewEraseProject('private'); store.eraseProject({ token: plan.token, confirmation: 'private' });
  const result = store.prepareRestore(external); assert.equal(result.replayedErasureCount, 1);
  store.close(); opened.splice(opened.indexOf(store), 1); recoverWorkspaceMaintenance(path.join(root, 'workspace'));
  const restored = open(); assert.deepEqual(restored.read(key).projects, {}); assert.ok(existsSync(result.rollbackPoint));
}));
test('restored execution is paused and damaged backup cannot replace live workspace', () => fixture(async (root, open, opened) => {
  const store = open(); store.write(key, library()); store.write('runtime.runs', [{ runId: 'r', projectId: 'private', status: 'running' }]);
  const backup = path.join(root, 'backup'); store.backup(backup); const wrong = path.join(root, 'wrong'); cpSync(backup, wrong, { recursive: true }); writeFileSync(path.join(wrong, 'workspace.sqlite'), 'corrupt');
  assert.throws(() => store.prepareRestore(wrong), /完整性/); assert.ok(store.read(key).projects.private);
  const result = store.prepareRestore(backup); store.close(); opened.splice(opened.indexOf(store), 1); recoverWorkspaceMaintenance(path.join(root, 'workspace'));
  assert.equal(open().read('runtime.runs')[0].status, 'paused'); assert.ok(existsSync(result.rollbackPoint));
}));
test('crash after erasure tombstone replays before opening database; future clean backups survive', () => fixture(async (root, open, opened) => {
  const store = open(); store.write(key, library()); store.close(); opened.splice(opened.indexOf(store), 1);
  writeFileSync(path.join(root, 'workspace.erasures.json'), JSON.stringify({ schema: 1, projects: [{ projectId: 'private', erasedAt: new Date().toISOString() }] }));
  const recovered = open(); assert.deepEqual(recovered.read(key).projects, {});
  const cleanBackup = path.join(root, 'clean'); recovered.backup(cleanBackup); assert.ok(open().read(key)); assert.equal(existsSync(cleanBackup), true);
}));

test('process termination during SQLite transaction cannot publish partial facts or outbox', () => fixture(async (root, open) => {
  const { spawnSync } = await import('node:child_process');
  const store = open(); store.write(key, library());
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE documents SET value=? WHERE key=?').run('{}','quandeck.projects.v1'); db.prepare('INSERT INTO immutable_facts VALUES(?,?,?,?,?)').run('private','events','uncommitted','{}','wrong'); process.exit(17);`, store.file]);
  assert.equal(child.status, 17); assert.ok(open().read(key).projects.private); assert.equal(store.outbox.list().length, 1);
  const db = new DatabaseSync(store.file); try { assert.equal(db.prepare("SELECT count(*) n FROM immutable_facts WHERE id='uncommitted'").get().n, 0); } finally { db.close(); }
}));

test('actual child process exits after effect: reopened outbox queries instead of double-delivery', () => fixture(async (root, open) => {
  const { spawnSync } = await import('node:child_process'); const { pathToFileURL } = await import('node:url');
  const store = open(); store.outbox.enqueue({ id: 'crash-effect', projectId: 'private', kind: 'test', payload: {} });
  const marker = path.join(root, 'effect.json'), module = pathToFileURL(path.resolve('desktop/app/storage-maintenance.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module','-e', `import {DatabaseSync} from 'node:sqlite'; import {writeFileSync} from 'node:fs'; import {createDurableOutbox} from ${JSON.stringify(module)}; const db=new DatabaseSync(process.argv[1]); await createDurableOutbox(db,{clock:()=>1000}).deliver('crash-effect',{execute(){writeFileSync(process.argv[2],JSON.stringify({id:'real-effect'}));process.exit(19)},query(){return{state:'not_found'}}},{leaseMs:1});`, store.file, marker]);
  assert.equal(child.status, 19); assert.equal(store.outbox.read('crash-effect').state, 'delivering');
  const next = open(); const receipt = await next.outbox.deliver('crash-effect', { execute() { assert.fail('effect must not be repeated'); }, query() { return { state: 'done', receipt: JSON.parse(readFileSync(marker)) }; } });
  assert.equal(receipt.state, 'done'); assert.deepEqual(receipt.receipt, { id: 'real-effect' });
}));

test('usage receipts and granted-source read receipts remain append-only', () => fixture(async (_root, open) => {
  const store = open(), value = library(); value.projects.private.usageAccounting = { schema: 1, receipts: [{ id: 'usage', totalTokens: 10 }] }; value.projects.private.collaboration.governance = { reads: [{ id: 'read', sourceProjectId: 'source', fragmentHash: 'fixed' }] }; store.write(key, value);
  const changed = structuredClone(value); changed.projects.private.usageAccounting.receipts[0].totalTokens = 2; assert.throws(() => store.write(key, changed), /不可修改/);
  const hidden = structuredClone(value); hidden.projects.private.collaboration.governance.reads = []; assert.throws(() => store.write(key, hidden), /不可修改/);
}));

test('confirmed file write without optional receipt is never executed a second time', () => fixture(async (_root, open) => {
  const store = open(); store.outbox.enqueue({ id: 'no-receipt', projectId: 'private', kind: 'test', payload: {} }); let calls = 0;
  const adapter = { execute() { calls++; throw Error('response lost'); }, query() { return { state: 'done' }; } };
  await store.outbox.deliver('no-receipt', adapter); assert.equal((await store.outbox.deliver('no-receipt', adapter)).state, 'done'); assert.equal(calls, 1);
}));

test('streaming projection generations are bounded without changing immutable history', () => fixture(async (_root, open) => {
  const store = open(), data = library();
  const adapter = projectionAdapter(store.directory, id => store.read(key).projects[id], p => ({ ledger: p.tasks.t.title, blackboard: 'ready', json: JSON.stringify(p.collaboration) }));
  for (let index = 0; index < 25; index++) { data.projects.private.tasks.t.title = 'update-' + index; store.write(key, data); const item = store.outbox.list().at(-1); await store.outbox.deliver(item.id, adapter); }
  const { readdirSync } = await import('node:fs');
  assert.equal(readdirSync(path.join(store.directory, 'projections/private')).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 20);
  assert.deepEqual(store.read(key).projects.private.collaboration.artifacts, library().projects.private.collaboration.artifacts);
  const count = store.outbox.list().length; store.write(key, data); assert.equal(store.outbox.list().length, count, 'unchanged snapshot does not self-enqueue');
}));

test('paged context evidence receipts cannot be rewritten or removed and erase with their project', () => fixture(async (_root, open) => {
  const store = open(), value = library(); value.projects.private.contextEvidenceReads = [{ id: 'page-1', projectId: 'private', runId: 'r', contextPackageId: 'ctx', artifactId: 'source', hash: 'fixed', offset: 0, length: 20, fragmentHash: 'fragment', at: '2026-11-16', estimatedTokens: 10 }]; store.write(key, value);
  const changed = structuredClone(value); changed.projects.private.contextEvidenceReads[0].estimatedTokens = 0; assert.throws(() => store.write(key, changed), /不可修改/);
  const hidden = structuredClone(value); hidden.projects.private.contextEvidenceReads = []; assert.throws(() => store.write(key, hidden), /不可修改/);
  const plan = store.previewEraseProject('private'); store.eraseProject({ token: plan.token, confirmation: 'private' });
  const db = new DatabaseSync(store.file); try { assert.equal(db.prepare("SELECT count(*) n FROM immutable_facts WHERE collection='contextEvidenceReads'").get().n, 0); } finally { db.close(); }
}));

test('legacy import records verified counts and unknown mappings without inventing source sessions', () => fixture(async (root, open) => {
  const workspace = path.join(root, 'workspace'); mkdirSync(workspace); const data = library();
  data.projects.private.sessions = { old: { id: 'old', taskId: 't' } }; data.projects.private.tasks.t.status = 'done'; data.projects.private.tasks.t.id = 't';
  writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ [key]: JSON.stringify(data) }));
  const store = open(), report = store.migrationReports[0];
  assert.equal(report.source, 'legacy-json'); assert.equal(report.countsVerified, true); assert.deepEqual(report.before, report.after);
  assert.equal(report.after.projects, 1); assert.equal(report.after.sessions, 1); assert.equal(report.after.unknownSessionMappings, 1); assert.equal(report.after.legacyCompletionsWithoutAcceptance, 1);
  assert.equal(store.read(key).projects.private.sessions.old.source, undefined); assert.ok(existsSync(report.backup)); assert.equal(open().migrationReports.length, 1);
}));

test('renderer migration and schema upgrade record their actual source and rollback metadata', () => fixture(async (_root, open) => {
  const store = open(); store.migrate({ [key]: JSON.stringify(library()) }); assert.equal(store.migrationReports[0].source, 'renderer-localStorage');
  const db = new DatabaseSync(store.file); db.exec('PRAGMA user_version=1'); db.close();
  const upgraded = open(), report = upgraded.migrationReports.at(-1); assert.equal(report.source, 'project-partition-upgrade'); assert.equal(report.fromSchema, 1); assert.equal(report.toSchema, 3); assert.ok(existsSync(report.backup)); assert.deepEqual(report.before, report.after);
}));
