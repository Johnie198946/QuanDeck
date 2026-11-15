import type { Orchestration, WorkItem } from './types';

export function taskMapItems(orchestration: Orchestration): WorkItem[] {
  const ids = [...new Set([...orchestration.itemOrder, ...Object.keys(orchestration.items)])];
  return ids.map(id => orchestration.items[id]).filter(Boolean);
}

export function taskMapChildren(orchestration: Orchestration, parentId: string): WorkItem[] {
  return taskMapItems(orchestration).filter(item => item.parentTaskId === parentId && item.id !== parentId);
}

/** Parent links, not dependency links, define the drill-down path. */
export function taskMapPath(orchestration: Orchestration, itemId: string): WorkItem[] {
  const path: WorkItem[] = [];
  const seen = new Set<string>();
  let item = orchestration.items[itemId];
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    path.unshift(item);
    item = orchestration.items[item.parentTaskId];
  }
  return path;
}

export function taskMapGroups(orchestration: Orchestration, children: WorkItem[]) {
  const phases = [...new Set([...orchestration.phases, ...children.map(item => item.phase)])];
  return phases.map(phase => ({ phase, items: children.filter(item => item.phase === phase) }))
    .filter(group => group.items.length > 0);
}
