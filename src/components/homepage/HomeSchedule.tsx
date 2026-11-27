import { useMemo, useState } from 'react';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { addNoteTodoProgress, setNoteTodoCompleted } from '../../data/knowledgeStore';
import { dateInZone, dayBounds, nextDate, timeInZone } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

import { carriedScheduleAt, overdueScheduleDays, scheduleEntries, type AgendaEntry } from '../../data/agendaSchedule';
import { ScheduleProgressLog } from './ScheduleProgressLog';

/** Keep original dates for history. Only project an unfinished item onto today. */
function occurrences(entries: AgendaEntry[], date: string, today: string, zone: string) {
  const [start, end] = dayBounds(date, zone);
  return entries.flatMap(entry => {
    const overlaps = entry.at < end && (entry.end !== undefined ? entry.end > start : entry.at >= start);
    const openToday = !entry.done && date === today;
    const closedHere = !!entry.completedAt && dateInZone(Date.parse(entry.completedAt), zone) === date;
    const carried = !overlaps && entry.at < start && (openToday || closedHere);
    if (!overlaps && !carried) return [];
    const at = carried ? carriedScheduleAt(entry.at, date, zone) : Math.max(start, entry.at);
    const until = entry.end !== undefined && carried ? at + entry.end - entry.at : entry.end;
    return [{ entry, at, until }];
  }).sort((a, b) => Number(a.entry.done) - Number(b.entry.done) || a.at - b.at || a.entry.key.localeCompare(b.entry.key));
}

interface Props {
  notes: KnowledgeNote[];
  projects: Snapshot[];
  ready: boolean;
  error: string;
  now: number;
  onWriteNote: () => void;
  onOpenProject: (id: string) => void;
  onOpenNoteTodo: (noteId: string, todoId: string) => void;
}

