import { businessTasks } from '../../data/businessTasks';
import { deliveryPresentation, deliverySlotEntry } from '../../data/deliveryPresentation';
import { selectProductAttention, type ProductAttention } from '../../data/productAttention';
import { noteWorkGuard } from '../../data/noteWorkSharing';
import type { PresentedResult } from '../../data/resultPresentation';
import type { Session, Snapshot, Task } from '../../data/types';

export type InboxFilter = 'all' | 'running' | 'returned' | 'attention';
export interface InboxRow {
  key: string;
  snapshot: Snapshot;
  task: Task;
  agent: string;
  at: string;
  status: string;
  group: InboxFilter;
  results: PresentedResult[];
  session?: Session;
  attention?: ProductAttention;
  problem?: string;
  canDispatch: boolean;
}

function statusOf(session: Session | undefined, attention: ProductAttention | undefined, hasResult: boolean, completed: boolean, guard?: string): Pick<InboxRow, 'status'|'group'|'problem'> {
  if (session?.dispatchPhase === 'unknown') return {status:'受理待核实', group:'attention', problem:'尚未收到 Agent 的受理回执。'};
  if (attention) return {status:attention.label, group:'attention', problem:attention.entry?.detail || attention.detail};
  if (session?.status === 'failed' || session?.dispatchPhase === 'rejected') return {status:'发送或执行失败', group:'attention', problem:session.failure || 'Agent 未能完成这次执行。'};
  if (session?.status === 'waiting_permission') return {status:'待授权', group:'attention', problem:session.waitingReason || 'Agent 需要工具授权。'};
  if (session?.status === 'waiting_reply' && !hasResult) return {status:'待回复', group:'attention', problem:session.waitingQuestion || session.waitingReason};
  if (session?.status === 'running') return {status:'执行中', group:'running'};
  if (session?.status === 'pending' || session?.status === 'queued') return {status:'排队中', group:'running'};
  if (hasResult) return {status:'已收结果', group:'returned'};
  if (completed) return {status:'已结束', group:'all'};
  if (guard) return {status:'等待分工', group:'attention', problem:guard};
  if (session?.status === 'paused' || session?.status === 'cancelled') return {status:session.status === 'paused' ? '已暂停' : '已取消', group:'attention',problem:session.failure};
  if (session?.status === 'archived') return {status:'已结束', group:'all'};
  return {status:'待发送', group:'all'};
}

export function inboxRows(snapshots: Snapshot[]): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.project.id || snapshot.project.deletedAt) continue;
    const entries = new Map<string, PresentedResult[]>();
    const representedOutputs = new Set<string>();
    function add(taskId: string, entry: PresentedResult) {
      if (!entry.sessionId && !entry.runId && entry.record.origin !== 'agent') return;
      const group = entries.get(taskId) ?? [];
      group.push(entry);
      entries.set(taskId, group);
    }
    const deliveries = deliveryPresentation(snapshot, {}, true);
    for (const slot of deliveries.contributions) {
      const result = deliverySlotEntry(snapshot, slot);
      if (!result) continue;
      add(slot.taskId,result);
      if (result.record.outputId) representedOutputs.add(result.record.outputId);
    }
    for (const {taskId, entry} of deliveries.history) {
      if (!entry.record.outputId || !representedOutputs.has(entry.record.outputId)) add(taskId,entry);
    }
    const alerts = selectProductAttention([snapshot]);
    const executions = new Map<string, Session[]>();
    for (const session of Object.values(snapshot.sessions)) {
      const rt = session.runtime;
      if (!session.taskId || session.linkedAsHistory || (rt ?
        rt.projectId !== snapshot.project.id || rt.taskId !== session.taskId || rt.purpose !== 'execution' : session.origin !== 'dispatch')) continue;
      const group = executions.get(session.taskId) ?? [];
      group.push(session);
      executions.set(session.taskId,group);
    }
    for (const task of businessTasks(snapshot)) {
      const results = entries.get(task.id) ?? [];
      results.sort((a,b)=> b.record.at.localeCompare(a.record.at) || a.record.id.localeCompare(b.record.id));
      const ordered = (executions.get(task.id) ?? []).sort((a,b)=> (b.startedAt || b.lastActivity).localeCompare(a.startedAt || a.lastActivity));
      const session = ordered.find(s=>s.status==='running'||s.status==='queued'||s.status==='pending') ?? ordered[0];
      if (!task.noteWork && !task.inputs?.some(input=>input.noteSource) && !session && !results.length) continue;
      const attention = alerts.find(alert=>alert.taskId === task.id && (
        alert.kind === 'permission' || alert.kind === 'decision' ||
        alert.kind === 'blocked' && !(alert.label === '待修改' && session?.status === 'running') ||
        alert.kind === 'question' && !results.some(result=>result.sessionId && result.sessionId === alert.entry?.sessionId && !snapshot.sessions[result.sessionId]?.runtime?.request)
      ));
      const guard = !ordered.length && task.noteWork ? noteWorkGuard(snapshot,task.id) : undefined;
      const agentId = session?.agentId ?? task.noteWork?.agentId ?? results[0]?.record.agentId;
      const agent = snapshot.agents.find(a=>a.id===agentId)?.name || agentId || 'Agent';
      const at = [task.createdAt,results[0]?.record.at || '',...ordered.map(s=>s.lastActivity)].sort().at(-1)!;
      rows.push({key:JSON.stringify([snapshot.project.id,task.id]), snapshot, task, at, agent, results, session, attention,
        ...statusOf(session,attention,results.length>0,!!task.completion,guard), canDispatch:!!task.noteWork && !guard && !session && !results.length && !task.completion});
    }
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}
