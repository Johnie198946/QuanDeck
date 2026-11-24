import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
test('regenerating a legacy generation removes only its generated audit export and preserves recovery facts', () => fixture(async (root, open) => {
  const store = open(), value = library();
  value.projects.private.collaboration.events.push({ id: 'private-event', sequence: 1, type: 'runtime-note', detail: 'private audit retained internally' });
  store.write(key, value);
  const before = store.read(key), item = store.outbox.list()[0];
  const generation = path.join(store.directory, 'projections', item.project, item.payload.hash);
  mkdirSync(generation, { recursive: true });
  const oldFiles = { 'ledger.md': 'old ledger', 'blackboard.md': 'old board', 'export.json': JSON.stringify(before.projects.private) };
  for (const [name, body] of Object.entries(oldFiles)) writeFileSync(path.join(generation, name), body);
  writeFileSync(path.join(generation, 'receipt.json'), JSON.stringify({ sourceHash: item.payload.hash, projectId: item.project, files: Object.keys(oldFiles), hashes: Object.fromEntries(Object.entries(oldFiles).map(([name, body]) => [name, storageDigest(body)])) }));
  const userFolder = path.join(root, 'user-sources'); mkdirSync(userFolder);
  const userFile = path.join(userFolder, 'export.json'); writeFileSync(userFile, 'user original must survive');
  const adapter = projectionAdapter(store.directory, id => store.read(key).projects[id], p => ({ memory: p.tasks.t.title, ledger: p.tasks.t.title, blackboard: 'ready', json: JSON.stringify({ project: p.project }) }));
  assert.equal(adapter.query(item, { fence() {} }).state, 'not_found', 'old schema is regenerated');
  const receipt = adapter.execute(item, { fence() {} });
  assert.equal(existsSync(generation), false, 'legacy snapshot-named audit generation is removed');
  assert.deepEqual(readdirSync(receipt.generation).sort(), ['blackboard.md', 'ledger.md', 'project-memory.json', 'project-memory.md', 'receipt.json']);
  assert.equal(receipt.projectionSchema, 'quandeck.project-memory.v1');
  assert.equal(adapter.query(item, { fence() {} }).state, 'done');
  // A current receipt must not conceal a restored old audit file in the same directory.
  writeFileSync(path.join(receipt.generation, 'export.json'), oldFiles['export.json']);
  assert.equal(adapter.query(item, { fence() {} }).state, 'not_found');
  adapter.execute(item, { fence() {} });
  assert.equal(existsSync(path.join(receipt.generation, 'export.json')), false);
  assert.equal(readFileSync(userFile, 'utf8'), 'user original must survive');
  assert.deepEqual(store.read(key), before, 'projection repair does not erase canonical audit or project facts');
  const backup = path.join(root, 'backup-with-audit'); store.backup(backup);
  const recovery = store.prepareRestore(backup);
  assert.equal(recovery.restartRequired, true, 'machine backup restoration remains compatible');
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
  assert.equal(readdirSync(path.join(store.directory, 'projections/private')).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 2);
  assert.equal(store.outbox.list().length, 1, 'completed derived deliveries are not an accumulating project history');
  assert.deepEqual(store.read(key).projects.private.collaboration.artifacts, library().projects.private.collaboration.artifacts);
  const count = store.outbox.list().length; store.write(key, data); assert.equal(store.outbox.list().length, count, 'unchanged snapshot does not self-enqueue');
}));

