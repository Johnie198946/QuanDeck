import { useState } from 'react';
import { ActivityReply } from './ActivityReply';
import { discussionPlan } from '../../data/projectReminders';
import { executionProgress, executionStage } from '../../data/executionProgress';
import { ProgressIndicator } from '../journal/RunProgress';
import { TaskIcon } from '../ui/TaskIcon';
import type { ProjectActivityEntry } from '../../data/projectActivity';
import { discussionSummary } from '../../data/discussionSnippets';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

export function ProjectActivityRow({ entry, compact = false }: { entry: ProjectActivityEntry; compact?: boolean }) {
  const { snap, agentOf, selectWork, openWorkspace, openAttemptSource, openSourceSession } = useWorkdeck();
  const [expanded, setExpanded] = useState(false);
  const session = entry.sessionId ? snap.sessions[entry.sessionId] : undefined;
  const changedPlan = entry.state === 'failed' && session && session.runtime?.submissionIssue?.code === 'DISCUSSION_CONTEXT_STALE'
    ? discussionPlan(snap,session) : undefined;
  const open = () => {
    if (changedPlan) {
      openWorkspace(changedPlan.scope === 'project' ? '' : changedPlan.taskId, {view:'plan',projectId:snap.project.id,planId:changedPlan.id,itemId:changedPlan.itemId ?? null,focus:true});
      return;
    }
    if (entry.taskId && entry.attemptId) openAttemptSource(entry.taskId, entry.attemptId);
    else if (entry.sessionId) openSourceSession(entry.sessionId);
    else if (entry.taskId) openWorkspace(entry.taskId, { view: 'tasks', selected: entry.itemId || null });
  };
  const detail = entry.detail ? discussionSummary(entry.detail).replace(/\s+/g, ' ').trim() : '';
  const toolDetail = !!detail && executionStage(detail) === '正在运行任务工具';
  const agent = agentOf(entry.agentId || '');
  const preview = detail.length > 100 ? detail.slice(0, 100) + '…' : detail;
  const parentTitle = entry.itemId && entry.taskId ? snap.tasks[entry.taskId]?.title : undefined;
  const actionLabel = changedPlan ? '查看最新方案' : entry.state === 'waiting_reply' ? '回复' : entry.state === 'waiting_permission' ? '查看授权' : entry.state === 'failed' ? '处理问题' : '查看会话';
  const waiting = entry.state === 'waiting_reply' || entry.state === 'waiting_permission';
  const inline = waiting && session?.runtime?.runId ? <ActivityReply key={[
    session.runtime.runId, session.runtime.finalReplyId,
    session.runtime.request || Object.keys(session.runtime.requests ?? {}).length ? 'requests' : 'turn'
  ].join('|')} session={session} onOpen={open} /> : undefined;
  if (compact) return <div className="qd-task-attention-line">
    <span>{changedPlan?.title || entry.title}</span>
    <button type="button" className="qd-link" aria-expanded={inline ? expanded : undefined} aria-label={`${actionLabel}：${entry.title}`} onClick={() => inline ? setExpanded(!expanded) : open()}>{expanded && inline ? '收起' : actionLabel}<Icon name={inline ? "chevron-down" : "arrow-right"} size={14}/></button>
    {expanded && inline}
  </div>;
  return <article className={`qd-activity-brief state-${entry.state}`}>
    {parentTitle && <p className="qd-activity-parent" title={parentTitle}>所属任务 · {parentTitle}</p>}
    <header><button type="button" className="qd-activity-title" onClick={() => !changedPlan && entry.taskId ? selectWork(entry.taskId, entry.itemId || null) : open()}><TaskIcon snapshot={snap} taskId={entry.taskId} workItemId={entry.itemId} sessionId={entry.parentSessionId || entry.sessionId} subAgentId={entry.subAgentId} size={16}/><span>{changedPlan?.title || entry.title}</span></button></header>
    <div className="qd-activity-status"><small>{agent.name}</small></div>
    {changedPlan ? <p>上次意见未写入当前草稿，请核对最新方案。</p> : !inline && <ProgressIndicator progress={executionProgress(entry.state, entry.step, entry.percent)} agentName={agent.name} color={agent.color} compact/>}
    {!inline && !changedPlan && preview && !toolDetail && preview !== entry.step?.label && <p>{preview}</p>}
    {toolDetail && <details className="qd-activity-detail"><summary>查看执行细节</summary><p>{entry.detail}</p></details>}
    {inline}
    <button type="button" className={`qd-activity-action ${!inline && (waiting || changedPlan) ? 'is-primary' : ''}`} aria-label={`${inline ? '查看完整会话' : actionLabel}：${entry.title}`} onClick={open}>{inline ? '查看完整会话' : actionLabel}<Icon name="arrow-right" size={13}/></button>
  </article>;
}
