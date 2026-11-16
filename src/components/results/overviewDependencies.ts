import type { OverviewNode } from '../../data/overviewTree';
import type { Snapshot } from '../../data/types';

/** Dependencies are projected from the task ledger; legacy work items retain their recorded links. */
export function overviewDependencies(snapshot: Snapshot, node: OverviewNode): string[] {
  if (!node.taskId) return [];
  const task = Object.values(snapshot.collaboration?.tasks ?? {}).find(item => item.taskId === node.taskId && (item.workItemId ?? null) === (node.itemId ?? null));
  if (task) return task.dependencies.map(key => snapshot.collaboration?.tasks[key]?.title ?? '待核对依赖');
  const work = node.itemId ? snapshot.orchestrations?.[node.taskId]?.items[node.itemId] : undefined;
  return work?.dependsOnTaskIds.map(id => snapshot.orchestrations?.[node.taskId!]?.items[id]?.title ?? snapshot.tasks[id]?.title ?? '待核对依赖') ?? [];
}
