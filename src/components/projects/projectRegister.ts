import { overviewNodeKey, overviewProject, type OverviewNode } from '../../data/overviewTree';
import { selectProductAttention, type ProductAttention } from '../../data/productAttention';
import { noteWorkGuard } from '../../data/noteWorkSharing';
import type { Snapshot } from '../../data/types';

export interface ProjectRegisterNode extends OverviewNode {
  workBucket: OverviewNode['bucket'];
  waitingForPeer?: boolean;
  attention?: ProductAttention;
  children: ProjectRegisterNode[];
}

/** The badge and action on a row refer to the same task or subtask. Parent rows only summarize child attention. */
export function projectRegister(snapshot: Snapshot, now = Date.now()): ProjectRegisterNode {
  const byKey = new Map<string, ProductAttention>();
  for (const item of selectProductAttention([snapshot], now)) {
    if (!item.taskId) continue;
    const key = overviewNodeKey(snapshot.project.id, item.taskId, item.itemId);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  function projectNode(source: OverviewNode): ProjectRegisterNode {
    let node: OverviewNode & {waitingForPeer?:boolean} = source;
    const task = !source.itemId && source.taskId ? snapshot.tasks[source.taskId] : undefined;
    if (task?.noteWork) {
      const executor = snapshot.agents.find(agent=>agent.id===task.noteWork!.agentId)?.name || task.noteWork.agentId;
      // A requested assignee is known even before the external agent acknowledges the job.
      if (!source.agentId) node = {...node,owner:executor};
      if (source.bucket==='pending' && noteWorkGuard(snapshot,task.id)) node={...node,waitingForPeer:true,state:task.noteWork.units.length?'等待分工':'由原任务承接'};
    }
    const children = node.children.map(projectNode);
    const attention = byKey.get(node.key);
    if (attention) return { ...node, workBucket:source.bucket, bucket:'attention', state:attention.label, attention, children };
    if (children.some(child => child.bucket === 'attention') && node.bucket !== 'attention') {
      return { ...node, workBucket:source.bucket, bucket:'attention', state:node.kind === 'project' ? '待处理' : '子任务待处理', children };
    }
    return { ...node, workBucket:source.bucket, children };
  }
  return projectNode(overviewProject(snapshot));
}
