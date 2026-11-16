import { useState } from 'react';
import { discussionSummary } from '../../data/discussionSnippets';
import { methodFor, workBranch, resultTime } from '../../data/results';
import { taskResultEntries } from '../../data/resultPresentation';
import { latestAttempt, WORK_LABEL } from '../../data/orchestration';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { AddSubtask } from '../outputs/OutputAssets';
import { TaskMap } from './TaskMap';
import { ResultDocument, ResultMarkdown } from './ResultDocument';
import './results.css';
import { ProgressIndicator, RunProgress } from '../journal/RunProgress';
import { executionProgress } from '../../data/executionProgress';
import './results-focus.css';

export function ResultsBoard() {
  const { snap, api, workspace: ws, openWorkspace, patchWorkspace, closeWorkspace, openAttemptSource, openSourceSession, toast } = useWorkdeck();
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  if (!ws) return null;
  const task = snap.tasks[ws.taskId];
  const orchestration = snap.orchestrations?.[ws.taskId];
  const selected = ws.selected ? orchestration?.items[ws.selected] ?? null : null;
  const method = methodFor(snap, ws.taskId, selected);
  const entries = taskResultEntries(snap, ws.taskId, selected?.id ?? null);
  const report = entries.find(entry => entry.record.id === selectedReport) ?? entries[0];
  const branch = orchestration ? workBranch(orchestration, selected?.id ?? null) : [];
  const progress = branch.filter(item => item.status !== 'done' && item.status !== 'cancelled');
  const sessions = !orchestration ? (task?.sessionIds ?? []).map(id => snap.sessions[id]).filter(session => session && session.status !== 'archived') : [];
  const analyze = async () => {
    if (!task || opening) return;
    setOpening(true);
    try { await api.ensureTaskPlan(task.id); if (selected) await api.openLocalPlan(task.id, selected.id); openWorkspace(task.id, { view: 'plan', itemId: selected?.id ?? null, scope: 'root', pane: 'side', focus: true }); }
    catch (error) { toast(error instanceof Error ? error.message : '打开分析失败', 'error'); }
    finally { setOpening(false); }
  };
  return <section className="qd-results qd-focused-results" aria-label="任务成果">
    <header className="qd-focused-head"><button type="button" className="qd-ws-back" onClick={closeWorkspace}><Icon name="chevron-left" size={16} />返回</button><div><p>任务成果</p><h1>{selected?.title ?? task?.title ?? '选择任务'}</h1></div>{task && <TaskOutputButton taskId={task.id} itemId={selected?.id} />}</header>
    <div className="qd-focused-content">
      {entries.length > 1 && <label className="qd-delivery-select">交付版本<select value={report?.record.id} onChange={event => setSelectedReport(event.target.value)}>{entries.map((entry, index) => <option key={entry.record.id} value={entry.record.id}>{index === 0 ? '最新 · ' : ''}{entry.record.title} · {entry.status} · {resultTime(entry.record.at)}</option>)}</select></label>}
      <div className={`qd-result-workspace ${!report ? 'is-awaiting' : ''}`}><div className="qd-result-primary">{report ? <ResultDocument key={report.record.id} entry={report} taskId={ws.taskId} /> : <div className="qd-delivery-empty qd-delivery-awaiting"><span className="qd-result-eyebrow">任务交付</span><h2>{progress.some(item => item.status === 'running') ? '正在完成你的任务' : '成果将在这里汇合'}</h2><p>每个子任务保留自己的交付，完成后汇总为完整成果。</p><button type="button" className="qd-btn primary" onClick={() => patchWorkspace({ view: 'tasks' })}>查看任务与执行<Icon name="arrow-right" size={14} /></button></div>}</div>
      <aside className="qd-result-context" aria-label="任务进展与来源">
        {(progress.length > 0 || sessions.length > 0) && <details open={!report}><summary>执行进展 <span>{progress.length + sessions.length}</span></summary><div className="qd-result-progress-list">{progress.map(item => { const attempt = latestAttempt(orchestration!, item); return <div key={item.id}><button type="button" className="qd-link" onClick={() => patchWorkspace({ selected: item.id })}>{item.title}</button><span>{WORK_LABEL[item.status]}</span>{attempt && <ProgressIndicator progress={executionProgress(item.status === 'running' ? 'running' : item.status === 'queued' ? 'queued' : 'paused', attempt.step)} agentName="Agent" color="var(--qd-brand)" compact />}{(item.waiting?.question || attempt?.step?.label) && <p>{discussionSummary(item.waiting?.question ?? attempt?.step?.label ?? '')}</p>}{attempt && <button type="button" className="qd-link" onClick={() => openAttemptSource(ws.taskId, attempt.id)}>打开会话<Icon name="external" size={12} /></button>}</div>; })}{sessions.map(session => <div key={session.id}><RunProgress session={session} compact /><p>{discussionSummary(session.waitingQuestion ?? session.step?.label ?? '等待回执')}</p><button type="button" className="qd-link" onClick={() => openSourceSession(session.id)}>打开会话<Icon name="external" size={12} /></button></div>)}</div></details>}
        <details open={!report}><summary>任务与子任务</summary><TaskMap snap={snap} taskId={ws.taskId} itemId={selected?.id ?? null} onSelect={(taskId, itemId) => openWorkspace(taskId, { view: 'results', selected: itemId, focus: true })} />{task && <AddSubtask taskId={task.id} parentId={selected?.id} />}</details>
        <details><summary>任务方法 <span>{method.version ? `v${method.version} · ${method.adopted ? '已采用' : '草稿'}` : '待整理'}</span></summary>
          {method.unavailableVersion ? <p>此任务引用的方法尚未同步。</p> : <>{method.conclusions.map(conclusion => <ResultMarkdown text={conclusion.summary} key={conclusion.id} />)}{method.doc?.sections.filter(section => section.lines.length).map(section => <section key={section.id} className="qd-result-method-section"><h3>{section.title}</h3><ul>{section.lines.map(line => <li key={line.id}>{line.text}{line.state !== 'fixed' && <small> · {line.state === 'open' ? '待确定' : '暂定'}</small>}</li>)}</ul></section>)}</>}
          {selected?.expected && <section className="qd-result-method-section"><h3>预期交付</h3><p>{selected.expected}</p></section>}
          {task && <button type="button" className="qd-link" disabled={opening} onClick={analyze}>{method.plan ? '编辑方法与讨论' : '整理任务方法'}<Icon name="arrow-right" size={14} /></button>}
        </details>
      </aside></div>
    </div>
  </section>;
}
