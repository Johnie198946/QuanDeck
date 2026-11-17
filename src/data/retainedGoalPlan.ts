import type { IdeaPlan, Snapshot } from './types';

/** Empty decomposition withdraws proposals; already materialized work keeps its identity. */
export function retainMaterializedGoalPlan(snapshot: Snapshot, plan: IdeaPlan): boolean {
  const c = snapshot.collaboration, versions = c?.goalPlans?.[plan.id], previous = versions?.at(-1);
  if (!c || !versions || !previous || plan.drafts.length || plan.adopted?.draftVersion !== plan.draftVersion || previous.draftVersion === plan.draftVersion) return false;
  const history = plan.discussion?.conclusions ?? [];
  const adoptedIndex = history.map(conclusion => conclusion.scopeId === 'root' && !!conclusion.adopted && (conclusion.adoptedDraftVersion ?? Infinity) <= plan.draftVersion).lastIndexOf(true);
  if (adoptedIndex < 0) return false;
  const withdrawal = [...history.slice(0, adoptedIndex + 1)].reverse().find(conclusion => conclusion.scopeId === 'root' && conclusion.tasks !== undefined);
  if (withdrawal?.tasks?.length !== 0) return false;
  const version = previous.version + 1, at = new Date().toISOString();
  versions.push({ ...structuredClone(previous), tasks: previous.tasks.map(binding => ({ ...binding, specRevision: c.tasks[binding.key]?.specRevision ?? binding.specRevision })), version, draftVersion: plan.draftVersion, at, retainedFromVersion: previous.version });
  c.events.push({ id: `goal-plan:${plan.id}:${version}`, sequence: ++c.sequence, type: 'goal_plan_retained', actor: 'system', at, detail: JSON.stringify({ planId: plan.id, version, retainedFromVersion: previous.version, draftVersion: plan.draftVersion, withdrawalConclusionId: withdrawal.id, taskKeys: previous.tasks.map(task => task.key), slotIds: previous.slots.map(slot => slot.id) }) });
  return true;
}

/** Prove graph identity across retained revisions; task requirements may still advance. */
export function retainsGoalPlanVersion(snapshot: Snapshot, planId: string, fromVersion: number, toVersion: number): boolean {
  if (fromVersion === toVersion) return false;
  const versions = snapshot.collaboration?.goalPlans?.[planId] ?? [], seen = new Set<number>();
  let current = versions.find(version => version.version === toVersion);
  while (current && current.version !== fromVersion) {
    if (seen.has(current.version) || current.retainedFromVersion === undefined) return false;
    seen.add(current.version);
    const previous = versions.find(version => version.version === current!.retainedFromVersion);
    if (!previous || JSON.stringify(previous.tasks.map(({specRevision: _revision, ...binding}) => binding)) !== JSON.stringify(current.tasks.map(({specRevision: _revision, ...binding}) => binding)) || JSON.stringify(previous.slots) !== JSON.stringify(current.slots)) return false;
    current = previous;
  }
  return current?.version === fromVersion;
}
