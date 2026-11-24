import type { Snapshot } from './types';
import type { CollaborationTask } from './collaboration';

/** Only descendants block a parent's acceptance; siblings can be reviewed separately. */
export function unfinishedReviewChildren(snapshot: Snapshot, task: CollaborationTask) {
  const items = snapshot.orchestrations?.[task.taskId]?.items ?? {};
  return Object.values(snapshot.collaboration?.tasks ?? {}).filter(child => {
    if (child.taskId !== task.taskId || !child.workItemId || child.key === task.key || child.archived || ['done', 'cancelled'].includes(child.status)) return false;
    if (!task.workItemId) return true;
    const seen = new Set<string>();
    let parent = items[child.workItemId]?.parentTaskId;
    while (parent && !seen.has(parent)) {
      if (parent === task.workItemId) return true;
      seen.add(parent);
      parent = items[parent]?.parentTaskId;
    }
    return false;
  });
}
