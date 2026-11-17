import assert from 'node:assert/strict';
import { ProjectUpdateReader, createProjectSnapshotSync, mergeProjectUpdates } from '../src/data/projectUpdates';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { LocalWorkdeckDataSource } from '../src/data/repository';

const make = (id: string) => createEmptySnapshot({ id, name: id, description: '', color: '#A94435', createdAt: '2026-11-17T00:00:00Z' });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function main() {
  const first = make('one'), second = make('two');
  first.journal.summary = '保留实际正文';
  const reader = new ProjectUpdateReader();
  const initial = reader.read([first, second]);
  assert.equal(initial.snapshots.length, 2);
  initial.snapshots[0].journal.summary = '不能通过读取结果修改台帐';
  assert.equal(first.journal.summary, '保留实际正文');
  let reads = 0;
  const unchanged = reader.read([first, second], initial.revisions, id => { reads++; return id === 'one' ? first : second; });
  assert.equal(reads, 0, 'unchanged projects are not read/cloned');
  assert.deepEqual(unchanged.snapshots, []);
  const previous = initial.snapshots;
  assert.equal(mergeProjectUpdates(previous, unchanged), previous);
  const revised = { ...second, defaultAgent: 'new-agent' };
  const update = reader.read([first, revised], initial.revisions);
  assert.equal(update.snapshots.length, 1, 'same business version with changed configuration still reaches the client');
  const merged = mergeProjectUpdates(previous, update);
  assert.equal(merged[0], previous[0]); assert.notEqual(merged[1], previous[1]);
  assert.equal(merged[1].defaultAgent, 'new-agent');
  const removed = reader.read([revised], update.revisions);
  assert.deepEqual(mergeProjectUpdates(merged, removed).map(value => value.project.id), ['two']);
  assert.equal(new ProjectUpdateReader().read([revised], removed.revisions).snapshots.length, 1, 'restart/restore invalidates read cursors');
  assert.throws(() => reader.read([first], [] as never), /游标/);
  assert.throws(() => mergeProjectUpdates([], unchanged), /不完整/);

  const changes: unknown[] = [], calls: Record<string,string>[] = [];
  const pending = deferred<ReturnType<ProjectUpdateReader['read']>>();
  const current = reader.read([first, revised]);
  const sync = createProjectSnapshotSync({listProjects: async () => { throw Error('must use delta'); }, readProjectUpdates: async known => {
    calls.push(known); return calls.length === 1 ? pending.promise : reader.read([first, revised], known);
  }}, values => changes.push(values));
  const requests = Array.from({length: 40}, () => sync.refresh());
  assert.equal(calls.length, 1, 'burst shares the in-flight request');
  pending.resolve(current); await Promise.all(requests);
  assert.equal(calls.length, 2, 'one trailing reconciliation preserves changes during the read');
  assert.equal(changes.length, 1, 'no extra render for unchanged response');
  await sync.refresh(); assert.equal(changes.length, 1);
  sync.dispose(); await sync.refresh(); assert.equal(calls.length, 3);

  const delayed = deferred<ReturnType<ProjectUpdateReader['read']>>();
  const cancelled = createProjectSnapshotSync({ listProjects: async () => [], readProjectUpdates: () => delayed.promise }, () => { throw Error('disposed source updated UI'); });
  const wait = cancelled.refresh(); cancelled.dispose(); delayed.resolve(current); await wait;
  let fail = true, received = 0;
  const recovery = createProjectSnapshotSync({ listProjects: async () => [], readProjectUpdates: async known => {
    if (fail) { fail = false; throw Error('temporary'); } return reader.read([first], known);
  }}, () => received++);
  await assert.rejects(recovery.refresh(), /temporary/); await recovery.refresh(); assert.equal(received, 1);

  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  } });
  const repository = new LocalWorkdeckDataSource();
  const projectId = (await repository.createProject({name: '增量读取回归'})).projectId!;
  const start = await repository.readProjectUpdates({});
  assert(start.projectIds.includes(projectId));
  assert.equal((await repository.readProjectUpdates(start.revisions)).snapshots.length, 0);
  await repository.updateProject(projectId, {name: '已修改名称'});
  const actual = await repository.readProjectUpdates(start.revisions);
  assert.equal(actual.snapshots.find(project => project.project.id === projectId)?.project.name, '已修改名称');
  await repository.deleteProject(projectId);
  assert(!(await repository.readProjectUpdates(actual.revisions)).projectIds.includes(projectId));
  console.log('Project updates: unchanged reads, opaque cursor invalidation, deletions, stable references, coalescing, disposal, retry and repository integration passed');
}
void main();
