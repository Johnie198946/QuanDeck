import type { Snapshot, WorkItem, WorkStatus } from './types';
import { childrenOf, latestAttempt, topItems } from './orchestration';
import { completedResults, workBranch } from './results';
import { instant, intervalRange, rangeMinutes, visibleIntervals } from './timeline';

export type ResultBucket = 'done' | 'running' | 'attention' | 'pending' | 'cancelled';
export const RESULT_BUCKET_LABEL: Record<ResultBucket, string> = {
  done: '已完成', running: '进行中', attention: '待处理', pending: '待推进', cancelled: '已取消',
};
export const resultBucket = (status: WorkStatus): ResultBucket => status === 'done' ? 'done'
  : status === 'running' ? 'running' : status === 'cancelled' ? 'cancelled'
  : ['waiting_reply', 'waiting_permission', 'failed', 'review'].includes(status) ? 'attention' : 'pending';

export interface TokenAllocation {
  id: string; itemId: string | null; title: string; tokens: number; unknown: boolean; known: number; color: string;
}

/** Counts at one level. Own attempt tokens are exclusive; inclusive session totals are never added again. */
export function deriveResultMetrics(snap: Snapshot, taskId: string, itemId: string | null) {
  const task = snap.tasks[taskId];
  const o = snap.orchestrations?.[taskId];
  const selected = itemId ? o?.items[itemId] : undefined;
  const validScope = !!task && (!itemId || !!selected);
  const children = [...new Map((validScope && o ? (selected ? childrenOf(o, selected.id) : topItems(o)) : []).map(item => [item.id, item])).values()];
  const branch = validScope && o ? workBranch(o, itemId) : [];
  const branchIds = new Set(branch.map(item => item.id));
  const counts: Record<ResultBucket, number> = { done: 0, running: 0, attention: 0, pending: 0, cancelled: 0 };
  children.forEach(item => counts[resultBucket(item.status)]++);
  const sessionIds = [...new Set(task?.sessionIds ?? [])];
  const sessions = sessionIds.map(id => snap.sessions[id]).filter(Boolean);
  const latestSession = o?.mainSessionId ? snap.sessions[o.mainSessionId] : sessions.find(session => session.status !== 'archived') ?? sessions.at(-1);
  const latest = selected && o ? latestAttempt(o, selected) : null;
  const step = selected ? latest?.step : latestSession?.step;
  const manual = validScope && (selected ? selected.owner === "me" && !latest : !sessions.length && (task?.owner ?? "me") === "me");
  const total = children.length || (manual ? 1 : null) || (validScope && step?.total && step.total > 0 ? step.total : null);
  const completed = children.length ? counts.done : manual ? (selected ? selected.status === "done" : !!task?.completion) ? 1 : 0 : total && step?.completed != null ? Math.max(0, Math.min(total, step.completed)) : null;
  const ratio = total && completed != null ? completed / total : null;
  const status = selected?.status ?? (task?.completion ? 'done' : latestSession?.status === 'archived' ? 'review' : latestSession?.status);
  const tokens: TokenAllocation[] = [];
  const representedSessions = new Set<string>();
  const seenAttempts = new Set<string>();
  const addAttempts = (rowId: string, title: string, targetId: string | null, items: WorkItem[]) => {
    const ids = new Set(items.map(item => item.id));
    const attempts = Object.values(o?.attempts ?? {}).filter(attempt => ids.has(attempt.workItemId) && !seenAttempts.has(attempt.id));
    if (!attempts.length) return;
    let amount = 0, known = 0, unknown = false;
    for (const attempt of attempts) {
      if (seenAttempts.has(attempt.id)) continue;
      seenAttempts.add(attempt.id); representedSessions.add(attempt.sessionId);
      if (attempt.tokens == null) unknown = true;
      else { amount += Math.max(0, attempt.tokens); known++; }
    }
    const agentId = attempts.length && o?.executors[attempts[0].executorId]?.agentId;
    tokens.push({ id: rowId, itemId: targetId, title, tokens: amount, unknown, known,
      color: snap.agents.find(agent => agent.id === agentId)?.color ?? '#8b9e98' });
  };
  if (validScope && o) {
    // Children form disjoint branches; no descendant enters another branch's sum.
    for (const child of children) addAttempts(child.id, child.title, child.id, workBranch(o, child.id));
    if (selected) addAttempts(`self:${selected.id}`, '本任务', selected.id, [selected]);
    if (!selected) {
      if (o.mainSessionId) representedSessions.add(o.mainSessionId);
      // Session-level totals for any represented attempt are inclusive, even if a receipt has not yet joined itemOrder.
      Object.values(o.attempts).forEach(attempt => representedSessions.add(attempt.sessionId));
      if (o.coordinationTokens != null || o.mainExecutorId) tokens.push({ id: 'coordination', itemId: null, title: '主任务协调',
        tokens: Math.max(0, o.coordinationTokens ?? 0), unknown: o.coordinationTokens == null, known: o.coordinationTokens == null ? 0 : 1,
        color: snap.agents.find(agent => agent.id === o.mainAgentId)?.color ?? '#8b9e98' });
    }
  }
  if (validScope && !itemId) for (const session of sessions) {
    if (representedSessions.has(session.id)) continue;
    tokens.push({ id: `session:${session.id}`, itemId: null, title: session.title, tokens: Math.max(0, session.tokens ?? 0),
      unknown: session.tokens == null, known: session.tokens == null ? 0 : 1,
      color: snap.agents.find(agent => agent.id === session.agentId)?.color ?? '#8b9e98' });
  }
  const tokenValue = tokens.some(row => row.known > 0) ? tokens.reduce((sum, row) => sum + row.tokens, 0) : null;
  const partialTokens = tokens.some(row => row.unknown);
  const reports = validScope ? completedResults(snap, taskId, itemId).map(report => {
    let timestamp = Number.NaN;
    try { timestamp = Date.parse(instant(report.at, snap.date, snap.project.timeZone)); } catch { /* Missing source times are not time-series points. */ }
    return { ...report, timestamp };
  }).sort((a, b) => Number.isFinite(a.timestamp) ? Number.isFinite(b.timestamp) ? a.timestamp - b.timestamp : -1 : 1) : [];
  const intervals = validScope ? visibleIntervals(snap).filter(interval => interval.taskId === taskId && (!itemId || !!interval.workItemId && branchIds.has(interval.workItemId))) : [];
  // Exact running intervals only; never use start-to-end elapsed time as active time.
  const activeMinutes = intervals.length ? rangeMinutes(intervals.map(interval => intervalRange(interval, snap))) : null;
  return { manual, children, counts, total, completed, ratio, status, tokens, tokenValue, partialTokens, reports, activeMinutes };
}
