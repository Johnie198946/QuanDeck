import { useEffect, useState } from 'react';
import { onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';
import type { NoteSelection } from '../../data/knowledgeNotes';
import type { Task } from '../../data/types';
import type { BoardResult } from '../homepage/homeBoardData';
import { resultExcerpt } from '../../data/resultExcerpt';
import { Icon } from '../ui/Icon';

export type OpenNoteSource = (id: string, todoId?: string, lineIndex?: number, quote?: string, selection?: NoteSelection) => void;

interface Props {
  task: Task;
  results: BoardResult[];
  onOpenNote: OpenNoteSource;
  onResult: (resultId: string) => void;
}

export function NoteDispatchTrail({task,results,onOpenNote,onResult}: Props) {
  const refs = (task.inputs ?? []).filter(input => input.noteSource);
  const [expanded,setExpanded] = useState(false);
  const [deleted,setDeleted]=useState<Set<string>>(new Set());
  const hasRefs=refs.length>0;
  useEffect(()=>{
    if (!hasRefs) return;
    let ticket=0;
    const read=()=>{
      const n=++ticket;
      void readKnowledge().then(library=>{if(n===ticket)setDeleted(new Set(library.deletedNoteIds));}).catch(()=>{});
    };
    const off=onKnowledgeChange(read);
    read();
    return ()=>{ticket++;off();};
  },[hasRefs]);
  if (!refs.length) return null;
  const result = results[0];
  const work = task.noteWork;
  return <section className="qn-dispatch-trail" aria-label="笔记委托">
    {!!work?.shared.length && <div className="qn-split-scope">
      {work.units.length>0 && <><h5>本任务负责</h5><ul>{work.units.map(unit=><li key={unit}>{unit}</li>)}</ul></>}
      <h5>由其他任务负责</h5><ul>{work.shared.map(({taskId,unit})=><li key={JSON.stringify([taskId,unit])}>{unit}</li>)}</ul>
    </div>}
    <h5><Icon name="plane" size={15}/>从笔记发来</h5>
    {refs.slice(0,expanded ? refs.length : 1).map(input => {
      const source=input.noteSource!;
      const original=/^来自笔记《([^\n]*)》\n([\s\S]*)$/.exec(input.text);
      const quote=source.selection?.quote || original?.[2] || input.text;
      return <div key={input.id} className="qn-dispatch-fragment">
        <blockquote>{quote}</blockquote>
        {deleted.has(source.noteId) ? <small>原笔记已删除</small> : <button type="button" className="qn-source-link" onClick={() => onOpenNote(source.noteId,source.todoId,source.lineIndex,quote,source.selection)}>
          <Icon name="pencil" size={12}/>{original?.[1] || '原笔记'}<Icon name="external" size={12}/></button>}
        {!!input.noteCustomTags?.length && <div className="qd-method-tags" aria-label="发出时的用户补充">{input.noteCustomTags.map(tag=><span key={tag}>{tag}</span>)}</div>}
        {!!input.noteLogic?.length && <details className="qn-logic-proof"><summary>发出时的处理思路 · {input.noteLogic.length} 步</summary>
          <ol>{input.noteLogic.map(step => <li key={step.id}><strong>{step.fromTitle}</strong> → {step.label} → <strong>{step.toTitle}</strong>{step.detail && <p>{step.detail}</p>}</li>)}</ol>
        </details>}
      </div>;
    })}
    {refs.length>1 && <button type="button" className="qn-source-link" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起原文':'另有 '+(refs.length-1)+' 段原文'}</button>}
    {result && <div className="qn-return"><div><Icon name="box" size={15}/><span>最近交回</span><small>{result.status}</small></div>
      <button type="button" onClick={()=>onResult(result.id)}>{result.title}<Icon name="arrow-right" size={13}/></button>
      {result.text && <p>{resultExcerpt(result.text,110)}</p>}</div>}
  </section>;
}
