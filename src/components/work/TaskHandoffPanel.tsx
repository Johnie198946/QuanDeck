import { useState } from 'react';
import { taskKey } from '../../data/collaboration';
import { deriveTaskHandoffs, getTaskHandoff, type TaskHandoffView } from '../../data/taskHandoff';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { TaskHandoffDialog } from './TaskHandoffDialog';
import './task-handoff.css';

const statusLabel: Record<string, string> = { draft: '等待执行', ready: '等待执行', running: '执行中', in_review: '待验收', done: '已验收', blocked: '等待条件', paused: '已暂停', failed: '执行失败', cancelled: '已取消' };
const reviewLabel = (view: TaskHandoffView) => view.stale ? '需要重新核对' : !view.current ? '历史版本' : view.reviewStatus === 'accepted' ? '已验收' : view.reviewStatus === 'needs_changes' ? '需要修改' : '候选总结';

/** Read-only projection of the ledger's fixed handoff records. */
export function TaskHandoffPanel({ taskId, workItemId }: { taskId: string; workItemId?: string }) {
  const { snap, openWorkspace, openSourceSession, agentOf } = useWorkdeck();
  const [creating, setCreating] = useState(false);
  const key = taskKey(taskId, workItemId), current = getTaskHandoff(snap, key);
  const transfers = snap.collaboration?.handoffTransfers ?? [];
  const incoming = transfers.filter(transfer => transfer.targetTaskKey === key);
  const outgoing = transfers.filter(transfer => transfer.sourceTaskKey === key);
  const records = deriveTaskHandoffs(snap, incoming.map(transfer => transfer.sourceTaskKey));
  const title = snap.collaboration?.tasks[key]?.title ?? snap.tasks[taskId]?.title ?? key;
  const taskState = snap.collaboration?.tasks[key];
  const completedRun = current?.record.runId ? snap.collaboration?.runs[current.record.runId] : undefined;
  const openTask = (targetKey: string) => {
    const task = snap.collaboration?.tasks[targetKey];
    if (task) openWorkspace(task.taskId, { view: 'tasks', selected: task.workItemId ?? null, focus: true, pane: task.workItemId ? 'side' : 'main' });
  };
  const taskName = (targetKey: string) => snap.collaboration?.tasks[targetKey]?.title ?? targetKey;
  return <section className="qd-task-handoff" aria-label="任务记忆与交接">
    <header><strong>任务记忆与交接</strong><span>{current ? reviewLabel(current) : '尚未交付'}</span></header>
    {incoming.map(transfer => {
      const source = records.find(view => view.record.id === transfer.sourceHandoffId);
      return <details className="qd-handoff-incoming" key={transfer.id}><summary>接收自 <span>{taskName(transfer.sourceTaskKey)}</span></summary>
        <p>接手状态：{taskState ? statusLabel[taskState.status] ?? taskState.status : '等待执行'}</p>
        <p>{source?.record.content.summary ?? '已固定来源记录，可打开来源任务核对。'}</p>
        {source && <HandoffContent view={source} />}
        <dl className="qd-handoff-provenance"><div><dt>固定交接</dt><dd>{transfer.sourceHandoffId}</dd></div><div><dt>交接指纹</dt><dd>{transfer.sourceHandoffHash}</dd></div><div><dt>来源验收</dt><dd>{transfer.sourceReviewId}</dd></div></dl>
        <button type="button" className="qd-link" onClick={() => openTask(transfer.sourceTaskKey)}>查看来源任务</button>
      </details>;
    })}
    {current ? <>
      <p className="qd-handoff-summary">{current.record.content.summary}</p>
      <details><summary>总结与下一步</summary><HandoffContent view={current} />
        <dl className="qd-handoff-provenance"><div><dt>来源</dt><dd>{current.origin === 'legacy-derived' ? '历史交付生成的视图' : current.record.contentOrigin === 'provided' ? '提交内容，由系统记录' : '由系统从交付记录生成'}</dd></div><div><dt>交付者</dt><dd>{completedRun ? agentOf(completedRun.executor).name : current.record.actor === 'human' ? '我' : current.record.actor}</dd></div><div><dt>任务要求</dt><dd>v{current.record.specRevision}</dd></div><div><dt>项目规范</dt><dd>{current.record.projectSpec ? `v${current.record.projectSpec.version}` : '本次未固定项目规范'}</dd></div><div><dt>来源成果</dt><dd>{current.record.artifactId}</dd></div><div><dt>交接指纹</dt><dd>{current.record.hash}</dd></div></dl>
        {completedRun?.sessionId && <button type="button" className="qd-link" onClick={() => openSourceSession(completedRun.sessionId!)}>打开来源会话</button>}
      </details>
      {current.reviewStatus === 'accepted' && current.current && !current.stale ? <button type="button" className="qd-link qd-handoff-create" onClick={() => setCreating(true)}>交给新任务 →</button> : <p className="qd-handoff-boundary">当前记录核对通过后，才能交给新任务执行。</p>}
    </> : <p className="qd-handoff-boundary">交付后会在这里保留总结、待办和下一步；接手任务会引用固定版本。</p>}
    {!!outgoing.length && <div className="qd-handoff-successors"><strong>后续接手</strong><ul>{outgoing.map(transfer => {
      const task = snap.collaboration?.tasks[transfer.targetTaskKey];
      const run = task?.activeRunId ? snap.collaboration?.runs[task.activeRunId] : undefined;
      return <li key={transfer.id}><button type="button" className="qd-link" onClick={() => openTask(transfer.targetTaskKey)}>{taskName(transfer.targetTaskKey)}</button><span>{task ? statusLabel[task.status] ?? task.status : '任务待核对'}{run ? ` · ${agentOf(run.executor).name}` : ''}</span></li>;
    })}</ul></div>}
    {creating && <TaskHandoffDialog sourceTaskKey={key} sourceTitle={title} onClose={() => setCreating(false)} />}
  </section>;
}

function HandoffContent({ view }: { view: TaskHandoffView }) {
  const content = view.record.content;
  return <dl className="qd-handoff-content">{([['已完成', content.completed], ['工作决定', content.decisions], ['待完成', content.remaining], ['下一步', content.nextSteps]] as const).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values.length ? <ul>{values.map((text, index) => <li key={index}>{text}</li>)}</ul> : <span>未记录</span>}</dd></div>)}</dl>;
}
