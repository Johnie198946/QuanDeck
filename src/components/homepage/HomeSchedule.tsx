import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { addNoteTodoProgress, followNoteProgress, setNoteTodoCompleted } from '../../data/knowledgeStore';
import { dateInZone, dayBounds, nextDate, timeInZone } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

import { scheduleOutcomeGroups } from '../../data/scheduleOutcomeGroups';
import { occurrences } from '../../data/scheduleOccurrence';
import { overdueScheduleDays, scheduleEntries, type AgendaEntry } from '../../data/agendaSchedule';
import { ScheduleProgressLog, progressDraft } from './ScheduleProgressLog';
import { ScheduleOutcomes, type OutcomeAction } from './ScheduleOutcomes';
import { ScheduleOutcomeDialog, type OutcomeMode } from './ScheduleOutcomeDialog';
import type { NoteTodo } from '../../data/noteTodos';
import { hasOutcomeDraft } from '../../data/scheduleOutcomeDraft';
import type { ClosingProgress } from '../../data/scheduleProgress';
import { createMaterialRecall } from '../../data/materialRecall';
import { RelatedMaterials } from './RelatedMaterials';

import './schedule-followups.css';

interface Props {
  focusRequest?: {key: string; at: number; nonce: number};
  onScheduleFocused?: () => void;
  onOpenBoard?: (key: string) => void;
  notes: KnowledgeNote[];
  projects: Snapshot[];
  ready: boolean;
  error: string;
  now: number;
  onWriteNote: () => void;
  onOpenProject: (id: string) => void;
  onOpenResult: (projectId: string, taskId: string, itemId?: string, resultId?: string) => void;
  onOpenNoteTodo: (noteId: string, todoId: string) => void;
}

