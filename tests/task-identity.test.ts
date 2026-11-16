import assert from 'node:assert/strict';
import { getTaskIdentity, normalizeTaskIdentities, TASK_FAMILY_COLORS } from '../src/data/taskIdentity';
import { createEmptySnapshot, LOCAL_PROJECTS_KEY } from '../src/data/projectStorage';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import type { Snapshot, Task, Orchestration } from '../src/data/types';
const memory = new Map<string, string>(); let failSave = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failSave) throw Error('quota'); memory.set(key, value); },
  removeItem: (key: string) => memory.delete(key),
} });
const task = (id: string): Task => ({ id, title: id, createdAt: '10:00', sessionIds: [], completion: null, manualLock: false });
const orch = (id: string, children: string[]): Orchestration => ({ taskId: id, label: id, startedAt: '10:00', syncedAt: '10:00', coordinationTokens: null, phases: [], executors: {}, attempts: {}, capabilities: { subAgents: false, steps: false, tokens: false, permissionEvents: false }, itemOrder: children,
  items: Object.fromEntries(children.map(c => [c, { id: c, rootTaskId: id, parentTaskId: id, title: c, phase: '', dependsOnTaskIds: [], status: 'not_started', attemptIds: [] }])) });
const icon = (s: Snapshot, taskId: string, workItemId?: string) => { const value = getTaskIdentity(s, { taskId, workItemId }); assert(value); return value; };

