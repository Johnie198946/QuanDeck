import { blockedTaskSession } from './blockedTask';
import { businessTasks } from './businessTasks';
import { deriveProjectActivity, type ProjectActivityEntry } from './projectActivity';
import { taskCloseouts } from './taskCloseout';
import { dateInZone } from './timeline';
import type { Snapshot } from './types';

export type ProductAttentionKind = 'permission' | 'question' | 'review' | 'decision' | 'blocked' | 'overdue' | 'stalled';
export interface ProductAttention {
  id: string;
  projectId: string;
  taskId?: string;
  itemId?: string;
  planId?: string;
  title: string;
  detail: string;
  kind: ProductAttentionKind;
  action: string;
  label: string;
  urgent?: boolean;
  entry?: ProjectActivityEntry;
  blockedSessionId?: string;
}

const urgency: Record<ProductAttentionKind, number> = {permission:0, question:1, review:2, decision:3, blocked:4, overdue:5, stalled:6};
export const compareProductAttention = (a: ProductAttention, b: ProductAttention) =>
  urgency[a.kind] - urgency[b.kind] || Number(b.urgent ?? false) - Number(a.urgent ?? false) || a.title.localeCompare(b.title, 'zh-CN');
const stateLabels: Record<ProductAttentionKind, string> = {
  permission:'待授权', question:'待回复', review:'待验收', decision:'待确认', blocked:'遇到问题', overdue:'已逾期', stalled:'进展待核对',
};
const actions: Record<ProductAttentionKind, string> = { permission:'查看授权', question:'去回复', review:'去验收', decision:'去确认', blocked:'查看原因', overdue:'看任务', stalled:'查看进度' };
const reminderKey = 'quandeck.product.reminder-actions.v1';
export const PRODUCT_REMINDERS_CHANGED = 'quandeck:product-reminders-changed';
export type ReminderActions = Record<string, { action: 'later' | 'declined' | 'handled'; at: number; until?: number }>;
export function readProductReminderActions(): ReminderActions {
  try { return JSON.parse(globalThis.localStorage?.getItem(reminderKey) ?? '{}') ?? {}; }
  catch { return {}; }
}
export function updateProductReminder(id: string, action: ReminderActions[string]['action'] | 'restore', at = Date.now()) {
  const current = readProductReminderActions();
  if (action === 'restore') delete current[id];
  else current[id] = { action, at, ...(action === 'later' ? { until: at + 86400000 } : {}) };
  const retained = Object.fromEntries(Object.entries(current).sort((a,b) => b[1].at - a[1].at).slice(0,500));
  globalThis.localStorage?.setItem(reminderKey, JSON.stringify(retained));
  globalThis.dispatchEvent(new Event(PRODUCT_REMINDERS_CHANGED));
}
export function productReminderHidden(row: ProductAttention, state: ReminderActions, now = Date.now()) {
  if (row.kind === 'permission' || row.kind === 'question') return false;
  const mark = state[row.id];
  return Boolean(mark && (mark.action !== 'later' || (mark.until ?? 0) > now));
}

