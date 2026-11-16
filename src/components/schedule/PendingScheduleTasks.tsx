import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { pendingScheduleTasks } from '../../data/dailySchedule';
import { TaskIcon } from '../ui/TaskIcon';
import { TaskScheduleButton } from './TaskScheduleButton';
import './schedule-editor.css';
import { TaskTitleSummaryButton } from '../journal/TaskTitleSummaryButton';

export function PendingScheduleTasks({ rows, date, compact = false, onLocate, onExpand, scopeLabel = '全部项目' }: {
  rows: ReturnType<typeof pendingScheduleTasks>; date: string; compact?: boolean;
  onLocate: (projectId: string, taskId: string) => void;
  onExpand?: () => void;
  scopeLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  if (!rows.length) return null;
  const limit = compact ? 3 : 6;
  const visible = expanded ? rows : rows.slice(0, limit);
  return <section className={`qd-pending-schedule${compact ? ' is-compact' : ''}`} aria-labelledby={headingId}>
    <header><h3 id={headingId}>待安排 <span>{rows.length}</span></h3><small>{scopeLabel}{compact ? '' : ' · 尚未设置时间'}</small></header>
    <ul>{visible.map(row => <li key={row.key}>
      <div className="qd-pending-task-copy">
        <span className="qd-daily-project" style={{ '--project-color': row.project.color ?? '#a94435' } as CSSProperties}>{row.project.name}</span>
        <button type="button" className="qd-pending-task-title qd-link" title={row.task.title} aria-label={`查看任务：${row.task.title}`} onClick={() => onLocate(row.project.id, row.task.id)}>
          <TaskIcon snapshot={row.snap} taskId={row.task.id} size={compact ? 16 : 18}/><span>{row.task.title}</span>
        </button>
        <small>{row.task.estimate ? `预计 ${row.task.estimate} 分钟` : '未设预计时长'}{row.partiallyScheduled ? ' · 部分子任务已安排' : ''}</small>
        <TaskTitleSummaryButton snapshot={row.snap} taskId={row.task.id}/>
      </div>
      <TaskScheduleButton compact={compact} taskId={row.task.id} projectId={row.project.id} date={date}/>
    </li>)}</ul>
    {rows.length > limit && <button type="button" className="qd-text-btn" onClick={() => onExpand ? onExpand() : setExpanded(value => !value)} aria-expanded={onExpand ? undefined : expanded}>
      {expanded ? '收起' : `查看全部 ${rows.length} 项`}
    </button>}
  </section>;
}
