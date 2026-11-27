import { taskKey } from '../../data/collaboration';
import { businessTasks } from '../../data/businessTasks';
import { receiptForSlot } from '../../data/deliveryContract';
import { deliveryPresentation, deliverySlotEntry } from '../../data/deliveryPresentation';
import { selectProductAttention, type ProductAttention } from '../../data/productAttention';
import { noteWorkGuard } from '../../data/noteWorkSharing';
import { presentResult, type PresentedResult } from '../../data/resultPresentation';
import type { Session, Snapshot, Task, WorkItem } from '../../data/types';

const dateFormat = new Intl.DateTimeFormat('zh-CN',{month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
export function formatInboxTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
}

export type InboxFilter = 'all' | 'running' | 'returned' | 'attention';
export interface InboxResult extends PresentedResult { slotId?: string }
export interface InboxTarget { projectId: string; taskId?: string; itemId?: string; attentionId?: string }
export interface InboxRow {
  key: string;
  snapshot: Snapshot;
  task: Task;
  agent: string;
  at: string;
  status: string;
  group: InboxFilter;
  results: InboxResult[];
  item?: WorkItem;
  reminderGone?: boolean;
  session?: Session;
  attention?: ProductAttention;
  problem?: string;
  canDispatch: boolean;
}

/** Restore prior Agent versions for an opened task, including immutable slot receipts from older plans. */
export function inboxResultVersions(row: InboxRow, itemId?:string, pinnedId?:string): InboxResult[] {
  const {snapshot,task}=row;
  const ledger=snapshot.collaboration;
  if (!ledger) return row.results;
  const versions=[...row.results];
  const represented=new Set(versions.map(entry=>entry.artifactId));
  for (const artifact of ledger.artifacts) {
    const owner=ledger.tasks[artifact.key];
    if (!owner || owner.taskId!==task.id || !artifact.runId || itemId && owner.workItemId!==itemId) continue;
    const prefix='artifact:'+artifact.id+':';
    if (pinnedId?.startsWith(prefix) && !versions.some(entry=>entry.record.id===pinnedId)) {
      const slotId=pinnedId.slice(prefix.length);
      // Look up the contract revision which verifies this receipt. A newer slot with the same ID can have a different contract.
      for (const history of Object.values(ledger.goalPlans ?? {})) {
        const slot=history.flatMap(plan=>plan.slots).find(slot=>slot.taskKey===artifact.key && slot.id===slotId &&
          (slot.contract ? receiptForSlot(artifact,slot)
            : artifact.deliverySlotIds?.includes(slotId)));
        if (!slot) continue;
        const entry=deliverySlotEntry(snapshot,{...slot,artifact,state:'stale',sourceSessionId:ledger.runs[artifact.runId]?.sessionId});
        if (entry) { versions.push(entry);represented.add(artifact.id);break; }
      }
    }
    if (represented.has(artifact.id)) continue;
    versions.push(presentResult(snapshot,task.id,{
      id:'submission:'+artifact.id,artifactId:artifact.id,outputId:artifact.outputId,origin:'agent',title:artifact.title,
      text:artifact.body,at:artifact.createdAt,itemId:owner.workItemId,sessionId:ledger.runs[artifact.runId]?.sessionId,
      links:artifact.links,attachments:artifact.attachments,
    },true));
  }
  return versions.sort((a,b)=>b.record.at.localeCompare(a.record.at));
}

function statusOf(session: Session | undefined, attention: ProductAttention | undefined, hasResult: boolean, completed: boolean, guard?: string): Pick<InboxRow, 'status'|'group'|'problem'> {
  if (session?.dispatchPhase === 'unknown') return {status:'受理待核实', group:'attention', problem:'尚未收到 Agent 的受理回执。'};
  if (attention) return {status:attention.label, group:'attention', problem:attention.entry?.detail || attention.detail};
  if (session?.status === 'failed' || session?.dispatchPhase === 'rejected') return {status:'发送或执行失败', group:'attention', problem:session.failure || 'Agent 未能完成这次执行。'};
  if (session?.status === 'waiting_permission') return {status:'待授权', group:'attention', problem:session.waitingReason || 'Agent 需要工具授权。'};
  if (session?.status === 'waiting_reply' && !hasResult) return {status:'待回复', group:'attention', problem:session.waitingQuestion || session.waitingReason};
  if (session?.status === 'running') return {status:'执行中', group:'running'};
  if (session?.status === 'pending' || session?.status === 'queued') return {status:'排队中', group:'running'};
  if (completed) return {status:'已完成', group:hasResult?'returned':'all'};
  if (hasResult) return {status:'已收结果', group:'returned'};
  if (guard) return {status:'等待分工', group:'attention', problem:guard};
  if (session?.status === 'paused' || session?.status === 'cancelled') return {status:session.status === 'paused' ? '已暂停' : '已取消', group:'attention',problem:session.failure};
  if (session?.status === 'archived') return {status:'已结束', group:'all'};
  return {status:'待发送', group:'all'};
}

export function inboxRows(snapshots: Snapshot[], target?: InboxTarget): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.project.id || snapshot.project.deletedAt) continue;
    const entries = new Map<string, InboxResult[]>();
    const representedOutputs = new Set<string>();
    function add(taskId: string, entry: InboxResult) {
      if (!entry.sessionId && !entry.runId && entry.record.origin !== 'agent') return;
      const group = entries.get(taskId) ?? [];
      group.push(entry);
      entries.set(taskId, group);
    }
    const deliveries = deliveryPresentation(snapshot, {}, true);
    for (const slot of deliveries.contributions) {
      const result = deliverySlotEntry(snapshot, slot);
      if (!result) continue;
      add(slot.taskId,{ ...result, slotId:slot.id });
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
      const focus = target?.projectId === snapshot.project.id && target.taskId === task.id ? target : undefined;
      const itemId = focus?.itemId;
      const item = itemId ? snapshot.orchestrations?.[task.id]?.items[itemId] : undefined;
      const taskResults = entries.get(task.id) ?? [];
      const taskSessions = executions.get(task.id) ?? [];
      if (!task.noteWork && !task.inputs?.some(input=>input.noteSource) && !taskSessions.length && !taskResults.length) continue;
      const results = itemId ? taskResults.filter(entry=>entry.record.itemId === itemId) : taskResults;
      results.sort((a,b)=> b.record.at.localeCompare(a.record.at) || a.record.id.localeCompare(b.record.id));
      const attempts = snapshot.orchestrations?.[task.id]?.attempts;
      const itemSessions = new Set(item?.attemptIds.map(id=>attempts?.[id]?.sessionId));
      const ordered = taskSessions.filter(s=>!itemId || s.runtime?.workItemId===itemId || itemSessions.has(s.id))
        .sort((a,b)=> (b.startedAt || b.lastActivity).localeCompare(a.startedAt || a.lastActivity));
      const activeSession = ordered.find(s=>s.status==='running'||s.status==='queued'||s.status==='pending') ?? ordered[0];
      const taskAlerts = alerts.filter(alert=>alert.taskId === task.id && (!itemId || alert.itemId === itemId));
      const attention = focus?.attentionId ? taskAlerts.find(alert=>alert.id===focus.attentionId) : taskAlerts.find(alert=>(
        alert.kind === 'permission' || alert.kind === 'decision' ||
        alert.kind === 'blocked' && !(alert.label === '待修改' && activeSession?.status === 'running') ||
        alert.kind === 'question' && !results.some(result=>result.sessionId && result.sessionId === alert.entry?.sessionId && !snapshot.sessions[result.sessionId]?.runtime?.request && !Object.keys(snapshot.sessions[result.sessionId]?.runtime?.requests ?? {}).length)
      ));
      const attentionSessionId = attention?.blockedSessionId || attention?.entry?.sessionId;
      const session = ordered.find(s=>s.id===attentionSessionId) ?? activeSession;
      const guard = !itemId && !ordered.length && task.noteWork ? noteWorkGuard(snapshot,task.id) : undefined;
      const agentId = session?.agentId ?? (itemId ? undefined : task.noteWork?.agentId) ?? results[0]?.record.agentId;
      const agent = snapshot.agents.find(a=>a.id===agentId)?.name || agentId || 'Agent';
      const at = [task.createdAt,results[0]?.record.at || '',...ordered.map(s=>s.lastActivity)].sort().at(-1)!;
      const completed = itemId ? item?.status === 'done' : !!task.completion || snapshot.collaboration?.tasks[taskKey(task.id)]?.status==='done';
      rows.push({item, reminderGone:!!focus?.attentionId && !attention, key:JSON.stringify([snapshot.project.id,task.id]), snapshot, task, at, agent, results, session, attention,
        ...statusOf(session,attention,results.length>0,completed,guard), canDispatch:!itemId && !!task.noteWork && !guard && !session && !results.length && !task.completion});
    }
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}
