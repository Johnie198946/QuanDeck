import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { setNoteTodoCompleted } from '../../data/knowledgeStore';
import { resultExcerpt } from '../../data/resultExcerpt';
import type { NoteTaskSource } from '../knowledge/NoteTaskDialog';
import { Icon } from '../ui/Icon';
import type { Snapshot } from '../../data/types';
import { materialTargetKey } from '../../data/materialUse';
import { createMaterialRecall } from '../../data/materialRecall';
import { MaterialFiles } from './MaterialActions';
import { ScheduleOutcomeDialog } from './ScheduleOutcomeDialog';
import { TaskBrief } from './TaskBrief';
import { RelatedMaterials } from './RelatedMaterials';
import { dateInZone } from '../../data/timeline';
import { agendaDisplayAt, boardStates, type BoardCard } from './homeBoardData';

export interface BoardNavigation {
  onOpenSchedule?: (key: string, at: number) => void;
  onOpenNote: (noteId: string, todoId?: string, lineIndex?: number, quote?: string) => void;
  onOpenBoardTask: (projectId: string, taskId: string, itemId?: string, resultId?: string) => void;
  onOpenProject: (projectId: string) => void;
}
const stamp = (at: string) => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
};
interface Props extends BoardNavigation {
  focusKey?: string; card: BoardCard; notes: KnowledgeNote[]; projects: Snapshot[]; onClose: () => void;
  onSend: (source: NoteTaskSource) => void;
}

