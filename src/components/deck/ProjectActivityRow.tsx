import { executionProgress, executionStage } from '../../data/executionProgress';
import { ProgressIndicator } from '../journal/RunProgress';
import { TaskIcon } from '../ui/TaskIcon';
import type { ProjectActivityEntry } from '../../data/projectActivity';
import { discussionSummary } from '../../data/discussionSnippets';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

export function ProjectActivityRow({ entry }: { entry: ProjectActivityEntry }) {
  const { snap, agentOf, selectWork, openWorkspace, openAttemptSource, openSourceSession } = useWorkdeck();
  const open = () => {
    if (entry.taskId && entry.attemptId) openAttemptSource(entry.taskId, entry.attemptId);
    else if (entry.sessionId) openSourceSession(entry.sessionId);
    else if (entry.taskId) openWorkspace(entry.taskId, { view: 'tasks', selected: entry.itemId || null });
  };
  const detail = entry.detail ? discussionSummary(entry.detail).replace(/\s+/g, ' ').trim() : '';
  const toolDetail = !!detail && executionStage(detail) === '正在运行任务工具';
  const agent = agentOf(entry.agentId || '');
  const preview = detail.length > 100 ? detail.slice(0, 100) + '…' : detail;
  const parentTitle = entry.itemId && entry.taskId ? snap.tasks[entry.taskId]?.title : undefined;
  const actionLabel = entry.state === 'waiting_reply' ? '回复' : entry.state === 'waiting_permission' ? '查看授权' : entry.state === 'failed' ? '处理问题' : '查看会话';
  const waiting = entry.state === 'waiting_reply' || entry.state === 'waiting_permission';
  return <article className={`qd-activity-brief state-${entry.state}`}>
    {parentTitle && <p className="qd-activity-parent" title={parentTitle}>所属任务 · {parentTitle}</p>}
    <header><button type="button" className="qd-activity-title" onClick={() => entry.taskId ? selectWork(entry.taskId, entry.itemId || null) : open()}><TaskIcon snapshot={snap} taskId={entry.taskId} workItemId={entry.itemId} sessionId={entry.parentSessionId || entry.sessionId} subAgentId={entry.subAgentId} size={16}/><span>{entry.title}</span></button></header>
    <div className="qd-activity-status"><small>{agent.name}</small></div>
    <ProgressIndicator progress={executionProgress(entry.state, entry.step, entry.percent)} agentName={agent.name} color={agent.color} compact/>
    {preview && !toolDetail && preview !== entry.step?.label && <p>{preview}</p>}
    {toolDetail && <details className="qd-activity-detail"><summary>查看执行细节</summary><p>{entry.detail}</p></details>}
    <button type="button" className={`qd-activity-action ${waiting ? 'is-primary' : ''}`} aria-label={`${actionLabel}：${entry.title}`} onClick={open}>{actionLabel}<Icon name="arrow-right" size={13}/></button>
  </article>;
}
