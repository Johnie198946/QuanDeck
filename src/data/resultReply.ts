import type { PresentedResult } from './resultPresentation';
import type { Snapshot } from './types';
import { hashText } from './contentHash';
import { taskKey } from './collaboration';

export interface ResultReplyTarget {
  projectId: string;
  taskId: string;
  itemId?: string;
  sessionId: string;
  agentId: string;
  artifactId?: string;
  roundId?: string;
  hash: string;
}
export interface ResultReplyInput { target: ResultReplyTarget; text: string; messageId: string }
export interface ResultRevision { messageId: string; fingerprint: string; reviewId: string; sourceSessionId: string }

/** Recheck the immutable delivery, its executor and the exact scope, also at the IPC boundary. */
export function checkResultReply(snapshot: Snapshot, target: ResultReplyTarget): string | undefined {
  const session = snapshot.sessions[target.sessionId], rt = session?.runtime;
  if (snapshot.project.id !== target.projectId || snapshot.project.deletedAt || !snapshot.tasks[target.taskId] ||
      !rt?.runId || rt.projectId !== target.projectId || session.taskId !== target.taskId || rt.taskId !== target.taskId ||
      rt.workItemId !== target.itemId || session.agentId !== target.agentId || rt.purpose !== 'execution' ||
      session.dispatchPhase !== 'acknowledged') return '这份成果没有可核对的原执行记录';
  if (session.linkedAsHistory || rt.handedOffTo) return '这次执行已交接，请打开最新成果';
  const c = snapshot.collaboration, key = taskKey(target.taskId, target.itemId), task = c?.tasks[key];
  if (task?.archived || task?.status === 'cancelled') return '任务已归档或取消';
  if (target.artifactId) {
    const artifact = c?.artifacts.find(a => a.id === target.artifactId && a.key === key);
    const run = artifact?.runId && c?.runs[artifact.runId];
    if (!run || !artifact || run.key !== key || run.sessionId !== session.id || run.executor !== session.agentId ||
        rt.collaboration?.runId !== run.id || artifact.hash !== target.hash || target.roundId) return '这份成果没有可核对的原执行者';
    const current = c?.submissions.find(s => s.id === task?.latestSubmissionId);
    if (!task || current?.artifactId !== artifact.id || current.runId !== run.id || current.specRevision !== task.specRevision) return '已有新的成果或任务要求，请打开最新版本';
    if (task.activeRunId && task.activeRunId !== run.id && !['failed','cancelled','succeeded'].includes(c?.runs[task.activeRunId]?.status ?? '')) return '修改正在处理，请等待新成果';
    if (task.owner !== 'agent') return '这项任务已改由人工负责';
    if (rt.controlPending || ['queued','pending','running','waiting_permission'].includes(session.status)) return '原执行仍在处理，请等待这一轮结束';
  } else {
    const latest = session.rounds.at(-1);
    if (!latest || latest.id !== target.roundId || hashText(latest.reply) !== target.hash) return '回报已更新，请打开最新回复';
    if (rt.collaboration && c?.submissions.some(s => s.runId === rt.collaboration!.runId)) return '已有正式成果，请打开该成果回复';
    if (!['waiting_reply','paused','failed'].includes(session.status)) return '原会话当前不能接收回复';
  }
  if (rt.request || Object.keys(rt.requests ?? {}).length) return '请先到原会话处理 Agent 的待答问题';
}

export function resultReplyTarget(snapshot: Snapshot, taskId: string, entry: PresentedResult): {target?:ResultReplyTarget;reason?:string} {
  if (entry.record.origin === 'human') return {reason:'这份成果由人工提交'};
  const artifact = entry.artifactId ? snapshot.collaboration?.artifacts.find(a => a.id === entry.artifactId) : undefined;
  const run = artifact?.runId ? snapshot.collaboration?.runs[artifact.runId] : undefined;
  const sessionId = run?.sessionId ?? entry.sessionId;
  const session = sessionId ? snapshot.sessions[sessionId] : undefined;
  if (!session || entry.artifactId && !run || entry.sessionId && entry.sessionId !== session.id) return {reason:'这份成果没有可核对的原执行者'};
  const round = session.rounds.at(-1);
  const reference = artifact ? {artifactId:artifact.id,hash:artifact.hash} :
    round && (!entry.record.replyRoundId || entry.record.replyRoundId === round.id) && !entry.record.outputId && round.reply === entry.record.text && round.at === entry.record.at ?
      {roundId:round.id,hash:hashText(round.reply)} : undefined;
  if (!reference) return {reason:'请打开这次执行的最新回复'};
  const target:ResultReplyTarget = {projectId:snapshot.project.id,taskId,itemId:entry.record.itemId,
    sessionId:session.id,agentId:session.agentId,...reference};
  const reason = checkResultReply(snapshot, target);
  return reason ? {reason} : {target};
}
