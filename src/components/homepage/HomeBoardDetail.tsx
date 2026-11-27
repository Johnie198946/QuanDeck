import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { setNoteTodoCompleted } from '../../data/knowledgeStore';
import { resultExcerpt } from '../../data/resultExcerpt';
import type { NoteTaskSource } from '../knowledge/NoteTaskDialog';
import { Icon } from '../ui/Icon';
import { boardStates, type BoardCard } from './homeBoardData';

export interface BoardNavigation {
  onOpenNote: (noteId: string, todoId?: string, lineIndex?: number, quote?: string) => void;
  onOpenBoardTask: (projectId: string, taskId: string, itemId?: string, resultId?: string) => void;
  onOpenProject: (projectId: string) => void;
}
const stamp = (at: string) => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
};
interface Props extends BoardNavigation {
  card: BoardCard; notes: KnowledgeNote[]; onClose: () => void;
  onSend: (source: NoteTaskSource) => void;
}

export function HomeBoardDetail({card,notes,onClose,onSend,onOpenNote,onOpenBoardTask,onOpenProject}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const note = notes.find(n => n.id === card.noteId);
  const todo = note?.todos?.find(t => t.id === card.todoId);
  const toggle = async () => {
    if (!card.noteId || !todo || busy) return;
    setBusy(true);setError('');
    try { await setNoteTodoCompleted(card.noteId,todo.id,!todo.completedAt); }
    catch(cause) {setError(cause instanceof Error ? cause.message : '更新失败，请重试');}
    finally {setBusy(false);}
  };
  return createPortal(<dialog ref={dialog} aria-labelledby="home-board-detail-title" className="qhb-dialog" onCancel={onClose}
    onClick={event=>{if(event.target === dialog.current){const b=dialog.current.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)onClose();}}}>
    <header><div><span className="qhb-context"><Icon name={card.projectId?'folder':'check-square'} size={14}/>{card.project}</span>
      <h2 id="home-board-detail-title">{card.title}</h2>
      <p><span className={'qhb-dot '+card.state}/>{boardStates[card.state]}<span>·</span>{card.ownerName}{card.reason && <><span>·</span>{card.reason}</>}</p>
    </div><button className="qd-icon-btn" type="button" aria-label="关闭任务详情" onClick={onClose} autoFocus><Icon name="close" size={17}/></button></header>
    <div className="qhb-detail-body">
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
    </div>
    {error && <p className="qhb-error" role="alert">{error}</p>}
    <footer className="qhb-detail-actions">
      {todo && note && <><button type="button" className="qp-btn" onClick={()=>onSend({noteId:note.id,noteTitle:note.title,todoId:todo.id,lineIndex:todo.lineIndex,text:todo.text})}>加入项目</button>
        <button type="button" className="qp-btn primary" disabled={busy} onClick={()=>void toggle()}>{todo.completedAt?'重新打开待办':'完成待办'}</button></>}
      {card.projectId && <button type="button" className="qp-btn primary" onClick={()=>card.taskId ? onOpenBoardTask(card.projectId!,card.taskId) : onOpenProject(card.projectId!)}>{card.taskId?'打开任务':'打开项目'}<Icon name="arrow-right" size={15}/></button>}
    </footer>
  </dialog>, document.body);
}
