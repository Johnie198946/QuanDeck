import { deriveProjectActivity, type ProjectActivityEntry } from './projectActivity';
import { businessTasks } from './businessTasks';
import type { Snapshot } from './types';

export function monitorActivity(projects:Snapshot[]){
  return projects.flatMap(project => {
    const base = deriveProjectActivity(project).entries;
    const human: ProjectActivityEntry[] = [];
    for (const task of businessTasks(project)) {
      const root = project.collaboration?.tasks[task.id];
      if (root?.owner === 'me' && root.status === 'running') human.push({id:`me:${task.id}`,title:task.title,state:'running',taskId:task.id});
      for (const item of Object.values(project.orchestrations?.[task.id]?.items ?? {})) {
        if (item.owner === 'me' && item.status === 'running') human.push({id:`me:${task.id}:${item.id}`,title:item.title,state:'running',taskId:task.id,itemId:item.id});
      }
    }
    const order = new Map((project.nowQueue?.order ?? []).map((id,i) => [id,i]));
    return [...base,...human].sort((a,b) => (order.get(a.id) ?? Infinity)-(order.get(b.id) ?? Infinity)).map(entry => ({project,entry,id:`${project.project.id}:${entry.id}`}));
  });
}
