import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AgendaEntry } from '../../data/agendaSchedule';
import { dateDay, dayText, ganttColumns, planningTask, type PlannedTask } from '../../data/projectPlanning';
import { DayAxisHeader, DayTrack, GanttBand, ganttDayAxis } from './HomeGanttDay';
import { scheduleOccurrence } from '../../data/scheduleOccurrence';
import { dateInZone, dayBounds, timeInZone } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';
import './home-gantt.css';
import type { BoardProps } from './HomeBoard';
import { agendaDisplayAt, boardStates, cardSource, type BoardCard } from './homeBoardData';

const shortDate = (day: number) => dayText(day).slice(5).replace('-', '/');
type Timing = { first?: number; last?: number; milestone?: boolean };
type Row = {
  card: BoardCard;
  key: string;
  title: string;
  itemId?: string;
  nested?: boolean;
  state: BoardCard['state'];
  appointment?: AgendaEntry;
  planned: Timing;
  occurrence?: ReturnType<typeof scheduleOccurrence>;
};

function chartSlot(entry: AgendaEntry, today: string, zone: string, occurrence?: Row['occurrence']) {
  const [startOfToday] = dayBounds(today,zone);
  const completed = Date.parse(entry.completedAt ?? '');
  const showCompletion = entry.done && Number.isFinite(completed) &&
    (!entry.end || occurrence && dateInZone(entry.at,zone) !== dateInZone(completed,zone)) &&
    (!occurrence || dateInZone(occurrence.at,zone) === dateInZone(completed,zone));
  if (showCompletion) return {at:completed, until:undefined, closed:true};
  if (occurrence) return {at:occurrence.at, until:occurrence.until, closed:false};
  // The original overnight booking is still in progress on its second date.
  const at = entry.at < startOfToday && entry.end !== undefined && entry.end > startOfToday
    ? entry.at : agendaDisplayAt(entry,today,zone);
  return {at, until:entry.end !== undefined ? at + entry.end - entry.at : undefined, closed:false};
}

function chartRows(cards: BoardCard[], project: Snapshot | undefined) {
  const itemOf = new Map(project?.plans.map(plan => [plan.id, plan.workItemId]));
  const rows: Row[] = [];
  function append(card: BoardCard, key: string, title: string, state: Row['state'], plan: PlannedTask,
    scheduled: AgendaEntry[], itemId?: string) {
    const timing = { first:dateDay(plan.start), last:dateDay(plan.end), milestone:plan.milestone };
    const row = { card, key, title, state, itemId, nested:!!itemId, planned:timing };
    if (scheduled.length === 1) {
      const entry = scheduled[0];
      rows.push({...row, state:entry.done ? 'done' : state === 'done' ? 'pending' : state, appointment:entry});
    } else {
      rows.push(row);
      for (const entry of scheduled) rows.push({...row, key:entry.key, title:entry.title, nested:true,
        state:entry.done ? 'done' : entry.progress?.length ? 'running' : 'pending',
        appointment:entry, planned:{}});
    }
  }
  for (const card of cards) {
    const itemIds = new Set(card.steps.map(step => step.id));
    const slots = card.schedule ?? [];
    const byStep = new Map<string, AgendaEntry[]>();
    const main: AgendaEntry[] = [];
    for (const entry of slots) {
      const item = 'planId' in entry ? itemOf.get(entry.planId) : undefined;
      if (item && itemIds.has(item)) {
        const group = byStep.get(item) ?? [];
        group.push(entry);
        byStep.set(item, group);
      } else main.push(entry);
    }
    append(card,card.key,card.title,card.state,project && card.taskId ? planningTask(project,card.taskId) : {},main);
    for (const step of card.steps) {
      if (!project || !card.taskId) continue;
      append(card,JSON.stringify([card.key,step.id]),step.title,step.bucket ?? card.state,
        planningTask(project,card.taskId,step.id),byStep.get(step.id) ?? [],step.id);
    }
  }
  return rows;
}

