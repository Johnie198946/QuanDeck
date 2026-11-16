import type { CommandResult, Session, Snapshot } from './types';
import type { RuntimeAction } from './runtimeContracts';

export interface DeletionIssue {
  id: string;
  kind: 'session' | 'timer' | 'run' | 'background';
  title: string;
  detail: string;
  sessionId?: string;
  planId?: string;
  canClose: boolean;
}
const settled = new Set(['archived', 'failed', 'cancelled']);
const statusLabels: Record<string, string> = { running: '执行中', pending: '等待受理', waiting_reply: '等待回复', waiting_permission: '等待授权', paused: '已暂停' };

/** The same relationships drive deletion guards and their actionable UI. */
export function deletionIssues(snapshot: Snapshot, taskId?: string, itemIds?: Set<string>): DeletionIssue[] {
  const relevant = (id: string | null | undefined, itemId?: string) => !taskId || id === taskId && (!itemIds || !!itemId && itemIds.has(itemId));
  const relatedSession = (session: Session) => {
    if (relevant(session.taskId, session.runtime?.workItemId)) return true;
    const plan = session.runtime?.planId ? snapshot.ideaPlans?.[session.runtime.planId] : undefined;
    if (plan && relevant(plan.taskId, plan.itemId ?? undefined)) return true;
    const submission = session.runtime?.reviewSubmissionId ? snapshot.collaboration?.submissions.find(value => value.id === session.runtime!.reviewSubmissionId) : undefined;
    const target = submission ? snapshot.collaboration?.tasks[submission.key] : undefined;
    return !!target && relevant(target.taskId, target.workItemId);
  };
  const issues: DeletionIssue[] = Object.values(snapshot.sessions).filter(session => relatedSession(session) && !settled.has(session.status)).map(session => ({
    id: `session:${session.id}`, kind: 'session', title: session.title,
    detail: statusLabels[session.status] || '待收尾', sessionId: session.id,
    canClose: !!session.runtime?.runId && !session.runtime.controlPending && !['unknown', 'submitting'].includes(session.dispatchPhase || ''),
  }));
  for (const item of Object.values(taskId ? snapshot.orchestrations?.[taskId]?.items ?? {} : {})) {
    if (itemIds?.has(item.id) && ['running','queued','paused','waiting_reply','waiting_permission'].includes(item.status))
      issues.push({ id: `work:${item.id}`, kind: 'run', title: item.title, detail: '子任务仍在执行或等待处理', canClose: false });
  }
  for (const plan of snapshot.plans.filter(plan => relevant(plan.taskId, plan.workItemId) && !!plan.manualStartedAt))
    issues.push({ id: `timer:${plan.id}`, kind: 'timer', title: plan.title, detail: '人工计时中', planId: plan.id, canClose: true });
  for (const run of Object.values(snapshot.collaboration?.runs ?? {})) {
    const task = snapshot.collaboration?.tasks[run.key], session = run.sessionId ? snapshot.sessions[run.sessionId] : undefined;
    if ((relevant(task?.taskId, task?.workItemId) || !!session && relatedSession(session)) && !['succeeded','failed','cancelled'].includes(run.status) && !issues.some(issue => issue.sessionId === run.sessionId && !!run.sessionId))
      issues.push({ id: `run:${run.id}`, kind: 'run', title: task?.title || '关联执行', detail: '尚未收到结束回执', canClose: false, sessionId: run.sessionId });
  }
  if (!taskId && (Object.values(snapshot.intelligence?.jobs ?? {}).some(job => ['queued','running'].includes(job.status)) || Object.values(snapshot.integration?.reviewJobs ?? {}).some(job => job.status === 'running')))
    issues.push({ id: 'background', kind: 'background', title: '后台分析', detail: '分析结束后即可移除项目', canClose: false });
  return issues;
}

export function deletionBlocker(snapshot: Snapshot, taskId?: string, itemIds?: Set<string>): string | undefined {
  const issues = deletionIssues(snapshot, taskId, itemIds);
  if (!issues.length) return;
  return `还有 ${issues.length} 项需收尾：${issues.slice(0, 2).map(issue => `${issue.title}（${issue.detail}）`).join('、')}。请在下方处理后再删除。`;
}

/** Stop/archive is explicit and source-acknowledged; a sent command is not proof of stopping. */
export async function closeDeletionSession(api: {
  listProjects(): Promise<Snapshot[]>;
  controlSession(sessionId: string, action: RuntimeAction): Promise<CommandResult>;
}, projectId: string, sessionId: string): Promise<CommandResult> {
  const read = async () => (await api.listProjects()).find(project => project.project.id === projectId)?.sessions[sessionId];
  let session = await read();
  if (!session) return { ok: false, message: '会话已变化，请刷新后重试' };
  if (settled.has(session.status)) return { ok: true };
  if (!session.runtime?.runId || ['unknown', 'submitting'].includes(session.dispatchPhase || '')) return { ok: false, message: '执行受理状态尚未确认，请打开源会话核对' };
  if (['running', 'pending', 'waiting_permission'].includes(session.status)) {
    const stopped = await api.controlSession(sessionId, 'stop');
    if (!stopped.ok) return stopped;
    session = await read();
    if (!session || ['running', 'pending', 'waiting_permission'].includes(session.status)) return { ok: false, message: '正在等待停止回执，收到后可继续归档；项目尚未删除' };
  }
  if (settled.has(session.status)) return { ok: true };
  const archived = await api.controlSession(sessionId, 'archive');
  if (!archived.ok) return archived;
  session = await read();
  return session && settled.has(session.status) ? { ok: true } : { ok: false, message: '正在等待归档回执；项目尚未删除' };
}
