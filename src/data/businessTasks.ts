import { taskView } from './derive';
import { isBusinessTask } from './projectWorkflow';
import type { Snapshot } from './types';

/** Read-only projections: planning runs remain in the ledger and discussion history. */
export function businessTasks(snapshot: Snapshot) {
  return Object.values(snapshot.tasks).filter(task => isBusinessTask(snapshot, task.id));
}

export function businessJournal(snapshot: Snapshot, filter: 'all' | 'active' | 'done' = 'all') {
  const businessBlocks = snapshot.journal.blocks.filter(block => {
    if (block.kind === 'task') return !!snapshot.tasks[block.taskId] && isBusinessTask(snapshot, block.taskId);
    if (block.kind === 'session') {
      const session = snapshot.sessions[block.sessionId];
      const taskId = session?.runtime?.taskId ?? session?.taskId;
      return !taskId || isBusinessTask(snapshot, taskId);
    }
    return true;
  });
  const taskBlocks = businessBlocks.filter(block => block.kind === 'task');
  const completed = taskBlocks.filter(block => taskView(snapshot, snapshot.tasks[block.taskId]) === 'done').length;
  return {
    total: taskBlocks.length,
    completed,
    blocks: businessBlocks.filter(block => block.kind !== 'task' || filter === 'all' ||
      (taskView(snapshot, snapshot.tasks[block.taskId]) === 'done') === (filter === 'done')),
  };
}