test('audit-only writes reuse business projection bytes, directory and pointer without rewriting', () => fixture(async (_root, open) => {
  const store = open(), data = library(); store.write(key, data);
  const exporter = p => ({ memory: p.tasks.t.title, ledger: 'tasks: ' + p.tasks.t.title, blackboard: 'ready',
    json: JSON.stringify({ schema: 'quandeck.project-memory.v1', project: p.project, sourceSequence: p.collaboration.sequence ?? 0,
      source_seq: p.collaboration.sequence ?? 0, generated_at: String(p.collaboration.sequence ?? 0), entries: [p.tasks.t.title] }) });
  const adapter = projectionAdapter(store.directory, id => store.readProject(id), exporter);
  const original = await store.outbox.deliver(store.outbox.list()[0].id, adapter);
  const pointer = path.join(store.directory, 'projections/private/current.json');
  const locations = [pointer, path.join(original.receipt.generation, 'receipt.json'), ...original.receipt.files.map(name => path.join(original.receipt.generation, name))];
  const mtimes = locations.map(file => statSync(file, { bigint: true }).mtimeNs);
  for (let index = 1; index <= 60; index++) {
    data.projects.private.collaboration.sequence = index;
    data.projects.private.collaboration.events.push({ id: 'heartbeat-' + index, type: 'heartbeat' });
    data.projects.private.usageAccounting = { receipts: Array.from({ length: index }, (_, n) => ({ id: 'usage-' + n, tokens: n })) };
    store.write(key, data);
    const item = store.outbox.pending('project.projection').at(-1), result = await store.outbox.deliver(item.id, adapter);
    assert.equal(result.state, 'done'); assert.deepEqual(result.receipt, original.receipt);
  }
  assert.deepEqual(locations.map(file => statSync(file, { bigint: true }).mtimeNs), mtimes);
  assert.equal(readdirSync(path.dirname(pointer)).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 1);
  assert.equal(store.outbox.list().length, 1);
  assert.equal(store.readProject('private').collaboration.events.length, 60, 'canonical source facts are untouched');
  const body = JSON.parse(readFileSync(path.join(original.receipt.generation, 'project-memory.json'), 'utf8'));
  assert.equal(body.sourceSequence, undefined); assert.equal(body.generated_at, undefined);
  data.projects.private.tasks.t.title = 'new business requirement'; store.write(key, data);
  const changed = await store.outbox.deliver(store.outbox.pending('project.projection')[0].id, adapter);
  assert.notEqual(changed.receipt.contentHash, original.receipt.contentHash);
  assert.match(readFileSync(path.join(changed.receipt.generation, 'project-memory.md'), 'utf8'), /new business requirement/);
}));

test('queued projection coalescing preserves other projects and ambiguous or active effects', () => fixture(async (_root, open) => {
  const store = open(), data = library(); data.projects.other = snapshot('other'); store.write(key, data);
  const initial = store.outbox.list().find(item => item.project === 'private');
  let entered, release; const started = new Promise(resolve => { entered = resolve; });
  const running = store.outbox.deliver(initial.id, { idempotent: true, query() { return { state: 'unknown' }; }, execute() { entered(); return new Promise(resolve => { release = resolve; }); } });
  await started;
  for (let n = 1; n <= 25; n++) { data.projects.private.collaboration.sequence = n; store.write(key, data); }
  assert.equal(store.outbox.list().filter(item => item.project === 'private').length, 2);
  assert.equal(store.outbox.read(initial.id).state, 'delivering');
  assert.equal(store.outbox.list().filter(item => item.project === 'other').length, 1);
  release({ superseded: true }); await running;
  data.projects.private.collaboration.sequence++; store.write(key, data);
  assert.equal(store.outbox.list().filter(item => item.project === 'private').length, 1);
  const latest = store.outbox.pending('project.projection').find(item => item.project === 'private');
  await store.outbox.deliver(latest.id, { execute() { throw Error('uncertain'); }, query() { return { state: 'unknown' }; } });
  data.projects.private.collaboration.sequence++; store.write(key, data);
  assert.equal(store.outbox.read(latest.id).state, 'unknown', 'ambiguous effects must still be reconciled');
}));