export function HomeProjectGantt({projects, notes, cards, today, onOpenBoardTask, onOpenProject, onOpenSchedule, onOpenNote}: BoardProps & {cards:BoardCard[]}) {
  const [offset,setOffset] = useState(0);
  const [scale,setScale] = useState<'day'|'week'|'sixWeeks'>('day');
  const [statusFilter,setStatusFilter] = useState('all');
  const [closed,setClosed] = useState<string[]>([]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = today ?? dateInZone(Date.now(),zone);
  const day = dateDay(date)!;
  const selectedDay = day + offset;
  const selectedDate = dayText(selectedDay);
  const daily = scale === 'day';
  const dayAxis = useMemo(() => ganttDayAxis(selectedDate,zone), [selectedDate,zone]);
  const now = Date.now();
  const monday = ganttColumns(day,'week')[0].start;
  const columns = scale === 'week'
    ? ganttColumns(monday + offset*7,'day').slice(0,7)
    : ganttColumns(day-7,'week',offset);
  const first = columns[0].start, last = columns.at(-1)!.end;
  const position = (v: number) => (v-first)/(last-first)*100;
  // Only the creation time of the individual to-do can anchor its available window.
  const availableSince = useMemo(() => {
    const starts = new Map<string, number>();
    for (const note of notes) for (const todo of note.todos ?? []) {
      const at = Date.parse(todo.createdAt);
      if (Number.isFinite(at)) starts.set('note:'+note.id+':'+todo.id,at);
    }
    return starts;
  }, [notes]);
  const groups = useMemo(() => {
    const grouped = new Map<string | undefined,BoardCard[]>();
    for (const card of cards) {
      const list = grouped.get(card.projectId) ?? [];
      list.push(card);
      grouped.set(card.projectId,list);
    }
    const group = (snapshot?: Snapshot) => {
      const project = snapshot?.project;
      const list = grouped.get(project?.id) ?? [];
      return { key:JSON.stringify(project?.id ?? null), title:project?.name ?? '个人日程', project,
        rows:chartRows(list,snapshot) };
    };
    return [...(grouped.has(undefined) ? [group()] : []), ...projects.filter(p=>!p.project.deletedAt).map(group)];
  }, [cards,projects]);
  const visibleGroups = useMemo(() => groups.flatMap(group => {
    let rows = group.rows;
    if (daily) {
      rows = rows.flatMap((row): Row[] => {
        const entry = row.appointment;
        const occurrence = entry && scheduleOccurrence(entry, selectedDate, date, zone);
        if (occurrence) return [{...row, occurrence}];
        const {first,last,milestone} = row.planned;
        const to = last ?? first, from = milestone ? to : first ?? last;
        return from !== undefined && to !== undefined && from <= selectedDay && selectedDay <= to
          ? [{...row,appointment:undefined}] : [];
      }).sort((a,b) => (a.occurrence?.at ?? Infinity) - (b.occurrence?.at ?? Infinity));
    }
    const completed = rows.filter(row => row.state === 'done').length;
    const count = rows.length;
    if (statusFilter !== 'all') rows = rows.filter(row => (row.state === 'done') === (statusFilter === 'done'));
    if (!rows.length && (daily || statusFilter !== 'all')) return [];
    return [{...group,rows,count,completed}];
  }), [groups,daily,selectedDate,selectedDay,date,zone,statusFilter]);
  const scrollRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const region = scrollRegion.current;
    if (!daily || !region) return;
    const header = region.querySelector<HTMLElement>('.qht-day-header');
    if (!header) return;
    const center = () => {
      if (region.scrollWidth <= region.clientWidth) return;
      const firstEvent = visibleGroups.flatMap(group => group.rows)
        .find(row => row.occurrence)?.occurrence?.at;
      const focus = selectedDate === date ? Date.now() : firstEvent ?? dayAxis.start;
      const labelWidth = header.previousElementSibling?.getBoundingClientRect().width ?? 0;
      region.scrollLeft = header.offsetWidth * dayAxis.position(focus)/100 - (region.clientWidth-labelWidth)/2;
    };
    const observer = new ResizeObserver(center);
    observer.observe(region);
    return () => observer.disconnect();
  }, [daily, dayAxis, selectedDate, date, visibleGroups]);
  const inRange = first <= day && day < last;
  const todayLine = () => inRange && <i aria-hidden="true" className="qhg-today" style={{left:position(day+0.5)+'%'}}/>;
  function instantColumn(at: number) {
    const date = dateInZone(at,zone);
    const [from,to] = dayBounds(date,zone);
    return dateDay(date)! + (at-from)/(to-from);
  }

  function weekTrack(plan: Timing, state: Row['state'], fallback: string, appointment?: AgendaEntry, onOpen?: () => void) {
    const from = plan.first ?? plan.last, to = plan.last ?? plan.first;
    const hasPlan = from !== undefined && to !== undefined;
    const planStart = plan.milestone ? to : from;
    const planVisible = planStart !== undefined && to !== undefined && planStart < last && to >= first;
    const label = hasPlan ? shortDate(from)+(from!==to ? ' – '+shortDate(to) : '') : '';
    const planType = plan.milestone ? '里程碑' : plan.first === undefined ? '截止日' : plan.last === undefined ? '开始日' : '计划';
    const slot = appointment && chartSlot(appointment,date,zone);
    const at = slot?.at;
    const hasSpan = !!slot && slot.until !== undefined && slot.until > slot.at;
    const available = appointment && availableSince.get(appointment.key);
    const hasWindow = at !== undefined && !hasSpan && available !== undefined && available < at;
    const slotStart = hasWindow ? available : at;
    const slotEnd = slot?.until ?? at;
    const a = slotStart !== undefined ? instantColumn(slotStart) : undefined;
    const b = slotEnd !== undefined ? instantColumn(slotEnd) : undefined;
    const slotVisible = a !== undefined && b !== undefined && a < last && (b>first || a===b && b===first);
    const stamp = (t: number) => dateInZone(t,zone).slice(5).replace('-','/')+' '+timeInZone(t,zone);
    const slotLabel = at === undefined ? '' : hasSpan
      ? timeInZone(at,zone)+' – '+timeInZone(slotEnd!,zone) : (slot?.closed ? '完成 ' : '截止 ')+timeInZone(at,zone);
    return <span className="qhg-track qgt-period" data-stack={planVisible && slotVisible || undefined}>
      {todayLine()}
      {planVisible && <span className="qgt-lane"><GanttBand type={planType==='计划'?'planned':'calendar'}
        left={position(planStart)} right={position(to+1)} state={state} text={planType+' '+label}
        description={planType+' '+label+'（按日期排定）'} onOpen={onOpen}/></span>}
      {slotVisible && at !== undefined && appointment && <span className="qgt-lane"><GanttBand
        type={hasSpan?'planned':hasWindow?'window':'deadline'} left={position(a)} right={position(b)} state={state} text={slotLabel}
        action={'打开日程 '+appointment.title+' '+timeInZone(at,zone)}
        description={appointment.title+' · '+(hasSpan?'已排时段':hasWindow?'可办窗口':'仅截止')+' · '+stamp(slotStart!)+(slotStart!==slotEnd?' – '+stamp(slotEnd!):'')}
        onOpen={()=>onOpenSchedule?.(appointment.key,at)}/></span>}
      {!planVisible && !slotVisible && (hasPlan || appointment || fallback.trim()) && <small>{hasPlan || appointment ? '本期外 · '+(label || stamp(at!)) : fallback}</small>}
    </span>;
  }
  return <div className="qhg">
    <div className="qhg-toolbar"><div className="qht-scales" role="group" aria-label="时间轴范围">
      <button type="button" aria-pressed={daily} onClick={()=>{setScale('day');setOffset(0);}}>日视图</button>
      <button type="button" aria-pressed={scale==='week'} onClick={()=>{setScale('week');setOffset(0);}}>一周</button>
      <button type="button" aria-pressed={scale==='sixWeeks'} onClick={()=>{setScale('sixWeeks');setOffset(0);}}>六周</button>
    </div><select aria-label="甘特图完成状态" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
      <option value="all">全部状态</option><option value="open">未完成</option><option value="done">已完成</option>
    </select><span className="qht-range">{daily ? selectedDate : shortDate(first)+' – '+shortDate(last-1)}</span>
      <button type="button" aria-label="上一时段" onClick={()=>setOffset(value=>value-1)}><Icon name="chevron-left" size={15}/></button>
      <button type="button" disabled={!offset} onClick={()=>setOffset(0)}>{daily?'回到今天':'回到本周'}</button>
      <button type="button" aria-label="下一时段" onClick={()=>setOffset(value=>value+1)}><Icon name="chevron-right" size={15}/></button>
    </div>
    <div className="qgt-key"><span><i aria-hidden="true"/>已排时段</span><span title="从创建待办到截止；已完成事项止于实际完成时间"><i aria-hidden="true"/>待办窗口</span></div>
    {!visibleGroups.length ? <p className="qhg-empty" role="status">{daily ? selectedDate+' 没有'+(statusFilter==='done'?'已完成的':statusFilter==='open'?'未完成的':'')+'任务。' : '没有符合条件的任务。'}</p> : <div ref={scrollRegion} className="qhg-scroll" role="region" aria-label="任务时间轴" tabIndex={0}>
      <div className="qhg-grid" data-scale={scale} style={daily ? {'--hour-count':dayAxis.hours.length} as CSSProperties : undefined}>
        <div className="qhg-line qhg-head"><span>任务与日程</span>{daily ? <DayAxisHeader axis={dayAxis} now={now}/> : <div>{columns.map(c=><time key={c.start} dateTime={dayText(c.start)}>{shortDate(c.start)}</time>)}
          {todayLine()}{inRange && <span className="qhg-today-label" style={{left:position(day+0.5)+'%'}}>今天</span>}</div>}</div>
        {visibleGroups.map(({key,title,project,rows,count,completed}) => {
          const open=!closed.includes(key);
          return <section key={key} aria-label={title}>
            <div className="qhg-line qhg-group"><div className="qhg-project-label">
              <button type="button" aria-expanded={open} onClick={()=>setClosed(open?[...closed,key]:closed.filter(k=>k!==key))}>
                <Icon name={open?'chevron-down':'chevron-right'} size={14}/><span><strong>{title}</strong><small>{completed}/{count} 项完成</small></span>
              </button>
              {project && <button type="button" className="qd-link" aria-label={'打开项目 '+title} onClick={()=>onOpenProject(project.id)}><Icon name="external" size={13}/></button>}
            </div>{daily ? <DayTrack axis={dayAxis} now={now}/> : weekTrack({last:dateDay(project?.deadline)},'pending',project?'未设项目截止':' ')}</div>
            {open && rows.map(row => {
              const {card,appointment} = row;
              const slot=appointment && chartSlot(appointment,date,zone,row.occurrence);
              const at=slot?.at;
              const stamp=at!==undefined ? dateInZone(at,zone).slice(5)+' '+timeInZone(at,zone) : '';
              const source=cardSource(card);
              const result = !row.nested && card.results[0];
              function openRow() {
                if (appointment && at!==undefined) onOpenSchedule?.(appointment.key,at);
                else if (project && card.taskId) onOpenBoardTask(project.id,card.taskId,row.itemId);
                else if (card.noteId) onOpenNote(card.noteId,card.todoId);
                else if (project) onOpenProject(project.id);
              }
              return <div key={row.key} className={'qhg-line qhg-task'+(row.nested?' qht-step':'')} data-kind={source.kind}>
                <div><button type="button" className="qht-row-action" onClick={openRow} title={appointment ? '打开日程 '+stamp : row.title}>
                  <span className="qht-source" data-kind={source.kind}>{source.label}</span>
                  <span className="qht-row-copy"><strong>{row.title}</strong>
                    <small><span data-state={row.state}>{boardStates[row.state]}</span>{stamp && ' · '+stamp}</small></span>
                </button>
                {result && project && card.taskId && <button type="button" className="qd-link" onClick={()=>onOpenBoardTask(project.id,card.taskId!,result.itemId,result.id)}>看成果</button>}
                </div>{daily ? <DayTrack axis={dayAxis} at={at} until={slot?.until} closed={slot?.closed} state={row.state}
                  availableAt={appointment && availableSince.get(appointment.key)}
                  dateOnly={!appointment ? (row.planned.milestone ? '里程碑' : row.planned.first === undefined ? '截止日' : row.planned.last === undefined ? '开始日' : '日期计划')+' · 未定时' : undefined}
                  originalAt={appointment && at !== appointment.at && appointment.at < dayAxis.start && !appointment.end ? appointment.at : undefined}
                  now={now} onOpen={openRow} title={row.title}/> : weekTrack(row.planned,row.state,'未排期',appointment,openRow)}</div>;
            })}
            {open && !rows.length && <p className="qhg-empty">暂无任务</p>}
          </section>;
        })}
      </div>
    </div>}
  </div>;
}