(async () => {
  const s = createEmptySnapshot({ id: 'project-a', name: 'A' });
  for (let n = 0; n < 12; n++) { const id = `task-${n}`; s.tasks[id] = task(id); s.orchestrations![id] = orch(id, Array.from({ length: 12 }, (_, c) => `${id}-child-${c}`)); }
  s.orchestrations!['task-0'].items['task-0-child-1'].parentTaskId = 'task-0-child-0';
  const beforeRead = JSON.stringify(s);
  assert.equal(icon(s, 'task-0').color, 'red');
  assert.equal(JSON.stringify(s), beforeRead, 'render reads must not mutate legacy/imported snapshots');
  assert(normalizeTaskIdentities(s));
  assert(!normalizeTaskIdentities(s), 'normalization must be idempotent');
  const identities = Object.keys(s.tasks).flatMap(id => [icon(s, id), ...Object.keys(s.orchestrations![id].items).map(child => icon(s, id, child))]);
  assert.equal(new Set(identities.map(v => v.shapeIndex)).size, 156, 'project-wide uniqueness continues past 100');
  assert(identities.some(v => v.shapeIndex >= 100));
  Object.keys(s.tasks).forEach((id, i) => {
    assert.equal(icon(s, id).color, TASK_FAMILY_COLORS[i % 8]);
    for (const child of Object.keys(s.orchestrations![id].items)) assert.equal(icon(s, id, child).color, icon(s, id).color);
  });
  const stable = icon(s, 'task-0', 'task-0-child-1');
  s.orchestrations!['task-0'].items['task-0-child-1'].rootTaskId = 'task-1'; normalizeTaskIdentities(s);
  assert.equal(icon(s, 'task-0', 'task-0-child-1').color, icon(s, 'task-0').color, 'owning tree wins over stale imported root metadata');
  s.orchestrations!['task-0'].items['task-0-child-1'].rootTaskId = 'task-0'; normalizeTaskIdentities(s);
  s.tasks['task-0'].title = '改名'; s.tasks['task-0'].completion = { reason: 'manual', at: '11:00' };
  s.orchestrations!['task-0'].itemOrder.reverse(); normalizeTaskIdentities(s);
  assert.deepEqual(icon(s, 'task-0', 'task-0-child-1'), stable);
  assert.deepEqual(icon(JSON.parse(JSON.stringify(s)), 'task-0', 'task-0-child-1'), stable);
  assert.deepEqual(icon(s, 'task-0', 'task-0'), icon(s, 'task-0'), 'root task and root tree entry are one identity');

  // Two imported subtrees may reuse local item IDs. They remain separate tasks.
  s.orchestrations!['task-0'].items.shared = orch('task-0', ['shared']).items.shared;
  s.orchestrations!['task-1'].items.shared = orch('task-1', ['shared']).items.shared;
  normalizeTaskIdentities(s);
  assert.notEqual(icon(s, 'task-0', 'shared').shapeIndex, icon(s, 'task-1', 'shared').shapeIndex);
  assert.equal(getTaskIdentity(s, { workItemId: 'shared' }), null, 'ambiguous IDs must not select another family');
  // Reassigning a subtree preserves shapes, but all descendants inherit their new family.
  for (const id of ['task-0-child-0', 'task-0-child-1']) {
    const item = s.orchestrations!['task-0'].items[id]; delete s.orchestrations!['task-0'].items[id];
    item.rootTaskId = 'task-1'; if (item.parentTaskId === 'task-0') item.parentTaskId = 'task-1'; s.orchestrations!['task-1'].items[id] = item;
  }
  normalizeTaskIdentities(s);
  assert.equal(icon(s, 'task-1', 'task-0-child-1').shapeIndex, stable.shapeIndex);
  assert.equal(icon(s, 'task-1', 'task-0-child-1').color, icon(s, 'task-1').color);
  const retired = icon(s, 'task-2').shapeIndex; delete s.tasks['task-2']; delete s.orchestrations!['task-2']; normalizeTaskIdentities(s);
  s.tasks.new = task('new'); normalizeTaskIdentities(s); assert.notEqual(icon(s, 'new').shapeIndex, retired);
  assert.equal(getTaskIdentity(s, { taskId: 'unknown' }), null);

  // Raw source children use the same icon after becoming a formal WorkItem.
  s.sessions.source = { id: 'source', agentId: 'codex', title: 'source', origin: 'observed', taskId: 'task-1', status: 'paused', startedAt: null, lastActivity: '10:00', step: null, tokens: null, rounds: [], subAgents: [{ id: 'child', title: '真实子代理', status: 'paused', start: '10:00', tokens: null, sessionRef: 'source-child' }] };
  normalizeTaskIdentities(s);
  const sourceIcon = getTaskIdentity(s, { sessionId: 'source', subAgentId: 'child' })!; assert(sourceIcon);
  s.orchestrations!['task-1'].items['source-work'] = orch('task-1', ['source-work']).items['source-work'];
  s.orchestrations!['task-1'].attempts['source-attempt'] = { id: 'source-attempt', workItemId: 'source-work', executorId: 'codex', sessionId: 'source-child', parentSessionId: 'source', sourceLink: '', kind: 'initial', status: 'paused', startedAt: '10:00', tokens: null, rounds: [] };
  normalizeTaskIdentities(s);
  assert.deepEqual(getTaskIdentity(s, { sessionId: 'source', subAgentId: 'child' }), icon(s, 'task-1', 'source-work'));
  assert.equal(icon(s, 'task-1', 'source-work').shapeIndex, sourceIcon.shapeIndex);

  // Import repair keeps valid assignments, reserves removed ones and allocates fresh conflicts.
  const bad = JSON.parse(JSON.stringify(s)) as Snapshot;
  const entries = Object.values(bad.taskIdentities!.entries);
  entries[1].shapeIndex = entries[0].shapeIndex; entries[2].shapeIndex = -3;
  normalizeTaskIdentities(bad);
  const repaired = Object.values(bad.taskIdentities!.entries).map(e => e.shapeIndex);
  assert.equal(new Set(repaired).size, repaired.length); assert(repaired.every(n => n >= 0));
  assert(!normalizeTaskIdentities(bad));

  // Real repository command boundary, migration, failed disk writes and per-project scope.
  const api = new LocalWorkdeckDataSource(); await api.createProject({ name: '真实项目 A' });
  const block = await api.addBlock('task', '做旅行计划'); let snap = await api.load();
  const root = (snap.journal.blocks.find(b => b.id === block) as {taskId:string}).taskId;
  const child = (await api.addManualSubtask(root, root, '确认交通')).itemId!;
  const nested = (await api.addManualSubtask(root, child, '比较班次')).itemId!;
  snap = await api.load(); const saved = icon(snap, root, nested);
  assert.equal(saved.color, icon(snap, root).color); assert.notEqual(saved.shapeIndex, icon(snap, root, child).shapeIndex);
  const beforeFailure = JSON.stringify(snap.taskIdentities); failSave = true;
  await assert.rejects(api.addBlock('task', '保存失败不占图标'), /未保存/); failSave = false;
  assert.equal(JSON.stringify((await api.load()).taskIdentities), beforeFailure);
  await Promise.all(Array.from({ length: 8 }, (_, i) => api.addBlock('task', `同时创建 ${i}`)));
  const concurrent = await api.load();
  const allocated = Object.keys(concurrent.tasks).map(id => icon(concurrent, id).shapeIndex);
  assert.equal(new Set(allocated).size, allocated.length, 'commands allocate atomically from latest committed registry');
  api.mutateRuntimeProject(concurrent.project.id, draft => {
    const o = draft.orchestrations![root]; o.items['runtime-child'] = orch(root, ['runtime-child']).items['runtime-child']; o.itemOrder.push('runtime-child');
  });
  const runtimeAdded = await api.load(); assert.equal(icon(runtimeAdded, root, 'runtime-child').color, icon(runtimeAdded, root).color);
  assert.notEqual(icon(runtimeAdded, root, 'runtime-child').shapeIndex, saved.shapeIndex);
  const reopened = new LocalWorkdeckDataSource(); assert.deepEqual(icon(await reopened.load(), root, nested), saved);
  await assert.rejects(reopened.completeTask(root), /先提交成果/); assert.deepEqual(icon(await reopened.load(), root, nested), saved);
  await reopened.createProject({ name: '真实项目 B' }); const blockB = await reopened.addBlock('task', '另一个任务'); const b = await reopened.load();
  const taskB = (b.journal.blocks.find(x => x.id === blockB) as {taskId:string}).taskId;
  assert.equal(icon(b, taskB).shapeIndex, 0, 'projects allocate independently');
  const stored = JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!); for (const project of Object.values(stored.projects) as Snapshot[]) delete project.taskIdentities;
  memory.set(LOCAL_PROJECTS_KEY, JSON.stringify(stored)); const migrated = new LocalWorkdeckDataSource(); const projects = await migrated.listProjects();
  assert(projects.every(p => p.taskIdentities));
  assert((Object.values(JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!).projects) as Snapshot[]).every(p => p.taskIdentities), 'legacy migration is persisted, not merely rendered');
  console.log('task identities: 156 unique shapes; stable nested family colors; source aliases; rebind/import/retirement; atomic persistent migration and project isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
