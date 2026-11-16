import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { pendingScheduleTasks } from '../../data/dailySchedule';
import { TaskIcon } from '../ui/TaskIcon';
import { Icon } from '../ui/Icon';
import { TaskScheduleButton } from './TaskScheduleButton';
import './schedule-editor.css';
import './schedule-layout.css';

type PendingRow = ReturnType<typeof pendingScheduleTasks>[number];
export function PendingScheduleTasks({ rows, date, compact = false, onLocate, onExpand, scopeLabel = '全部项目' }: {
  rows: PendingRow[]; date: string; compact?: boolean;
  onLocate: (projectId: string, taskId: string) => void;
  onExpand?: () => void; scopeLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const headingId = useId();
  if (!rows.length) return null;
  const matching = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => !matching || `${row.project.name} ${row.task.title}`.toLocaleLowerCase().includes(matching));
  const groups = [...filtered.reduce((map, row) => { const group = map.get(row.project.id) ?? []; group.push(row); map.set(row.project.id, group); return map; }, new Map<string, PendingRow[]>()).values()];
  const visible = compact && !all ? groups.slice(0, 4) : groups;
  return <section className={`qd-pending-schedule qd-pending-grouped${compact ? ' is-compact' : ''}`} aria-labelledby={headingId}>
    <header><h3 id={headingId}>待安排 <span>{rows.length}</span></h3><small>{compact ? `${groups.length} 个项目` : scopeLabel}</small></header>
    {!compact && <label className="qd-pending-search"><Icon name="search" size={15}/><input aria-label="筛选待安排项目或任务" value={query} placeholder="查找项目或任务" onChange={event => setQuery(event.target.value)}/></label>}
    <div className="qd-pending-projects">{visible.map(group => {
      const { project } = group[0];
      const open = expanded[project.id] ?? !compact;
      const contentId = `${headingId}-${encodeURIComponent(project.id)}`;
      return <div className="qd-pending-project" key={project.id} style={{ '--project-color': project.color ?? '#a94435' } as CSSProperties}>
        <button type="button" className="qd-pending-project-toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setExpanded(current => ({ ...current, [project.id]: !open }))}>
          <span className="qd-pending-project-mark"><Icon name="folder" size={16}/></span><span className="qd-pending-project-name">{project.name}</span><small>{group.length} 项</small><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14}/>
        </button>
        {open && <ul id={contentId}>{group.map(row => <li key={row.key}>
          <div className="qd-pending-task-copy"><button type="button" className="qd-pending-task-title qd-link" title={row.task.title} aria-label={`查看任务：${row.task.title}`} onClick={() => onLocate(row.project.id, row.task.id)}><TaskIcon snapshot={row.snap} taskId={row.task.id} size={16}/><span>{row.task.title}</span></button><small>{row.task.estimate ? `预计 ${row.task.estimate} 分钟` : '时长待定'}{row.partiallyScheduled ? ' · 部分已安排' : ''}</small></div>
          <TaskScheduleButton compact taskId={row.task.id} projectId={project.id} date={date}/>
        </li>)}</ul>}
      </div>;
    })}</div>
    {!filtered.length && <p className="qd-pending-no-match" role="status">没有匹配的项目或任务。</p>}
    {compact && groups.length > 4 && <button type="button" className="qd-text-btn" onClick={() => setAll(value => !value)} aria-expanded={all}>{all ? '收起项目' : `查看其余 ${groups.length - 4} 个项目`}</button>}
    {compact && onExpand && <button type="button" className="qd-text-btn qd-pending-open" onClick={onExpand}>展开安排<Icon name="arrow-right" size={13}/></button>}
  </section>;
}
