import assert from 'node:assert/strict';
import { ProjectUpdateReader, createProjectSnapshotSync, mergeProjectUpdates, subscribeWorkbenchSnapshots } from '../src/data/projectUpdates';
import { createEmptySnapshot } from '../src/data/projectStorage';
import { LocalWorkdeckDataSource } from '../src/data/repository';

const make = (id: string) => createEmptySnapshot({ id, name: id, description: '', color: '#A94435', createdAt: '2026-11-17T00:00:00Z' });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function main() {
  let emptyNotifications = 0;
  const emptyReader = new ProjectUpdateReader();
  const emptySync = createProjectSnapshotSync({listProjects: async () => [], readProjectUpdates: async known => emptyReader.read([], known)}, () => emptyNotifications++);
  await emptySync.refresh(); await emptySync.refresh();
  assert.equal(emptyNotifications, 1, 'empty workspace still initializes consumers once');
  const legacy = make('legacy'); const legacyUpdates: unknown[] = [];
  const legacySync = createProjectSnapshotSync({listProjects: async () => [structuredClone(legacy)]}, values => legacyUpdates.push(values[0].defaultAgent));
  await legacySync.refresh(); legacy.defaultAgent = 'changed-without-business-version'; await legacySync.refresh();
  assert.deepEqual(legacyUpdates, ['', 'changed-without-business-version']);
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

  let raceProject = make('race'), raceNotifications = 0;
  const raceReader = new ProjectUpdateReader();
  const raceSync = createProjectSnapshotSync({listProjects: async () => [], readProjectUpdates: async known => raceReader.read([raceProject], known)}, () => {
    raceNotifications++;
    if (raceNotifications === 1) queueMicrotask(() => { raceProject = {...raceProject, defaultAgent: 'late-change'}; void raceSync.refresh(); });
  });
  await raceSync.refresh();
  assert.equal(raceNotifications, 2, 'the final microtask must not strand the last project update');

  // Native invalidations carry no full snapshot. One shared delta pull updates
  // the active view and catalog, including switches during an in-flight load.
  const initialLoad = deferred<ReturnType<typeof make>>();
  const nativePending = deferred<ReturnType<ProjectUpdateReader['read']>>();
  const nativeReader = new ProjectUpdateReader();
  let nativeProjects = [make('native-a'), make('native-b')], nativeCalls = 0, nativeLoads = 0;
  let invalidate!: (change: {activeProjectId: string}) => void;
  const activeValues: ReturnType<typeof make>[] = [], catalogs: ReturnType<typeof make>[][] = [];
  const native = subscribeWorkbenchSnapshots({
    load: () => { nativeLoads++; return initialLoad.promise; },
    subscribe: () => { throw Error('native mode must not subscribe to full snapshots'); },
    subscribeProjectChanges: listener => { invalidate = listener; return () => {}; },
    listProjects: async () => { throw Error('native mode must use delta'); },
    readProjectUpdates: async known => ++nativeCalls === 1 ? nativePending.promise : nativeReader.read(nativeProjects, known),
  }, {active: value => activeValues.push(value), projects: values => catalogs.push(values), error: error => { throw error; }});
  invalidate({activeProjectId: 'native-b'});
  const nativeFirst = nativeReader.read(nativeProjects);
  nativeProjects = [nativeProjects[0], {...nativeProjects[1], version: 2}];
  for (let i=0;i<40;i++) invalidate({activeProjectId: 'native-b'});
  nativePending.resolve(nativeFirst);
  await native.refresh();
  assert.equal(nativeCalls, 2, 'native burst needs only initial pull and one trailing reconciliation');
  assert.equal(nativeLoads, 1, 'no full active load is required for a normal invalidation');
  assert.equal(activeValues.at(-1)?.project.id, 'native-b'); assert.equal(activeValues.at(-1)?.version, 2);
  assert.equal(catalogs[0][0], catalogs.at(-1)![0], 'unchanged project references survive native updates');
  initialLoad.resolve(make('native-a')); await Promise.resolve(); await native.refresh();
  assert.equal(activeValues.at(-1)?.project.id, 'native-b', 'late initial load cannot undo a project switch');
  const activeB = activeValues.at(-1);
  nativeProjects = [{...nativeProjects[0], version: 3}, nativeProjects[1]];
  invalidate({activeProjectId: 'native-b'}); await native.refresh();
  assert.equal(activeValues.at(-1), activeB, 'background project updates do not replace the active object');
  invalidate({activeProjectId: 'native-a'}); await native.refresh();
  assert.equal(activeValues.at(-1)?.version, 3, 'selection switches even when the delta contains no new snapshot');
  const beforeDisposed = activeValues.length; native.dispose(); await native.refresh();
  assert.equal(activeValues.length, beforeDisposed);

  let emptyInvalidate!: (change: {activeProjectId: string}) => void;
  const nativeEmptyValues: ReturnType<typeof make>[] = [];
  const nativeEmpty = subscribeWorkbenchSnapshots({load: async () => make(''), listProjects: async () => [], readProjectUpdates: async () => ({projectIds: [], revisions: {}, snapshots: []}), subscribe: () => {throw Error('must use invalidations');}, subscribeProjectChanges: listener => {emptyInvalidate=listener;return () => {}; }}, {active: value => nativeEmptyValues.push(value), projects: () => {}, error: error => {throw error;}});
  emptyInvalidate({activeProjectId: ''}); await nativeEmpty.refresh();
  assert.equal(nativeEmptyValues.at(-1)?.project.id, '', 'empty workspace can initialize without a phantom project'); nativeEmpty.dispose();

  let legacyListener!: (snapshot: ReturnType<typeof make>) => void;
  const legacyActive: string[] = [];
  const legacySubscription = subscribeWorkbenchSnapshots({load: async () => make('legacy'), listProjects: async () => [make('legacy')], subscribe: listener => { legacyListener=listener; return () => {}; }}, {active: value => legacyActive.push(value.project.id), projects: () => {}, error: error => {throw error;}});
  legacyListener(make('legacy-push')); await legacySubscription.refresh();
  assert.deepEqual(legacyActive, ['legacy-push'], 'legacy source push still wins over a late initial load'); legacySubscription.dispose();

  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  } });
  const repository = new LocalWorkdeckDataSource();
  const emptyActive: ReturnType<typeof make>[] = [], emptyCatalogs: ReturnType<typeof make>[][] = [], emptyErrors: unknown[] = [];
  const emptyWorkbench = subscribeWorkbenchSnapshots(repository, {
    active: value => emptyActive.push(value), projects: values => emptyCatalogs.push(values), error: error => emptyErrors.push(error),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  await emptyWorkbench.refresh();
  assert.equal(emptyActive.at(-1)?.project.id, '', 'a real empty local Proxy starts without a phantom command or project');
  assert.deepEqual(emptyCatalogs.at(-1), []);
  assert.deepEqual(emptyErrors, [], 'optional subscriptions cannot dispatch an empty-workspace business command');
  const projectId = (await repository.createProject({name: '增量读取回归'})).projectId!;
  await emptyWorkbench.refresh();
  assert.equal(emptyActive.at(-1)?.project.id, projectId, 'first project is delivered through the real synchronous local subscription');
  assert(emptyCatalogs.at(-1)!.some(project => project.project.id === projectId));
  const notificationsBeforeDispose = emptyActive.length;
  assert.doesNotThrow(() => { emptyWorkbench.dispose(); emptyWorkbench.dispose(); }, 'unsubscribe stays callable and idempotent');
  const siblingId = (await repository.createProject({name: '无变化项目'})).projectId!;
  assert.equal(emptyActive.length, notificationsBeforeDispose, 'disposed local listener receives no later project changes');
  assert.deepEqual(emptyErrors, []);
  const start = await repository.readProjectUpdates({});
  assert(start.projectIds.includes(projectId));
  assert.equal((await repository.readProjectUpdates(start.revisions)).snapshots.length, 0);
  await repository.updateProject(projectId, {name: '已修改名称'});
  const actual = await repository.readProjectUpdates(start.revisions);
  assert.deepEqual(actual.snapshots.map(project => project.project.id), [projectId], 'a mutation must not clone or transmit unrelated projects');
  assert.equal(actual.revisions[siblingId], start.revisions[siblingId]);
  assert.equal(actual.snapshots.find(project => project.project.id === projectId)?.project.name, '已修改名称');
  await repository.deleteProject(projectId);
  assert(!(await repository.readProjectUpdates(actual.revisions)).projectIds.includes(projectId));
  console.log('Project updates: unchanged reads, opaque cursor invalidation, deletions, stable references, coalescing, disposal, retry and repository integration passed');
}
void main();