test('stale or erased projection sources cannot recreate files, and interrupted pointer recovery is safe', () => fixture(async (_root, open) => {
  const store = open(), data = library(); store.write(key, data);
  const exporter = p => ({ memory: p.tasks.t.title, ledger: p.tasks.t.title, blackboard: 'ready', json: '{}' });
  const adapter = projectionAdapter(store.directory, id => store.readProject(id), exporter);
  const old = store.outbox.list()[0];
  data.projects.private.tasks.t.title = 'new'; store.write(key, data);
  assert.deepEqual(adapter.execute(old, { fence() {} }), { superseded: true });
  assert.equal(existsSync(path.join(store.directory, 'projections/private')), false);
  const latest = store.outbox.pending('project.projection')[0];
  const result = await store.outbox.deliver(latest.id, adapter, { fault(stage) { if (stage === 'after_execute') throw Error('lost acknowledgement'); } });
  assert.equal(result.state, 'unknown');
  assert.equal((await store.outbox.deliver(latest.id, adapter)).state, 'done');
  const plan = store.previewEraseProject('private'); store.eraseProject({ token: plan.token, confirmation: 'private' });
  assert.deepEqual(adapter.execute(latest, { fence() {} }), { superseded: true });
  assert.deepEqual(adapter.query(latest, { fence() {} }), { state: 'done', receipt: { superseded: true } });
  assert.equal(existsSync(path.join(store.directory, 'projections/private')), false);
}));

test('source changes while export is prepared fail closed before writing a generation', () => fixture(async (_root, open) => {
  const store = open(), data = library(); store.write(key, data);
  const item = store.outbox.list()[0];
  const adapter = projectionAdapter(store.directory, id => store.readProject(id), p => {
    const old = p.tasks.t.title; data.projects.private.tasks.t.title = 'concurrent edit'; store.write(key, data);
    return { memory: old, ledger: old, blackboard: 'ready', json: '{}' };
  });
  assert.throws(() => adapter.execute(item, { fence() {} }), /来源已变化/);
  assert.equal(existsSync(path.join(store.directory, 'projections/private')), false);
}));

test('project memory notes remain immutable business facts and are erased only with their project', () => fixture(async (_root, open) => {
  const store = open(), data = library();
  data.projects.private.collaboration.memoryNotes = [{ id: 'lesson-v1', noteId: 'lesson', revision: 1, kind: 'lesson', text: 'Verify input before handoff' }];
  store.write(key, data);
  const altered = structuredClone(data); altered.projects.private.collaboration.memoryNotes[0].text = 'overwrite';
  assert.throws(() => store.write(key, altered), /不可修改/);
  const hidden = structuredClone(data); hidden.projects.private.collaboration.memoryNotes = [];
  assert.throws(() => store.write(key, hidden), /不可修改/);
  data.projects.private.collaboration.memoryNotes.push({ id: 'lesson-v2', noteId: 'lesson', revision: 2, kind: 'lesson', text: 'Verify input and sources before handoff' });
  store.write(key, data);
  const db = new DatabaseSync(store.file);
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM immutable_facts WHERE collection='memoryNotes'").get().n, 2);
    const plan = store.previewEraseProject('private'); store.eraseProject({ token: plan.token, confirmation: 'private' });
    assert.equal(db.prepare("SELECT count(*) n FROM immutable_facts WHERE collection='memoryNotes'").get().n, 0);
  } finally { db.close(); }
}));

