import { ensureCollaboration, hashText, taskKey } from './collaboration';
import type { GoalPlanVersion } from './goalDelivery';
import type { IdeaPlan, Snapshot } from './types';

/** A task direction may execute itself only when its existing scope is a live leaf. */
export function canExecutePlanTaskDirectly(snapshot: Snapshot, plan: IdeaPlan): boolean {
  if (plan.scope === 'project' || !plan.taskId || plan.drafts.length || plan.adopted?.draftVersion !== plan.draftVersion) return false;
  const c = snapshot.collaboration, task = c?.tasks[taskKey(plan.taskId, plan.itemId)];
  if (!task || task.archived || task.status === 'cancelled') return false;
  const items = snapshot.orchestrations?.[plan.taskId]?.items ?? {};
  return !Object.values(c!.tasks).some(child => {
    if (child.taskId !== plan.taskId || !child.workItemId || child.key === task.key || child.archived || child.status === 'cancelled') return false;
    if (!plan.itemId) return true;
    const seen = new Set<string>();
    let parent = items[child.workItemId]?.parentTaskId;
    while (parent && !seen.has(parent)) {
      if (parent === plan.itemId) return true;
      seen.add(parent); parent = items[parent]?.parentTaskId;
    }
    return false;
  });
}

export function isDirectTaskPlan(program: GoalPlanVersion | undefined, plan: IdeaPlan): boolean {
  return !!program && program.scope === 'task' && !program.slots.length && program.tasks.length === 1 && program.tasks[0].key === taskKey(plan.taskId, plan.itemId);
}

/** Reuse the ledger identity and project delivery map; never manufacture another task or slot. */
export function materializeDirectTaskPlan(snapshot: Snapshot, plan: IdeaPlan): boolean {
  const c = ensureCollaboration(snapshot);
  if (!canExecutePlanTaskDirectly(snapshot, plan)) return false;
  const versions = (c.goalPlans ??= {})[plan.id] ??= [], previous = versions.at(-1);
  if (previous?.draftVersion === plan.draftVersion || previous && !isDirectTaskPlan(previous, plan)) return false;
  const key = taskKey(plan.taskId, plan.itemId), task = c.tasks[key], version = (previous?.version ?? 0) + 1, at = new Date().toISOString();
  const binding = previous?.tasks[0] ?? {key, taskId: plan.taskId, workItemId: plan.itemId ?? undefined, draftKey: `direct-${hashText(key)}`, specRevision: task.specRevision};
  versions.push({id: plan.id, title: plan.title, scope: 'task', taskId: plan.taskId, version, draftVersion: plan.draftVersion, at,
    tasks: [{...binding, specRevision: task.specRevision}], slots: [], ...(previous ? {retainedFromVersion: previous.version} : {})});
  c.events.push({id: `goal-plan:${plan.id}:${version}`, sequence: ++c.sequence, type: previous ? 'goal_plan_retained' : 'goal_plan_materialized', actor: 'human', at,
    detail: JSON.stringify({planId: plan.id, version, draftVersion: plan.draftVersion, taskKeys: [key], slotIds: [], directTask: true, ...(previous ? {retainedFromVersion: previous.version} : {})})});
  return true;
}
