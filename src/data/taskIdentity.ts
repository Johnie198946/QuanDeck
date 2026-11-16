import type { Snapshot } from './types';

export const TASK_FAMILY_COLORS = ['red', 'yellow', 'green', 'blue', 'purple', 'red-purple', 'blue-yellow', 'yellow-green'] as const;
export type TaskFamilyColor = typeof TASK_FAMILY_COLORS[number];
export interface TaskVisualIdentity { shapeIndex: number; color: TaskFamilyColor; familyId: string }
type IdentityKind = 'task' | 'work' | 'subagent';
interface IdentityEntry { kind: IdentityKind; entityId: string; familyId: string; shapeIndex: number }
export interface TaskIdentityRegistry {
  schema: 1;
  /** Monotonic allocation: archived/deleted identities reserve their shapes. */
  nextShape: number;
  nextFamily: number;
  entries: Record<string, IdentityEntry>;
  families: Record<string, { color: TaskFamilyColor }>;
}
export interface TaskIdentityTarget { taskId?: string; workItemId?: string; sessionId?: string; subAgentId?: string }
interface Entity { key: string; kind: IdentityKind; entityId: string; familyId: string }
const key = (...parts: string[]) => JSON.stringify(parts);
const taskKey = (id: string) => key('task', id);
const workKey = (taskId: string, id: string) => key('work', taskId, id);
const subKey = (sessionId: string, id: string) => key('subagent', sessionId, id);
const validIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER - 1024;
const validColor = (value: unknown): value is TaskFamilyColor => TASK_FAMILY_COLORS.includes(value as TaskFamilyColor);
const cache = new WeakMap<Snapshot, ReturnType<typeof build>>();

/** Maps all views of a task to one identity. This never creates a task or execution. */
function entitiesOf(snapshot: Snapshot) {
  const entities = new Map<string, Entity>(), aliases = new Map<string, string>();
  const attemptsByTask = new Map<string, { bySession: Map<string, string>; byCall: Map<string, string> }>();
  for (const task of Object.values(snapshot.tasks)) {
    const id = taskKey(task.id);
    entities.set(id, { key: id, kind: 'task', entityId: task.id, familyId: task.id });
  }
  for (const [containerId, orchestration] of Object.entries(snapshot.orchestrations ?? {})) {
    const bySession = new Map<string, string>(), byCall = new Map<string, string>();
    for (const attempt of Object.values(orchestration.attempts)) {
      bySession.set(attempt.sessionId, attempt.workItemId);
      if (attempt.source?.childCallId) byCall.set(key(attempt.source.connectionId ?? '', attempt.source.sessionId, attempt.source.childCallId), attempt.workItemId);
    }
    attemptsByTask.set(containerId, { bySession, byCall });
    for (const item of Object.values(orchestration.items)) {
      const familyId = snapshot.tasks[containerId] ? containerId : item.rootTaskId;
      if (!snapshot.tasks[familyId]) continue;
      const id = workKey(containerId, item.id);
      // Some integrations mirror the root Task in items; it is one task, not a new icon.
      if (item.id === familyId) { aliases.set(id, taskKey(familyId)); continue; }
      entities.set(id, { key: id, kind: 'work', entityId: item.id, familyId });
    }
  }
  for (const session of Object.values(snapshot.sessions)) {
    for (const child of session.subAgents) {
      const id = subKey(session.id, child.id);
      const familyId = session.taskId && snapshot.tasks[session.taskId] ? session.taskId : key('session', session.id);
      const orchestration = session.taskId ? snapshot.orchestrations?.[session.taskId] : undefined;
      const directId = session.runtime?.runId ? `child:${session.runtime.runId}:${child.id}` : undefined;
      let item = directId ? orchestration?.items[directId] : undefined;
      if (!item && orchestration) {
        const index = attemptsByTask.get(session.taskId!);
        const sourceItem = child.source?.childCallId ? index?.byCall.get(key(child.source.connectionId ?? '', child.source.sessionId, child.source.childCallId)) : undefined;
        const itemId = sourceItem ?? (child.sessionRef !== session.id ? index?.bySession.get(child.sessionRef) : undefined);
        item = itemId ? orchestration.items[itemId] : undefined;
      }
      const mapped = item ? workKey(session.taskId!, item.id) : undefined;
      if (mapped && (entities.has(mapped) || aliases.has(mapped))) aliases.set(id, aliases.get(mapped) ?? mapped);
      else entities.set(id, { key: id, kind: 'subagent', entityId: id, familyId });
    }
  }
  return { entities, aliases };
}

