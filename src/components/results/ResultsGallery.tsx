import { useState } from 'react';
import { taskOverviewRows, resultTime } from '../../data/results';
import { taskResultEntries, resultExcerpt } from '../../data/resultPresentation';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { EditOutputButton } from '../outputs/OutputAssets';
import { Icon } from '../ui/Icon';
import { TaskIcon } from '../ui/TaskIcon';
import { ResultsIntegration } from './ResultsIntegration';
import { TaskMemoryLookup } from './TaskMemoryLookup';
import { ResultDocument } from './ResultDocument';
import './results-gallery.css';
import './results-focus.css';

type Filter = 'all' | 'review' | 'confirmed';

export function ResultsGallery({ onNew }: { onNew?: () => void }) {
  const { snap, openWorkspace } = useWorkdeck();
  const [section, setSection] = useState<'tasks' | 'integrated'>('tasks');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const rows = taskOverviewRows(snap).map(row => ({ ...row, entries: taskResultEntries(snap, row.task.id, null) }));
  const visible = rows.map(row => ({ ...row, entries: row.entries.filter(entry => filter === 'all' || (filter === 'confirmed' ? entry.status === '已确认' : entry.status.includes('核对'))) })).filter(row => filter === 'all' || row.entries.length > 0);
  const active = visible.find(row => row.task.id === selectedTask) ?? visible.find(row => row.entries.length > 0) ?? visible[0];
  const entries = active?.entries ?? [];
  const report = entries.find(entry => entry.record.id === selectedReport) ?? entries[0];
  const drafts = Object.values(snap.outputs ?? {}).filter(output => output.status === 'draft');
  const openTask = (itemId: string | null = null) => active && openWorkspace(active.task.id, { view: 'results', selected: itemId, focus: true });
  return <main className="qd-gallery qd-results-library" aria-labelledby="gallery-title"><div className="qd-gallery-inner">
    <header className="qd-gallery-head"><div><p>{snap.project.name}</p><h1 id="gallery-title">成果</h1></div><details className="qd-result-search"><summary><Icon name="search" size={15} />查找历史</summary><TaskMemoryLookup key={snap.project.id} /></details></header>
    <nav className="qd-results-sections" aria-label="成果内容"><button type="button" aria-pressed={section === 'tasks'} onClick={() => setSection('tasks')}>任务交付</button><button type="button" aria-pressed={section === 'integrated'} onClick={() => setSection('integrated')}><Icon name="merge" size={14} />完整成果</button></nav>
    <div hidden={section !== 'integrated'}><ResultsIntegration key={snap.project.id} /></div>
    <div className="qd-library-content" hidden={section !== 'tasks'}>
      <nav className="qd-library-filters" aria-label="筛选成果">{([['all', '全部'], ['review', '待核对'], ['confirmed', '已确认']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setSelectedReport(null); }}>{label}</button>)}</nav>
      {drafts.length > 0 && <details className="qd-output-drafts"><summary>未提交的草稿 · {drafts.length}</summary>{drafts.map(output => <div key={output.id}><span>{output.title}</span><EditOutputButton outputId={output.id} /></div>)}</details>}
      {active ? <div className="qd-library-layout">
        <nav className="qd-library-index" aria-label="选择任务成果">{visible.map(row => { const latest = row.entries[0]; return <button type="button" key={row.task.id} aria-current={row.task.id === active.task.id ? 'true' : undefined} onClick={() => { setSelectedTask(row.task.id); setSelectedReport(null); }}>
          <span className="qd-library-task-title"><TaskIcon snapshot={snap} taskId={row.task.id} size={18} /><strong>{row.task.title}</strong></span>
          <span className="qd-library-task-status">{latest?.status ?? (row.running ? '正在执行' : '等待交付')}{row.entries.length > 1 ? ` · ${row.entries.length} 份` : ''}</span>
          {latest && <span className="qd-library-excerpt">{resultExcerpt(latest.record.text, 80)}</span>}
        </button>; })}</nav>
        <section className="qd-library-reader" aria-label={active.task.title}>
          <div className="qd-library-reader-bar"><span>{active.task.title}</span><TaskOutputButton taskId={active.task.id} /></div>
          {entries.length > 1 && <label className="qd-delivery-select">交付版本<select value={report?.record.id} onChange={event => setSelectedReport(event.target.value)}>{entries.map((entry, index) => <option key={entry.record.id} value={entry.record.id}>{index === 0 ? '最新 · ' : ''}{entry.record.title} · {entry.status} · {resultTime(entry.record.at)}</option>)}</select></label>}
          {report ? <ResultDocument key={report.record.id} entry={report} taskId={active.task.id} onTask={() => openTask(report.record.itemId ?? null)} /> : <div className="qd-delivery-empty"><Icon name="folder" size={28} /><h2>{active.running ? '正在准备交付' : '等待第一份成果'}</h2><p>文字、文件和 Agent 的交付会汇集在这里。</p><button type="button" className="qd-link" onClick={() => openTask()}>查看任务<Icon name="arrow-right" size={14} /></button></div>}
        </section>
      </div> : <div className="qd-delivery-empty"><Icon name="folder" size={28} /><h2>{rows.length ? '还没有这类成果' : '从第一件事开始'}</h2><p>{rows.length ? '切换到全部，查看其他任务。' : '记录任务，成果会汇集在这里。'}</p>{rows.length ? <button type="button" className="qd-btn ghost" onClick={() => setFilter('all')}>查看全部</button> : onNew && <button type="button" className="qd-btn primary" onClick={onNew}>记录任务</button>}</div>}
    </div>
  </div></main>;
}
