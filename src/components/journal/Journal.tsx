import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import type { TaskCloseout } from '../../data/taskCloseout';
import type { JournalBlock } from '../../data/types';
import { AnnotationHistory, AnnotationProvider } from './AnnotationHistory';
import { taskProgressTrail } from '../../data/taskProgressTrail';
import { TaskCloseoutRow } from './TaskCloseoutRow';
import { Composer } from "./Composer";
import type { ProjectActivityEntry } from '../../data/projectActivity';
import { ProjectActivityRow } from '../deck/ProjectActivityRow';
import { SuggestionNotice } from './SuggestionNotice';
import { SessionEntry } from "./SessionEntry";
import { TaskRow } from "./TaskRow";
import { TextBlock } from "./TextBlock";
import { MergeCollapseSlot } from "./MergeFx";
import { usePreferences } from "../../state/preferences";
import { businessJournal } from '../../data/businessTasks';
import { Icon } from "../ui/Icon";
import type { LogDensity } from "../../state/preferences";
import './session-log.css';

function InlineEditable({
  value,
  onSave,
  className,
  label,
  as: Tag,
}: {
  value: string;
  onSave: (v: string) => void;
  className: string;
  label: string;
  as: "h1" | "p";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  if (editing)
    return (
      <input
        className={`${className} qd-inline-input`}
        value={draft}
        autoFocus
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <Tag
      className={`${className} qd-editable`}
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
      title="点击编辑"
    >
      {value}
    </Tag>
  );
}

function prioritizeTaskRuns(blocks: JournalBlock[], priority: (taskId: string) => number) {
  const ordered: JournalBlock[] = [];
  let run: Extract<JournalBlock, {kind:'task'}>[] = [];
  const flush = () => {
    ordered.push(...run.sort((a,b)=>priority(a.taskId)-priority(b.taskId)));
    run = [];
  };
  // Notes and unlinked sessions retain their original place in the journal.
  for (const block of blocks) {
    if (block.kind === 'task') run.push(block);
    else { flush(); ordered.push(block); }
  }
  flush();
  return ordered;
}

export function Journal({projection, railControl, attention, running}:{attention: ProjectActivityEntry[]; running: ProjectActivityEntry[]; railControl?: React.ReactNode; projection:{closeouts:Map<string,TaskCloseout>;journal:ReturnType<typeof businessJournal>;closed:boolean;reviewOnly:boolean}}) {
  const {preferences,update} = usePreferences();
  const { snap, api, mergeFx, drag, setDrag, toast, locateTask, locatedTask, openProjectDirection } = useWorkdeck();
  // 关联成功后，源行在原位置留一个收起中的占位
  const slot =
    mergeFx?.snapshot &&
    !snap.journal.blocks.some((b) => b.kind === "session" && b.sessionId === mergeFx.sessionId)
      ? mergeFx
      : null;
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'review'>('all');
  const {closeouts,journal,closed,reviewOnly}=projection, focused=closed||reviewOnly;
  const [addOpen,setAddOpen]=useState(false);
  useEffect(()=>{const open=()=>setAddOpen(true);window.addEventListener('quandeck:new-task',open);window.addEventListener('quandeck:prefill',open);return()=>{window.removeEventListener('quandeck:new-task',open);window.removeEventListener('quandeck:prefill',open)}},[]);
  const {total,completed:completeCount}=journal;
  const pendingEntries = (m?: TaskCloseout) => m ? [m.root,...m.children].filter(entry=>entry.pending).length : 0;
  const pendingCount=journal.blocks.reduce((count,b)=>count+(b.kind==='task' ? pendingEntries(closeouts.get(b.taskId)) : 0),0);
  const unfinished = useMemo(() => pendingCount > 0 ? taskProgressTrail(snap).unfinished : 0,[pendingCount,snap]);
  const [doneOpen,setDoneOpen] = useState(false);
  useLayoutEffect(() => {
    if (!locatedTask) return;
    const completed = !!closeouts.get(locatedTask)?.done;
    if (filter === 'active' && completed || filter === 'done' && !completed ||
        filter === 'review' && !pendingEntries(closeouts.get(locatedTask))) setFilter('all');
    if (completed) setDoneOpen(true);
  },[locatedTask]);
  useEffect(()=>{if(!pendingCount && filter==='review') setFilter('all')},[pendingCount,filter]);
  const visibleBlocks=journal.blocks.filter(b=>{
    if(focused || filter==='all') return true;
    if(filter==='review') return b.kind==='task' && pendingEntries(closeouts.get(b.taskId))>0;
    return b.kind!=='task' || closeouts.get(b.taskId)?.done===(filter==='done');
  });
  const groupedDone = !focused && filter === 'all' ? visibleBlocks.filter(b => b.kind === 'task' && closeouts.get(b.taskId)?.done) : [];
  const completedIds = new Set(groupedDone.map(block => block.id));
  const waitingTaskIds = new Set(attention.map(entry=>entry.taskId));
  const runningTaskIds = new Set(running.map(entry=>entry.taskId));
  const taskPriority = (taskId: string) => {
    if (waitingTaskIds.has(taskId)) return 0;
    const model=closeouts.get(taskId);
    if (model && [model.root,...model.children].some(entry=>entry.pending || entry.returned || entry.needsUpdate)) return 1;
    return runningTaskIds.has(taskId) ? 2 : 3;
  };
  const ungrouped = visibleBlocks.filter(block=>!completedIds.has(block.id));
  const ordered = focused || filter === 'done' ? ungrouped : prioritizeTaskRuns(ungrouped,taskPriority);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  useEffect(() => {
    if (!newTaskId || !snap.tasks[newTaskId]) return;
    locateTask(newTaskId);
    setNewTaskId(null);
  }, [newTaskId, snap.tasks, locateTask]);
  const onTaskCreated = (taskId: string) => {
    setFilter('all');
    setAddOpen(false);
    setNewTaskId(taskId);
  };
  const newTask = () => window.dispatchEvent(new CustomEvent('quandeck:new-task'));

  return (
    <AnnotationProvider><section className={'qd-journal'+(focused?' is-closeout':'')} aria-label="项目任务">
      <div className="qd-journal-scroll">
        <div className="qd-journal-inner">
          <header className="qd-project-heading">
            {total > 0 && <div className="qd-progress-ring" style={{'--qd-completed': (completeCount / total * 100) + '%'} as React.CSSProperties}
              role="img" aria-label={`主任务已完成 ${completeCount}/${total}`}><span>{completeCount}<small>/{total}</small></span></div>}
            <div><p className="qd-project-eyebrow">{closed?'任务回顾':reviewOnly?'任务验收':'项目任务'}</p><h1 className="qd-page-title">{snap.project.name}</h1>{closed ? <p className="qd-journal-summary">{completeCount} 项主任务已完成</p> : pendingCount>0 ? (focused ? <p className="qd-journal-summary">{pendingCount} 份候选成果可分别验收</p> : <button type="button" className="qd-journal-review-filter" aria-pressed={filter==='review'} onClick={()=>setFilter(filter==='review'?'all':'review')}>{pendingCount} 份候选成果可分别验收<Icon name="arrow-right" size={14}/></button>) : snap.project.description && <p className="qd-project-description">{snap.project.description}</p>}{pendingCount > 0 && unfinished > 0 && <p className="qd-review-scope">项目中有 {unfinished} 项任务尚未交付完整候选</p>}</div>
            <div className="qd-project-primary-actions">{railControl}<button type="button" className={'qd-btn qd-new-task '+(focused || pendingCount || attention.length ? 'ghost' : 'primary')} onClick={newTask}><Icon name="plus" size={16}/>新任务</button></div>
          </header>
          {!focused && total > 0 && <div className="qd-project-toolbar">
            <nav aria-label="任务筛选">{([['all', '全部任务', total], ['active', '待推进', total - completeCount], ['done', '已完成', completeCount]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>)}</nav>
            <details className="qd-project-options"><summary>更多</summary><button type="button" className="qd-link" onClick={() => void openProjectDirection()}>项目方向</button><label className="qd-log-density">执行记录<select aria-label="执行记录密度" value={preferences.logDensity} onChange={e=>update({logDensity:e.target.value as LogDensity})}><option value="brief">简略</option><option value="standard">标准</option><option value="detailed">详细</option></select></label><InlineEditable as="p" className="qd-summary" label="编辑项目笔记" value={snap.journal.summary || '添加项目笔记'} onSave={summary => api.updateJournal({summary})}/></details>
          </div>}
          {attention.length > 0 && <section className="qd-task-attention" aria-label="等你处理">
            <h2>等你处理</h2>
            {attention.slice(0,3).map(entry => <ProjectActivityRow key={entry.id} entry={entry} compact/>)}
            {attention.length > 3 && <details><summary>另外 {attention.length - 3} 项</summary>
              {attention.slice(3).map(entry => <ProjectActivityRow key={entry.id} entry={entry} compact/>)}
            </details>}
          </section>}

          <div className={'qd-blocks'+(closed?' qd-completed-gallery':'')}>
            {slot && slot.afterBlockId === null && <MergeCollapseSlot key={slot.key} fx={slot} />}
            {ordered.map((b) => {
              const node =
                b.kind === "text" ? (
                  <TextBlock key={b.id} blockId={b.id} text={b.text} />
                ) : b.kind === "task" ? (
                  closeouts.get(b.taskId)?.quiet ? <TaskCloseoutRow key={b.id} taskId={b.taskId} model={closeouts.get(b.taskId)!}/> : <TaskRow key={b.id} taskId={b.taskId} model={closeouts.get(b.taskId)}/>
                ) : (
                  <SessionEntry key={b.id} sessionId={b.sessionId} />
                );
              return slot && slot.afterBlockId === b.id
                ? [node, <MergeCollapseSlot key={`slot-${slot.key}`} fx={slot} />]
                : node;
            })}
            {groupedDone.length > 0 && <details className="qd-completed-group" open={doneOpen} onToggle={e=>setDoneOpen(e.currentTarget.open)}>
              <summary>已完成的任务 <span>{groupedDone.length}</span></summary>
              {groupedDone.map(b=>b.kind==='task' && <TaskCloseoutRow key={b.id} taskId={b.taskId} model={closeouts.get(b.taskId)!}/>)}
            </details>}
            {visibleBlocks.length === 0 && (
              <div className="qd-empty">
                {filter === 'done' ? '完成的任务会收在这里。' : '写下第一项任务'}
                {!total && <button type="button" className="qd-link" onClick={() => void openProjectDirection()}>讨论项目方向</button>}
              </div>
            )}
            {drag?.type === 'session' && <div className="qd-empty" role="region" aria-label="放开会话新建任务"
              style={{ border: '1px dashed var(--qd-border, #c7cbd1)', borderRadius: 8, padding: 20 }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; }}
              onDrop={async event => { event.preventDefault(); const sessionId = drag.sessionId; setDrag(null); try { const result = await api.createTaskFromSession(sessionId); if (result.ok && result.taskId) locateTask(result.taskId); else toast(result.message ?? '关联失败', 'error'); } catch (error) { toast(error instanceof Error ? error.message : '关联失败', 'error'); } }}>放到这里，新建关联任务</div>}
          </div>
          <AnnotationHistory key={snap.project.id}/>
          {!focused && total > 0 && <SuggestionNotice />}
        </div>
      </div>
      <div className="qd-composer-wrap" style={total > 0 && !addOpen ? {display:"none"} : undefined}>
        <Composer onTaskCreated={onTaskCreated} />
      </div>
    </section></AnnotationProvider>
  );
}