export function HomeSchedule({ notes, projects, ready, error, now, onWriteNote, onOpenProject, onOpenNoteTodo, onOpenResult, focusRequest, onScheduleFocused, onOpenBoard }: Props) {
  const { api, refreshProjects, toast } = useWorkdeck();
  const [showResults, setShowResults] = useState(false);
  const [dialog, setDialog] = useState<{noteId: string; todo: NoteTodo; mode: OutcomeMode}>();
  const [planDialog,setPlanDialog] = useState<Extract<AgendaEntry,{planId:string}>>();
  const savePlanResult = (entry: Extract<AgendaEntry,{planId:string}>) => async (result: string, progress?: ClosingProgress) => {
    await api.completePlanFollowup(entry.planId,true,entry.projectId,result,progress);
    await refreshProjects();
  };
  const record: OutcomeAction = (noteId, todo, mode) => setDialog({noteId, todo, mode});
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState<Map<string, boolean>>(() => new Map());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInZone(now, zone);
  const date = selected ?? today;
  const isToday = date === today;
  const [start, end] = dayBounds(date, zone);
  const entries = useMemo(() => scheduleEntries(notes, projects), [notes, projects]);
  const findMaterials = useMemo(() => createMaterialRecall(notes, projects.map(p => p.project)), [notes, projects]);
  const resultGroups = useMemo(() => scheduleOutcomeGroups(entries,notes,projects), [entries,notes,projects]);
  const resultCount = resultGroups.length;
  const panel = useRef<HTMLElement>(null);
  const [spot, setSpot] = useState<{key: string; nonce: number}>();
  const lastRequest = useRef<number | undefined>(undefined);
  function visit(entry: AgendaEntry, nonce = performance.now(), occurrenceAt?: number) {
    setShowResults(false);
    const scheduled = dateInZone(entry.at, zone);
    const target = occurrenceAt === undefined ? (!entry.done && scheduled <= today ? today : scheduled) : dateInZone(occurrenceAt, zone);
    setSelected(target === today ? undefined : target);
    setSpot({key: entry.key, nonce});
  }
  useEffect(() => {
    if (!focusRequest || lastRequest.current === focusRequest.nonce) return;
    const entry = entries.find(e => e.key === focusRequest.key);
    if (!entry) return;
    lastRequest.current = focusRequest.nonce;
    visit(entry, focusRequest.nonce, focusRequest.at);
    onScheduleFocused?.();
  }, [focusRequest, entries, today, onScheduleFocused]);
  useEffect(() => {
    if (!spot) return;
    const target = panel.current?.querySelector<HTMLElement>('[data-agenda-key="' + CSS.escape(spot.key) + '"]');
    if (!target) return;
    target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest'});
    const timer = window.setTimeout(() => setSpot(undefined), 2600);
    return () => clearTimeout(timer);
  }, [spot, date]);
  const children = useMemo(() => {
    const grouped = new Map<string, AgendaEntry[]>();
    for (const item of entries) if (item.parentKey) {
      const related = grouped.get(item.parentKey) ?? [];
      related.push(item); grouped.set(item.parentKey, related);
    }
    return grouped;
  }, [entries]);
  const noteIndex = useMemo(() => new Map(notes.map(note => [note.id, note])), [notes]);
  const todoIndex = useMemo(() => new Map(notes.flatMap(note => (note.todos ?? []).map(todo => [JSON.stringify([note.id,todo.id]),todo] as const))), [notes]);
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
    if (!entry.done) {
      if ('noteId' in entry) {
        const todo = todoIndex.get(JSON.stringify([entry.noteId,entry.todoId]));
        if (todo) record(entry.noteId,todo,entry.followup && !entry.linkedId ? 'receive' : 'record');
      } else setPlanDialog(entry);
      return;
    }
    setSaving(current => new Map(current).set(entry.key, !entry.done));
    try {
      if ('noteId' in entry) await setNoteTodoCompleted(entry.noteId, entry.todoId, !entry.done);
      else { await api.completePlanFollowup(entry.planId, !entry.done, entry.projectId); await refreshProjects(); }

    }
    catch (error) { toast(error instanceof Error ? error.message : '更改未能保存，请重试', 'error'); }
    finally { setSaving(current => { const next = new Map(current); next.delete(entry.key); return next; }); }
  };
  const dateLabel = new Date(start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', timeZone: zone });
  const rowKeys = new Set(rows.map(({entry}) => entry.key));
  const otherDrafts = entries.filter(e => !rowKeys.has(e.key) && (progressDraft(e.key) || hasOutcomeDraft(e.key)));
  return <section ref={panel} className="qh-schedule qh-panel" aria-label="日程">
    <header className="qh-schedule-heading">
      <div><p><time dateTime={date}>{dateLabel}</time></p><h1>{showResults ? '成果库' : isToday ? '今天的日程' : date === nextDate(today) ? '明天的日程' : '当天的日程'}</h1></div>
      {!showResults && <button type="button" className="qh-write" onClick={onWriteNote}><Icon name="pencil" size={15}/>写笔记</button>}
    </header>
    <div className="qh-schedule-views" role="group" aria-label="日程视图">
      <button type="button" aria-pressed={!showResults} onClick={()=>setShowResults(false)}>日程</button>
      <button type="button" aria-pressed={showResults} onClick={()=>setShowResults(true)}>成果库{resultCount > 0 && <small>{resultCount}</small>}</button>
    </div>
    {error && <p className="qh-schedule-error" role="alert">读取笔记待办失败。{error}</p>}
    {showResults ? <ScheduleOutcomes groups={resultGroups} notes={notes} projects={projects} zone={zone}
      onRecord={record} onOpenNote={onOpenNoteTodo} onOpenProject={onOpenProject} onOpenResult={onOpenResult}/> : <>
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
    {otherDrafts.length > 0 && <div className="qh-other-drafts">
      {otherDrafts.map(e => <button type="button" key={e.key} onClick={() => visit(e)}><Icon name="pencil" size={12}/>续写草稿 · {e.title}</button>)}
    </div>}
    {rows.length ? <ul className="qh-schedule-list" aria-label="日程事项">{rows.map(({ entry, at, until }) => {
      const note = 'noteId' in entry;
      const todo = note ? todoIndex.get(JSON.stringify([entry.noteId,entry.todoId])) : undefined;
      const sourceNote = 'noteId' in entry ? noteIndex.get(entry.noteId) : undefined;
      const linked = new Set(sourceNote?.projectQuotes?.filter(q => q.lineIndex === todo?.lineIndex && q.text === todo?.text).map(q => q.projectId));
      const projectId = 'projectId' in entry ? entry.projectId : linked.size === 1 ? [...linked][0] : undefined;
      const plan = 'planId' in entry ? projects.find(p=>p.project.id===entry.projectId)?.plans.find(p=>p.id===entry.planId) : undefined;
      const canChangeCompletion = !entry.done || note || !!plan?.completedAt;
      const legacy = !!entry.followup && !entry.linkedId;
      const parent = entry.parentKey ? entries.find(e => e.key === entry.parentKey) : undefined;
      const target = 'noteId' in entry && !legacy ? {noteId:entry.noteId,todoId:entry.todoId} : undefined;
      const materials = !entry.done && !legacy ? findMaterials({
        target,
        text: entry.title, projectId, projectName: projects.find(p => p.project.id === projectId)?.project.name,
        exclude: 'noteId' in entry ? {noteId: entry.noteId, todoId: entry.todoId} : undefined,
      }) : [];
      const overdue = isToday && !entry.done && (entry.end ?? entry.at) <= now;
      const lateDays = overdue ? overdueScheduleDays(entry.end ?? entry.at, now, zone) : 0;
      return <li key={entry.key} data-delay={lateDays >= 3 ? "red" : lateDays >= 1 ? "orange" : undefined} data-agenda-key={entry.key} tabIndex={-1} data-located={spot?.key === entry.key || undefined} className={entry.done ? 'is-done' : undefined}>
        <div className="qh-entry-time">
          <time dateTime={new Date(at).toISOString()}>{timeInZone(at, zone)}</time>
          {until !== undefined && <small>至 {until >= end ? '24:00' : timeInZone(until, zone)}</small>}
          {overdue && <small className={'qh-delay ' + (lateDays >= 3 ? 'qh-delay-red' : lateDays >= 1 ? 'qh-delay-orange' : '')}
            title={'原定 ' + dateInZone(entry.at, zone) + ' ' + timeInZone(entry.at, zone)}>{lateDays ? '逾期 ' + lateDays + ' 天' : '已到时间'}</small>}
        </div>
        <div className="qh-entry-copy"><button type="button" title={'打开' + (note ? '笔记' : 'taskId' in entry && entry.taskId ? '任务' : '项目') + '「' + entry.source + '」'}
          onClick={() => 'noteId' in entry ? onOpenNoteTodo(entry.noteId, entry.todoId) : entry.taskId ? onOpenResult(entry.projectId,entry.taskId) : onOpenProject(entry.projectId)}>
          <strong>{entry.title}</strong><span><Icon name={note ? 'pencil' : 'folder'} size={12}/>{entry.source}<Icon name="arrow-right" size={12}/></span>
        </button>
          <div className="qh-schedule-links">
            {parent && <button type="button" onClick={() => visit(parent)} title={parent.title}>
              <Icon name="reply" size={12}/>原事项 · {parent.title}</button>}
            {onOpenBoard && <button type="button" aria-label={'在看板查看「'+entry.title+'」'} title="在看板查看"
              onClick={() => onOpenBoard(entry.key)}><Icon name="chart" size={12}/></button>}
          </div>
          <RelatedMaterials materials={materials} onOpenNote={onOpenNoteTodo} target={target}/>
          <ScheduleProgressLog key={entry.key + (entry.done ? ':done' : ':open')} dueAt={entry.at} deadline={entry.end ?? entry.at} done={entry.done}
            renderResult={(close,finish) => note && todo && 'noteId' in entry
              ? <ScheduleOutcomeDialog noteId={entry.noteId} todo={todo} mode={legacy ? 'receive' : 'record'} now={now} zone={zone}
                  projects={projects} inline onClose={close} onSaved={finish}/>
              : 'planId' in entry ? <ScheduleOutcomeDialog title={entry.title} entryKey={entry.key} currentResult="" completed={entry.done}
                  now={now} zone={zone} projects={projects} inline onClose={close} onSaved={finish} submitPlan={savePlanResult(entry)}/> : null}
            entryKey={entry.key} date={date} records={entry.progress} children={children.get(entry.key) ?? []} open={visit}
            submit={async (id, text, move) => {
              if ('noteId' in entry) await addNoteTodoProgress(entry.noteId, entry.todoId, id, text, legacy, move);
              else { await api.addPlanProgress(entry.planId, id, text, entry.projectId, move); await refreshProjects(); }
              if (move) {
                const date = dateInZone(Date.parse(move.dueAt) - ((entry.end ?? entry.at) - entry.at), zone);
                select(date); setSpot({key:entry.key, nonce:performance.now()});
                toast('日程已改到 ' + new Date(move.dueAt).toLocaleString('zh-CN'));
              }
            }} follow={async request => {
              if ('noteId' in entry) await followNoteProgress(entry.noteId, entry.todoId, request, legacy);
              else { await api.followPlanProgress(entry.planId, request, entry.projectId); await refreshProjects(); }
              const display = (ms: number) => new Date(ms).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
              const due = Date.parse(request.dueAt);
              toast('跟进 ' + display(due) + ' · 原事项 ' + display(due + 3600000));
            }}/>
          {note && todo && (entry.done || legacy) && <div className="qh-outcome-actions">
            {legacy ? <button type="button" onClick={()=>record(entry.noteId,todo,'receive')}>记下收到的材料</button> :
              <button type="button" onClick={()=>record(entry.noteId,todo,'record')}>{todo.outcome ? '编辑结果' : '补上材料'}</button>}
          </div>}
        </div>
        {canChangeCompletion ? <input type="checkbox" checked={saving.get(entry.key) ?? entry.done} disabled={saving.has(entry.key)} onChange={() => void update(entry)}
          aria-label={(entry.done ? '重新打开' : '完成') + '「' + entry.title + '」'}/>
          : <Icon name={entry.done ? 'check-circle' : 'calendar'} size={17}/>}
      </li>;
    })}</ul> : <div className="qh-schedule-empty">
      <Icon name="calendar" size={30}/><strong>{ready ? '这一天还没有日程' : '正在读取日程…'}</strong>
      {ready && <p>在「帮你记」的一行末尾点「to do」，就能在这里看到待办和截止时间。</p>}
    </div>}</>}
    {planDialog && <ScheduleOutcomeDialog title={planDialog.title} entryKey={planDialog.key} currentResult="" completed={false}
      projects={projects} now={now} zone={zone} submitPlan={savePlanResult(planDialog)} onClose={()=>setPlanDialog(undefined)}/>}
    {dialog && <ScheduleOutcomeDialog {...dialog} projects={projects} now={now} zone={zone} onClose={()=>setDialog(undefined)}/>}
  </section>;
}