export function HomeSchedule({ notes, projects, ready, error, now, onWriteNote, onOpenProject, onOpenNoteTodo }: Props) {
  const { api, refreshProjects, toast } = useWorkdeck();
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState<Map<string, boolean>>(() => new Map());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInZone(now, zone);
  const date = selected ?? today;
  const isToday = date === today;
  const [start, end] = dayBounds(date, zone);
  const entries = useMemo(() => scheduleEntries(notes, projects), [notes, projects]);
  const days = useMemo(() => {
    // Use noon in UTC to calculate weekdays independently of the device's offset.
    const monday = nextDate(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));
    return Array.from({length: 7}, (_, index) => {
      const day = nextDate(monday, index);
      return { day, hasItems: occurrences(entries, day, today, zone).length > 0 };
    });
  }, [entries, date, today, zone]);
  const rows = useMemo(() => occurrences(entries, date, today, zone), [entries, date, today, zone]);
  const select = (day: string) => setSelected(day === today ? undefined : day);
  const update = async (entry: AgendaEntry) => {
    if (!('noteId' in entry)) return;
    setSaving(current => new Map(current).set(entry.key, !entry.done));
    try { await setNoteTodoCompleted(entry.noteId, entry.todoId, !entry.done); }
    catch (error) { toast(error instanceof Error ? error.message : '更改未能保存，请重试', 'error'); }
    finally { setSaving(current => { const next = new Map(current); next.delete(entry.key); return next; }); }
  };
  const dateLabel = new Date(start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', timeZone: zone });
  return <section className="qh-schedule qh-panel" aria-label="日程">
    <header className="qh-schedule-heading">
      <div><p><time dateTime={date}>{dateLabel}</time></p><h1>{isToday ? '今天的日程' : date === nextDate(today) ? '明天的日程' : '当天的日程'}</h1></div>
      <button type="button" className="qh-write" onClick={onWriteNote}><Icon name="pencil" size={15}/>写笔记</button>
    </header>
    <div className="qh-week" role="group" aria-label="选择日程日期">
      <button type="button" className="qh-week-step" aria-label="上一周" onClick={() => select(nextDate(date, -7))}><Icon name="chevron-left" size={17}/></button>
      {days.map(({day, hasItems}, i) => <button type="button" className="qh-week-day" key={day} aria-pressed={date === day} aria-current={day === today ? 'date' : undefined}
        aria-label={day + (day === today ? ' 今天' : '') + (hasItems ? '，有日程' : '')} onClick={() => select(day)}>
        <span>{day === today ? '今天' : '周' + '一二三四五六日'[i]}</span><strong>{Number(day.slice(-2))}</strong>
        <i className={hasItems ? 'has-entries' : undefined} aria-hidden="true"/>
      </button>)}
      <button type="button" className="qh-week-step" aria-label="下一周" onClick={() => select(nextDate(date, 7))}><Icon name="chevron-right" size={17}/></button>
    </div>
    <div className="qh-schedule-summary"><span>{rows.length ? rows.filter(({ entry }) => !entry.done).length + ' 项待办 · ' + rows.filter(({ entry }) => entry.done).length + ' 项已完成' : ''}</span>
      {!isToday && <button type="button" onClick={() => setSelected(undefined)}>回到今天</button>}</div>
    {error && <p className="qh-schedule-error" role="alert">读取笔记待办失败。{error}</p>}
    {rows.length ? <ul className="qh-schedule-list" aria-label="日程事项">{rows.map(({ entry, at, until }) => {
      const note = 'noteId' in entry;
      const overdue = isToday && !entry.done && (entry.end ?? entry.at) <= now;
      const lateDays = overdue ? overdueScheduleDays(entry.at, now, zone) : 0;
      return <li key={entry.key} className={entry.done ? 'is-done' : undefined}>
        <div className="qh-entry-time">
          <time dateTime={new Date(at).toISOString()}>{timeInZone(at, zone)}</time>
          {until !== undefined && <small>至 {until >= end ? '24:00' : timeInZone(until, zone)}</small>}
          {overdue && <small className={'qh-delay ' + (lateDays >= 3 ? 'qh-delay-red' : lateDays >= 1 ? 'qh-delay-orange' : '')}
            title={'原定 ' + dateInZone(entry.at, zone) + ' ' + timeInZone(entry.at, zone)}>{lateDays ? '逾期 ' + lateDays + ' 天' : '已到时间'}</small>}
        </div>
        <div className="qh-entry-copy"><button type="button" title={'打开' + (note ? '笔记' : '项目') + '「' + entry.source + '」'}
          onClick={() => 'noteId' in entry ? onOpenNoteTodo(entry.noteId, entry.todoId) : onOpenProject(entry.projectId)}>
          <strong>{entry.title}</strong><span><Icon name={note ? 'pencil' : 'folder'} size={12}/>{entry.source}<Icon name="arrow-right" size={12}/></span>
        </button>
          <ScheduleProgressLog records={entry.progress} submit={async (id, text) => {
            if ('noteId' in entry) await addNoteTodoProgress(entry.noteId, entry.todoId, id, text);
            else { await api.addPlanProgress(entry.planId, id, text, entry.projectId); await refreshProjects(); }
          }}/>
        </div>
        {note ? <input type="checkbox" checked={saving.get(entry.key) ?? entry.done} disabled={saving.has(entry.key)} onChange={() => void update(entry)}
          aria-label={(entry.done ? '重新打开' : '完成') + '「' + entry.title + '」'}/>
          : <Icon name={entry.done ? 'check-circle' : 'calendar'} size={17}/>}
      </li>;
    })}</ul> : <div className="qh-schedule-empty">
      <Icon name="calendar" size={30}/><strong>{ready ? '这一天还没有日程' : '正在读取日程…'}</strong>
      {ready && <p>在「帮你记」的一行末尾点「to do」，就能在这里看到待办和截止时间。</p>}
    </div>}
  </section>;
}