function build(snapshot: Snapshot) {
  const { entities, aliases } = entitiesOf(snapshot);
  const previous = snapshot.taskIdentities;
  const registry: TaskIdentityRegistry = { schema: 1, nextShape: 0, nextFamily: 0, entries: Object.create(null), families: Object.create(null) };
  const used = new Set<number>();
  if (previous?.schema === 1) {
    registry.nextShape = validIndex(previous.nextShape) ? previous.nextShape : 0;
    registry.nextFamily = validIndex(previous.nextFamily) ? previous.nextFamily : 0;
    for (const [id, family] of Object.entries(previous.families ?? {})) {
      if (family && validColor(family.color)) registry.families[id] = { color: family.color };
    }
    // Keep reservations, including completed/deleted records, but repair imported collisions.
    for (const [id, entry] of Object.entries(previous.entries ?? {})) {
      if (!entry || !['task', 'work', 'subagent'].includes(entry.kind) || typeof entry.entityId !== 'string' || typeof entry.familyId !== 'string') continue;
      if (!validIndex(entry.shapeIndex) || used.has(entry.shapeIndex)) continue;
      registry.entries[id] = { kind: entry.kind, entityId: entry.entityId, familyId: entry.familyId, shapeIndex: entry.shapeIndex };
      used.add(entry.shapeIndex);
      registry.nextShape = Math.max(registry.nextShape, entry.shapeIndex + 1);
    }
  }
  // A source-only child later gains a WorkItem. Transfer its icon instead of allocating twice.
  for (const [alias, canonical] of aliases) {
    const source = registry.entries[alias];
    if (!source || registry.entries[canonical]) continue;
    registry.entries[canonical] = { ...source, ...entities.get(canonical) };
    delete registry.entries[alias];
  }
  const relocatedWork = new Map<string, string[]>();
  for (const [oldKey, old] of Object.entries(registry.entries)) {
    if (old.kind === 'work' && !entities.has(oldKey) && !aliases.has(oldKey)) {
      const candidates = relocatedWork.get(old.entityId) ?? [];
      candidates.push(oldKey); relocatedWork.set(old.entityId, candidates);
    }
  }
  for (const entity of entities.values()) {
    if (!registry.families[entity.familyId]) {
      registry.families[entity.familyId] = { color: TASK_FAMILY_COLORS[registry.nextFamily % TASK_FAMILY_COLORS.length] };
      registry.nextFamily++;
    }
    let entry = registry.entries[entity.key];
    if (!entry && entity.kind === 'work') {
      // A moved subtree keeps its shapes, even when its root task/family changes.
      const oldKey = relocatedWork.get(entity.entityId)?.pop();
      if (oldKey) { entry = registry.entries[oldKey]; delete registry.entries[oldKey]; }
    }
    if (!entry) {
      while (used.has(registry.nextShape)) registry.nextShape++;
      if (!validIndex(registry.nextShape)) throw new Error('任务图标编号已超出可保存范围');
      entry = { ...entity, shapeIndex: registry.nextShape++ };
      used.add(entry.shapeIndex);
    }
    registry.entries[entity.key] = { kind: entity.kind, entityId: entity.entityId, familyId: entity.familyId, shapeIndex: entry.shapeIndex };
  }
  return { registry, entities, aliases };
}

/** Called in the same atomic transaction as task creation/import/source updates. */
export function normalizeTaskIdentities(snapshot: Snapshot): boolean {
  const result = build(snapshot);
  const changed = JSON.stringify(snapshot.taskIdentities) !== JSON.stringify(result.registry);
  if (changed) snapshot.taskIdentities = result.registry;
  cache.set(snapshot, result);
  return changed;
}

/** Pure read for local/desktop/remote snapshots; legacy fallback is deterministic and cached. */
export function getTaskIdentity(snapshot: Snapshot, target: TaskIdentityTarget): TaskVisualIdentity | null {
  let result = cache.get(snapshot);
  if (!result) { result = build(snapshot); cache.set(snapshot, result); }
  let id: string | undefined;
  if (target.sessionId && target.subAgentId) id = subKey(target.sessionId, target.subAgentId);
  else if (target.workItemId) {
    if (target.taskId) id = target.workItemId === target.taskId ? taskKey(target.taskId) : workKey(target.taskId, target.workItemId);
    else {
      const matching = [...result.entities.values()].filter(e => e.kind === 'work' && e.entityId === target.workItemId);
      if (matching.length === 1) id = matching[0].key;
    }
  } else if (target.taskId) id = taskKey(target.taskId);
  if (!id) return null;
  id = result.aliases.get(id) ?? id;
  if (!result.entities.has(id)) return null;
  const entry = result.registry.entries[id];
  const family = entry && result.registry.families[entry.familyId];
  return entry && family ? { shapeIndex: entry.shapeIndex, color: family.color, familyId: entry.familyId } : null;
}