/** Home, the bell and the monitor read the same business and source records. */
export function selectProductAttention(projects: Snapshot[], now = Date.now()): ProductAttention[] {
  const rows: ProductAttention[] = [];
  for (const snapshot of projects) {
    const projectId = snapshot.project.id;
    const today = dateInZone(now, snapshot.project.timeZone ?? 'Asia/Shanghai');
    const unique = new Map<string, ProductAttention>();
    const explicitlyAssigned = (text?: string) => Boolean(text && /(?:^|[【\[「\s])领导交办(?:[】\]」\s：:]|$)/u.test(text));
    const expresslyAssignedRoot = (taskId?: string) => Boolean(taskId && explicitlyAssigned(snapshot.tasks[taskId]?.originalTitle));
    const add = (input: Omit<ProductAttention, 'action' | 'label' | 'projectId'> & Partial<Pick<ProductAttention, 'action' | 'label'>>) => {
      const urgent = explicitlyAssigned(input.title) || (!input.itemId && expresslyAssignedRoot(input.taskId));
      const item = { action: actions[input.kind], label: stateLabels[input.kind], ...input, urgent, id: `${projectId}:${input.id}`, projectId };
      const key = (input.kind === 'permission' || input.kind === 'question') && input.entry?.sessionId ? `response:${input.entry.sessionId}` : input.taskId ? `${input.taskId}:${input.itemId ?? ''}` : input.planId ? `plan:${input.planId}` : `entry:${input.entry?.id ?? input.id}`;
      const prior = unique.get(key);
      if (!prior || urgency[item.kind] < urgency[prior.kind]) unique.set(key, item);
    };
    for (const session of Object.values(snapshot.sessions)) {
      if (!blockedTaskSession(snapshot,session)) continue;
      const rt = session.runtime!, issue = rt.submissionIssue!;
      add({id:'materials:'+session.id+':'+issue.messageId, kind:'blocked', action:'补充材料并重新派发',
        title:session.title, taskId:rt.taskId, itemId:rt.workItemId, detail:issue.message, blockedSessionId:session.id});
    }
    for (const entry of deriveProjectActivity(snapshot).entries) {
      const session = entry.sessionId ? snapshot.sessions[entry.sessionId] : undefined;
      if (blockedTaskSession(snapshot,session) && entry.state !== 'waiting_permission') continue;
      const incident = session?.runtime?.incident;
      if (entry.state === 'running' || entry.state === 'queued') {
        if (incident?.status === 'open' && incident.code === 'suspected_stall') add({id:`${entry.id}:stalled:${incident.id}`,title:entry.title,detail:'一段时间没有新进展，执行者可能还在处理。',kind:'stalled',taskId:entry.taskId,itemId:entry.itemId,entry});
        continue;
      }
      const pending = session?.runtime?.requests ?? (session?.runtime?.request ? { [session.runtime.request.id]:session.runtime.request } : {});
      const kind = entry.state === 'waiting_permission' ? 'permission' : entry.state === 'waiting_reply' ? 'question' : 'blocked';
      const signal = Object.keys(pending).sort().join(',') || session?.runtime?.finalReplyId || session?.lastActivity || entry.attemptId || '';
      add({id:`${entry.id}:${kind}:${signal}`, title:entry.title, detail:kind === 'permission' ? '执行者需要你的授权。' : kind === 'question' ? '执行者等你回复后才能继续。' : '这项任务遇到了问题。', kind, taskId:entry.taskId, itemId:entry.itemId, entry});
    }
    const closeouts = taskCloseouts(snapshot);
    for (const task of businessTasks(snapshot)) {
      const closeout = closeouts.get(task.id);
      for (const scope of closeout ? [closeout.root,...closeout.children] : []) {
        const ledger = snapshot.collaboration?.tasks[scope.key];
        if (ledger?.archived || ledger?.status === 'cancelled' || scope.settled) continue;
        const common = {taskId:task.id, itemId:scope.itemId, title:scope.title};
        if (scope.pending || scope.needsUpdate) add({...common,id:`review:${scope.key}:${ledger?.latestSubmissionId ?? ledger?.specRevision ?? ''}:${scope.needsUpdate}`,kind:'review',...(scope.needsUpdate ? {label:'需复核',action:'去复核'} : {}),detail:scope.needsUpdate ? '任务要求或依据已经变化，请重新核对。' : '成果已交付，等你验收。'});
        if (ledger?.blockReason || scope.returned) add({...common,id:`blocked:${scope.key}:${ledger?.version ?? ''}`,kind:'blocked',...(scope.returned ? {label:'待修改'} : {}),detail:scope.returned ? '成果已退回，等修好后重新提交。' : '缺少继续工作的条件。'});
        const plannedDue = snapshot.projectPlanning?.tasks[scope.key]?.end;
        const due = plannedDue || (!scope.itemId ? task.due?.date : undefined);
        if (due && due < today) add({...common,id:`overdue:${scope.key}:${due}`,kind:'overdue',detail:`截止日期 ${due}，任务仍未完成。`});
      }
    }
    for (const plan of Object.values(snapshot.ideaPlans ?? {})) {
      const proposal = plan.discussion?.conclusions?.at(-1);
      if (!proposal || plan.adopted?.draftVersion === plan.draftVersion) continue;
      if (!(proposal.tasks?.length || proposal.outline?.length)) continue;
      add({id:`plan:${plan.id}:${plan.draftVersion}:${proposal.id}`,planId:plan.id,taskId:plan.taskId || undefined,itemId:plan.itemId ?? undefined,title:plan.title,kind:'decision',detail:'方案有新的建议，等你确认。'});
    }
    const needsResponse = new Set([...unique.values()].filter(row => (row.kind === 'permission' || row.kind === 'question') && row.taskId).map(row => `${row.taskId}:${row.itemId ?? ''}`));
    rows.push(...[...unique.values()].filter(row => !row.taskId || !needsResponse.has(`${row.taskId}:${row.itemId ?? ''}`) || row.kind === 'permission' || row.kind === 'question'));
  }
  return rows.sort(compareProductAttention);
}
