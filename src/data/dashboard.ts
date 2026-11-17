import { taskOverviewRows } from './results';
import { topItems } from './orchestration';
import { supersededStoppedSession } from './sessionHistory';
import type { Snapshot } from './types';

export type OverviewBucket = 'running' | 'attention' | 'pending' | 'done' | 'cancelled';
export const OVERVIEW_LABELS: Record<OverviewBucket, string> = {
  running: '进行中', attention: '待处理', pending: '待推进', done: '已完成', cancelled: '已取消',
};

/** A main task occupies one segment; waiting branches take priority over running ones. */
export function dashboardOverview(snap: Snapshot) {
  const rows = taskOverviewRows(snap).map(row => {
    const bucket: OverviewBucket = row.status === 'done' ? 'done'
      : row.status === 'cancelled' ? 'cancelled'
      : row.waiting || ['failed', 'rejected', 'unknown'].includes(row.status) ? 'attention'
      : row.running ? 'running' : 'pending';
    const orchestration = snap.orchestrations?.[row.task.id];
    const children = orchestration ? topItems(orchestration) : [];
    const sessions = row.task.sessionIds.map(id => snap.sessions[id]).filter(Boolean).filter(session => !session.linkedAsHistory && !supersededStoppedSession(snap, session));
    const session = sessions.find(value => value.status !== 'archived') ?? sessions.at(-1);
    const step = session?.step;
    const completed = children.length ? children.filter(item => item.status === 'done').length
      : step?.total ? Math.min(step.total, Math.max(0, step.completed ?? 0)) : 0;
    const total = children.length || step?.total || 0;
    const pendingItem = orchestration && Object.values(orchestration.items).find(item =>
      ['waiting_reply', 'waiting_permission', 'failed'].includes(item.status));
    const question = pendingItem?.waiting?.question || pendingItem?.statusReason
      || session?.waitingQuestion || session?.waitingReason || session?.failure
      || (row.status === 'review' ? '子任务已结束，等待验收。' : '查看执行详情，继续推进。');
    return { ...row, bucket, children, session, completed, total, pendingItem, question };
  });
  const counts: Record<OverviewBucket, number> = { running: 0, attention: 0, pending: 0, done: 0, cancelled: 0 };
  for (const row of rows) counts[row.bucket]++;
  return { rows, counts };
}

/** Keep simultaneous intervals separately focusable instead of painting over them. */
export function dashboardLanes<T extends { from: number; to: number }>(intervals: T[]) {
  const ends: number[] = [];
  const lanes = [...intervals].sort((a, b) => a.from - b.from || a.to - b.to).map(interval => {
    let lane = ends.findIndex(end => end <= interval.from);
    if (lane < 0) lane = ends.length;
    ends[lane] = interval.to;
    return { interval, lane };
  });
  return { lanes, count: ends.length };
}