export function HomeBoardDetail({card,focusKey,notes,projects,onClose,onSend,onOpenNote,onOpenBoardTask,onOpenProject,onOpenSchedule}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [recording,setRecording] = useState(false);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const note = notes.find(n => n.id === card.noteId);
  const todo = note?.todos?.find(t => t.id === card.todoId);
  const findMaterials = useMemo(() => createMaterialRecall(notes, projects.map(p => p.project)), [notes, projects]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInZone(Date.now(),zone);
  const target = useMemo(() => card.projectId && card.taskId ? {projectId:card.projectId,taskId:card.taskId}
    : card.noteId && card.todoId ? {noteId:card.noteId,todoId:card.todoId} : undefined, [card]);
  const materials = useMemo(() => {
    const matches = findMaterials({text:card.title, projectId:card.projectId,
      projectName:card.projectId ? card.project : undefined, target,
      exclude:card.noteId && card.todoId ? {noteId:card.noteId,todoId:card.todoId} : undefined});
    if (card.state !== 'done') return matches;
    return matches.filter(m => target && m.usedBy?.some(use => materialTargetKey(use)===materialTargetKey(target)));
  }, [card,findMaterials,target]);
  const toggle = async () => {
    if (!card.noteId || !todo || busy) return;
    if (!todo.completedAt) {setRecording(true); return;}
    setBusy(true);setError('');
    try { await setNoteTodoCompleted(card.noteId,todo.id,!todo.completedAt); }
    catch(cause) {setError(cause instanceof Error ? cause.message : '更新失败，请重试');}
    finally {setBusy(false);}
  };
  return createPortal(<dialog ref={dialog} aria-labelledby="home-board-detail-title" className="qhb-dialog" onCancel={event=>{if(event.target===dialog.current)onClose();}}
    onClick={event=>{if(event.target === dialog.current){const b=dialog.current.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)onClose();}}}>
    <header><div><span className="qhb-context"><Icon name={card.projectId?'folder':'check-square'} size={14}/>{card.project}</span>
      <h2 id="home-board-detail-title">{card.title}</h2>
      <p><span className={'qhb-dot '+card.state}/>{boardStates[card.state]}<span>·</span>{card.ownerName}{card.reason && <><span>·</span>{card.reason}</>}</p>
    </div><button className="qd-icon-btn" type="button" aria-label="关闭任务详情" onClick={onClose} autoFocus><Icon name="close" size={17}/></button></header>
    <div className="qhb-detail-body">
      <TaskBrief card={card} notes={notes} snapshot={projects.find(s=>s.project.id===card.projectId)}/>
      <details className="qhb-evidence" open={focusKey ? true : undefined}><summary>查看原文与记录</summary>
      <RelatedMaterials target={target} materials={materials} onOpenNote={onOpenNote}/>
      {!!card.schedule?.length && onOpenSchedule && <section><h3><Icon name="calendar" size={16}/>关联日程</h3>
        <ul className="qht-appointments">{card.schedule.map(entry=>{
          const at=agendaDisplayAt(entry,today,zone);
          const iso=new Date(at).toISOString();
          return <li key={entry.key} className={focusKey===entry.key ? 'is-target' : undefined}><button type="button" onClick={()=>{onClose();onOpenSchedule(entry.key,at);}}>
            <time dateTime={iso}>{stamp(iso)}</time><span>{entry.title}</span><Icon name="arrow-right" size={14}/>
          </button></li>;
        })}</ul>
      </section>}
      {todo && note && <section><h3><Icon name="box" size={16}/>日程成果</h3>
        {todo.outcome && <div className="qht-receipt">
          {todo.outcome.text && <p>{todo.outcome.text}</p>}
          {todo.outcome.url && <a href={todo.outcome.url} target="_blank" rel="noreferrer">打开材料<Icon name="external" size={12}/></a>}
          <MaterialFiles noteId={note.id} files={todo.outcome.files}/>
        </div>}
        <button type="button" className="qd-link" onClick={()=>setRecording(true)}>{todo.outcome?'编辑结果':'记录结果'}</button>
      </section>}
      {!!card.results.length && <section><h3><Icon name="box" size={16}/>交回的成果</h3>
        {card.results.map(result=><button className="qhb-result" type="button" key={result.id} onClick={()=>onOpenBoardTask(card.projectId!,card.taskId!,result.itemId,result.id)}>
          <div><small>{result.ai?'AI 提交':'任务成果'} · {result.status} · {stamp(result.at)}</small><strong>{result.title}</strong>
          {result.text && <p>{resultExcerpt(result.text,140)}</p>}</div><Icon name="chevron-right" size={16}/>
        </button>)}</section>}
      {!!card.progress.length && <section><h3><Icon name="clock" size={16}/>进展记录</h3>
        <ol className="qhb-log">{[...card.progress].reverse().map(entry=><li key={entry.id}><time dateTime={entry.at}>{stamp(entry.at)}</time><p>{entry.text}</p></li>)}</ol>
      </section>}
      {!!card.steps.length && <section><h3><Icon name="list-bullets" size={16}/>子任务</h3>
        {card.steps.map(step=><button key={step.id} type="button" className="qhb-child" onClick={()=>onOpenBoardTask(card.projectId!,card.taskId!,step.id)}>
          <span>{step.title}</span><small>{step.owner && step.owner+' · '}{step.state}</small><Icon name="chevron-right" size={14}/></button>)}</section>}
      <section><h3><Icon name="pencil" size={16}/>最初的想法与补充</h3>
        {card.sources.map((source,i)=><blockquote key={i}>
          <p>{source.text}</p>
          <footer><span>{source.title} · {stamp(source.at)}</span>
          {source.noteId && <button type="button" onClick={()=>onOpenNote(source.noteId!,source.todoId)}>打开原笔记 <Icon name="external" size={13}/></button>}</footer>
        </blockquote>)}</section>
      </details>
    </div>
    {error && <p className="qhb-error" role="alert">{error}</p>}
    <footer className="qhb-detail-actions">
      {todo && note && <><button type="button" className="qp-btn" onClick={()=>onSend({noteId:note.id,noteTitle:note.title,todoId:todo.id,lineIndex:todo.lineIndex,text:todo.text})}>加入项目</button>
        <button type="button" className="qp-btn primary" disabled={busy} onClick={()=>void toggle()}>{todo.completedAt?'重新打开待办':'完成待办'}</button></>}
      {card.projectId && <button type="button" className="qp-btn primary" onClick={()=>card.taskId ? onOpenBoardTask(card.projectId!,card.taskId) : onOpenProject(card.projectId!)}>{card.taskId?'打开任务':'打开项目'}<Icon name="arrow-right" size={15}/></button>}
    </footer>
    {recording && note && todo && <ScheduleOutcomeDialog noteId={note.id} todo={todo} mode="record"
      now={Date.now()} zone={zone} projects={projects} onClose={()=>setRecording(false)}/>}
  </dialog>, document.body);
}
