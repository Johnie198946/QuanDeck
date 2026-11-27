import { useMemo, useState } from 'react';
import { flattenOverview, overviewProject } from '../../data/overviewTree';
import { dateDay, dayText, ganttColumns, planningTask } from '../../data/projectPlanning';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';
import { HomeBoard, type BoardProps } from './HomeBoard';
import { HomeProjectBrief } from './HomeProjectBrief';
import './home-sections.css';

interface Props extends BoardProps {
  onCreateProject: () => void;
  onOpenMonitor: (id: string) => void;
}

const shortDate = (day: number) => dayText(day).slice(5).replace('-', '/');
const localDate = () => new Date().toLocaleDateString('sv-SE');
interface Range { start: number; end: number }

function projectSchedule(snapshot: Snapshot) {
  const project = overviewProject(snapshot);
  const deadline = dateDay(snapshot.project.deadline);
  const tasks = flattenOverview(project.children).flatMap(node => {
    if (!node.taskId || node.bucket === 'cancelled') return [];
    const {start, end} = planningTask(snapshot, node.taskId, node.itemId);
    const a = dateDay(start), b = dateDay(end);
    if (a === undefined && b === undefined) return [];
    return [{ title:node.title, start:a, end:b }];
  });
  const intervals = tasks.flatMap(({start, end}) => start !== undefined && end !== undefined && end >= start ? [{start,end}] : []);
  intervals.sort((a,b) => a.start - b.start);
  const ranges: Range[] = [];
  for (const span of intervals) {
    const last = ranges.at(-1);
    if (last && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
    else ranges.push({...span});
  }
  const points = [...new Set(tasks.flatMap(({start,end}) => start === undefined ? [end!] : end === undefined ? [start] : []))];
  return {id:project.projectId, title:project.title, progress:project.progress, tasks, ranges, points, deadline};
}

type ProjectRow = ReturnType<typeof projectSchedule>;
function ScheduleMarks({row, first, end}: {row: ProjectRow; first: number; end: number}) {
  const toPercent = (day: number) => 100 * (day-first) / (end-first);
  const ranges = row.ranges.filter(span => span.end >= first && span.start < end);
  const points = row.points.filter(day => day >= first && day < end && day !== row.deadline);
  const deadline = row.deadline !== undefined && row.deadline >= first && row.deadline < end ? row.deadline : undefined;
  const label = ranges.map(span => shortDate(span.start)+' 至 '+ shortDate(span.end))
    .concat(points.map(shortDate), deadline === undefined ? [] : ['项目截止 '+shortDate(deadline)]).join('，');
  return <span className="qhp-track" title={label || '此时段没有排期'} aria-label={label || '此时段没有排期'}>
    <span className="qhp-gridlines" aria-hidden="true">{[0,1,2,3,4,5].map(week=><i key={week}/>)}</span>
    {ranges.map(({start, end:last}) => {
      const left = Math.max(first,start), right = Math.min(end,last+1);
      return <i className="qhp-span" key={start} style={{left:toPercent(left)+'%',width:(100*(right-left)/(end-first))+'%'}}/>;
    })}
    {points.map(day => <i className="qhp-point" key={day} style={{left:toPercent(day+.5)+'%'}}/>)}
    {deadline !== undefined && <i className="qhp-deadline" style={{left:toPercent(deadline+.5)+'%'}}/>}
    {!label && <small>{row.tasks.length || row.deadline !== undefined ? '本期无安排' : '未排期'}</small>}
  </span>;
}

export function HomeProjects(props: Props) {
  const {projects,onOpenProject,onCreateProject,expanded=false,today}=props;
  const [mode, setMode] = useState<'brief'|'board'|'list'|'gantt'>('brief');
  const [period, setPeriod] = useState(0);
  const current = dateDay(today) ?? dateDay(localDate())!;
  const rows = useMemo(() => mode === 'list' || mode === 'gantt' ? projects.map(projectSchedule) : [], [projects,mode]);
  const allColumns = ganttColumns(current, 'week', period);
  const first = allColumns[0].start, end = allColumns[allColumns.length-1].end;
  const week = ganttColumns(current,'week')[0];
  const visible = expanded ? rows : rows.slice(0,3);
  return <div className={'qhp-projects '+(mode === 'gantt' ? 'qhp-with-chart' : '')}>
    <div className="qhp-controls">
      <div className="qhp-view-mode" role="group" aria-label="项目视图">
        <button type="button" aria-pressed={mode==='brief'} onClick={()=>setMode('brief')}>项目简报</button>
        <button type="button" aria-pressed={mode==='board'} onClick={()=>setMode('board')}>任务看板</button>
        <button type="button" aria-pressed={mode==='list'} onClick={()=>setMode('list')}>列表</button>
        <button type="button" aria-pressed={mode==='gantt'} onClick={()=>setMode('gantt')}>甘特图</button>
      </div>
      {mode === 'gantt' && <div className="qhp-period">
        <button type="button" aria-label="上一时段" onClick={()=>setPeriod(period-1)}><Icon name="chevron-left" size={14}/></button>
        <span aria-live="polite">{shortDate(first)} – {shortDate(end-1)}</span>
        <button type="button" aria-label="下一时段" onClick={()=>setPeriod(period+1)}><Icon name="chevron-right" size={14}/></button>
      </div>}
    </div>
    {mode === 'brief' ? <HomeProjectBrief {...props}/> : mode === 'board' ? <HomeBoard {...props}/> : !rows.length ? <div className="qhd-empty"><Icon name="folder" size={18}/><span>还没有项目</span>
    <button className="qhd-open" type="button" onClick={onCreateProject}><Icon name="plus" size={13}/>新建项目</button></div> : <div className="qhp-sheet">
      <div className="qhp-row qhp-headrow" aria-hidden="true">
        <div className="qhp-fields"><span>项目</span><span>进度</span><span>截止时间</span><span>本周安排</span></div>
        {mode === 'gantt' && <div className="qhp-axis">{allColumns.map(col=><span key={col.start}>{shortDate(col.start)}</span>)}</div>}
      </div>
      {visible.map(row => {
        const progress = row.progress;
        const percent = progress ? Math.round(progress.done/progress.total*100) : undefined;
        const agenda = row.tasks.filter(task => (task.start ?? task.end!) < week.end && (task.end ?? task.start!) >= week.start);
        return <button className="qhp-row qhp-project" key={row.id} type="button" onClick={()=>onOpenProject(row.id)} aria-label={'打开项目 '+row.title}>
          <span className="qhp-fields">
            <strong title={row.title}>{row.title}</strong>
            <span className="qhp-percent" title={progress ? progress.done+' / '+progress.total+' 项主任务已完成' : '尚无任务'}>
              {progress && <progress value={progress.done} max={progress.total} aria-label={row.title+'主任务进度'}/>}
              {percent === undefined ? '—' : percent+'%'}
            </span>
            <span>{row.deadline === undefined ? '待确定' : shortDate(row.deadline)}</span>
            <span className="qhp-agenda" title={agenda.map(task=>task.title).join('、')}>{agenda.length ? agenda.map(task=>task.title).join('、') : '—'}</span>
          </span>
          {mode === 'gantt' && <ScheduleMarks row={row} first={first} end={end}/>}
        </button>;
      })}
    </div>}
  </div>;
}