test('reflection evidence cannot be silently edited or removed on desktop', () => fixture(async (_root, open) => {
  const store = open(), data = library();
  const facts = data.projects.private.collaboration;
  facts.memoryObservations = [{id:'observation-1',text:'Unexpected detour'}];
  facts.memoryFeedback = [{id:'feedback-1',reviewId:'review-1',effect:'adjust'}];
  store.write(key, data);
  for (const field of ['memoryObservations','memoryFeedback']) {
    const rewritten = structuredClone(data);
    rewritten.projects.private.collaboration[field][0].text = 'Changed after review';
    assert.throws(() => store.write(key, rewritten), /不可修改/);
    const removed = structuredClone(data);
    removed.projects.private.collaboration[field] = [];
    assert.throws(() => store.write(key, removed), /不可修改/);
  }
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

test('direct project erase preserves referencing projects, shared settings, sources, and other projects in mixed backups', () => fixture(async (root,open) => {
  const store=open(), value=library(); value.projects.other={...snapshot('other'),sourceProjectId:'private'};
  const workspace=path.join(root,'user-project');mkdirSync(path.join(workspace,'.quandeck','attachments','private'),{recursive:true});
  writeFileSync(path.join(workspace,'original.pdf'),'original source');writeFileSync(path.join(workspace,'.quandeck','attachments','private','copy'),'managed copy');
  value.projects.private.project.workspacePath=workspace;store.write(key,value);
  store.write('quandeck.configured-agents.v1',[{id:'shared',model:'fixture'}]);store.write('runtime.connections',[{connectionId:'shared'}]);
  store.write('runtime.runs',[{runId:'remove',projectId:'private'},{runId:'retain',projectId:'other'}]);
  const target=await store.saveAttachment('private',{name:'target',bytes:Buffer.from('target')});const other=await store.saveAttachment('other',{name:'other',bytes:Buffer.from('other')});
  const backup=path.join(root,'mixed');store.backup(backup);const beforeOther=JSON.stringify(value.projects.other);
  const plan=store.previewEraseProject('private',{scope:'project'});assert.deepEqual(plan.affectedProjectIds,['private']);
  // Other-project changes cannot invalidate a target-only confirmation.
  const changed=store.read(key);changed.projects.other.extra='concurrent unrelated progress';store.write(key,changed);
  const result=store.eraseProject({token:plan.token,confirmation:'private'});assert.equal(result.restartRequired,false);
  assert.equal(store.readProject('private'),undefined);assert.equal(store.readProject('other').extra,'concurrent unrelated progress');
  assert.deepEqual(store.read('quandeck.configured-agents.v1'),[{id:'shared',model:'fixture'}]);assert.deepEqual(store.read('runtime.connections'),[{connectionId:'shared'}]);
  assert.deepEqual(store.read('runtime.runs'),[{runId:'retain',projectId:'other'}]);
  assert.equal(readFileSync(path.join(workspace,'original.pdf'),'utf8'),'original source');assert.equal(existsSync(path.join(workspace,'.quandeck','attachments','private')),false);assert.equal(readFileSync(path.join(root,'workspace.erasures.json'),'utf8').includes(workspace),false,'completed cleanup keeps no original directory path in its erasure receipt');
  assert.equal(await store.attachment('other',other.id).then(String),'other');await assert.rejects(store.attachment('private',target.id));
  await assert.rejects(store.saveAttachment('private',{name:'late',bytes:Buffer.from('late')}),/永久清除/);
  store.write('runtime.runs',[{runId:'late',projectId:'private'},{runId:'retain',projectId:'other'}]);assert.deepEqual(store.read('runtime.runs'),[{runId:'retain',projectId:'other'}]);
  const backupStore=createLocalStore(backup);try {assert.equal(backupStore.readProject('private'),undefined);assert.equal(JSON.stringify(backupStore.readProject('other')),beforeOther);assert.deepEqual(backupStore.read('quandeck.configured-agents.v1'),[{id:'shared',model:'fixture'}]);}finally{backupStore.close();}
  const manifest=JSON.parse(readFileSync(path.join(backup,'manifest.json')));for(const file of manifest.files){const bytes=readFileSync(path.join(backup,file.path));assert.equal(storageDigest(bytes),file.sha256);assert.equal(bytes.length,file.size);}
  assert(store.prepareRestore(backup).restartRequired,'the scrubbed mixed backup remains a valid restore source');
}));

test('project-only tombstone recovery preserves unrelated project in mixed backup and legacy JSON', () => fixture(async(root,open,opened)=>{
  const store=open(),value=library();value.projects.other=snapshot('other');store.write(key,value);
  const backup=path.join(root,'mixed');store.backup(backup);
  writeFileSync(path.join(store.directory,'workspace.json.pre-sqlite'),JSON.stringify({[key]:JSON.stringify(value),'quandeck.preferences.v1':JSON.stringify({theme:'dark'})}));
  writeFileSync(path.join(root,'workspace.erasures.json'),JSON.stringify({schema:1,projects:[{projectId:'private',scope:'project',erasedAt:new Date().toISOString()}]}));
  store.close();opened.splice(opened.indexOf(store),1);recoverWorkspaceMaintenance(path.join(root,'workspace'));
  const recovered=open();assert.equal(recovered.readProject('private'),undefined);assert.deepEqual(recovered.readProject('other'),value.projects.other);
  const legacy=JSON.parse(readFileSync(path.join(recovered.directory,'workspace.json.pre-sqlite')));assert.equal(JSON.parse(legacy[key]).projects.private,undefined);assert.deepEqual(JSON.parse(legacy[key]).projects.other,value.projects.other);assert.deepEqual(JSON.parse(legacy['quandeck.preferences.v1']),{theme:'dark'});
  assert(existsSync(backup));assert.equal(recovered.prepareRestore(backup).replayedErasureCount,1);
}));

test('direct erase never re-signs another project backup attachment that changed externally', () => fixture(async(root,open)=>{
  const store=open(),value=library();value.projects.other=snapshot('other');store.write(key,value);
  const file=await store.saveAttachment('other',{name:'intact',bytes:Buffer.from('intact')});const backup=path.join(root,'mixed');store.backup(backup);
  const manifestBefore=readFileSync(path.join(backup,'manifest.json'),'utf8');writeFileSync(path.join(backup,'attachments','other',file.id),'tampered');
  const plan=store.previewEraseProject('private',{scope:'project'});assert.throws(()=>store.eraseProject({token:plan.token,confirmation:'private'}),/完整性/);
  assert.equal(readFileSync(path.join(backup,'manifest.json'),'utf8'),manifestBefore);assert.deepEqual(store.readProject('private'),value.projects.private);assert.deepEqual(store.readProject('other'),value.projects.other);
}));

test('erasure prunes only exclusively owned connection IDs in live store and mixed backup', () => fixture(async(root,open)=>{
 const store=open(),value=library();value.projects.other=snapshot('other');
 value.projects.private.runtimeConnections={a:{connectionId:'only-target'},b:{connectionId:'shared'},c:{connectionId:'profile'},d:{connectionId:'historic'},e:{connectionId:'fallback'},f:{connectionId:'run-only'}};
 value.projects.other.runtimeConnections={a:{connectionId:'shared'}};
 value.projects.other.sessions={archived:{runtime:{connection:{connectionId:'historic'}},status:'archived'}};
 store.write(key,value);store.write('runtime.connections',['only-target','shared','profile','historic','unrelated','fallback','run-only'].map(connectionId=>({connectionId,projectPath:'/fixture',...(connectionId==='profile'?{fallbackPolicy:{connectionIds:['fallback']}}:{})})));
 store.write('quandeck.configured-agents.v1',[{connectionId:'profile',tool:'codex'}]);store.write('runtime.runs',[{runId:'other-history',projectId:'other',connectionId:'run-only',status:'cancelled'}]);
 const backup=path.join(root,'mixed');store.backup(backup);const plan=store.previewEraseProject('private',{scope:'project'});store.eraseProject({token:plan.token,confirmation:'private'});
 const retained=['shared','profile','historic','unrelated','fallback','run-only'];assert.deepEqual(store.read('runtime.connections').map(c=>c.connectionId),retained);
 const copy=createLocalStore(backup);try{assert.deepEqual(copy.read('runtime.connections').map(c=>c.connectionId),retained);assert.deepEqual(copy.readProject('other'),value.projects.other);}finally{copy.close();}
 assert(store.prepareRestore(backup).restartRequired);
}));
