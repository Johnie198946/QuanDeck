import {MaterialFiles, UseMaterial} from '../homepage/MaterialActions';
import type {MaterialTarget} from '../../data/materialUse';
import { useMemo, useState } from 'react';
import { assignTodoMaterial } from '../../data/knowledgeStore';
import { visibleTaskMaterials } from '../../data/taskMaterialContext';
import { createMaterialRecall, unrecordedRequests, type MaterialMatch } from '../../data/materialRecall';
import { useKnowledgeLibrary } from '../knowledge/useKnowledgeLibrary';
import { Icon } from '../ui/Icon';
import type { OpenNoteSource } from './NoteDispatchTrail';
import './task-materials.css';

type Query = Parameters<ReturnType<typeof createMaterialRecall>>[0];

export function TaskMaterials({query, onOpenNote}: {query:Query; onOpenNote?:OpenNoteSource}) {
  const {library} = useKnowledgeLibrary();
  const find = useMemo(() => createMaterialRecall(library.notes), [library.notes]);
  const matches = useMemo(() => visibleTaskMaterials(find, query), [
    find, query.text, query.context, query.projectId, query.projectName, query.exclude?.noteId, query.exclude?.todoId, query.target,
  ]);
  const leads=useMemo(()=>unrecordedRequests(library.notes,query),[library.notes,query]);
  return <><MaterialList matches={matches} target={query.target} projectId={query.projectId} onOpenNote={onOpenNote}/>
    {!!leads.length && <section className="qt-materials" aria-label="待补材料"><h3><Icon name="clock" size={15}/>待补材料</h3>
      <ul>{leads.map(lead=><li key={JSON.stringify([lead.noteId,lead.todoId])}><div><strong>{lead.title}</strong>
        <small>已勾选完成，尚未留下结果</small></div>
        {onOpenNote && <button type="button" onClick={()=>onOpenNote(lead.noteId,lead.todoId)}>查看原待办</button>}</li>)}</ul>
    </section>}</>;
}

export function MaterialList({matches, target, projectId, onOpenNote, backgroundDraft}: {
  matches:MaterialMatch[]; target?:MaterialTarget; projectId?:string; onOpenNote?:OpenNoteSource;
  backgroundDraft?:{text:string; setText:(text:string)=>void; busy:boolean};
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function file(match: MaterialMatch) {
    if (!projectId || busy) return;
    setBusy(true);
    setError('');
    try {
      await assignTodoMaterial(match.noteId, match.todoId, match.at, projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally { setBusy(false); }
  }
  if (!matches.length) return null;
  return <section className="qt-materials" aria-label="可复用的材料">
    <h3><Icon name="link" size={15}/>可复用的材料</h3>
    <ul>{matches.map(match => {
      const excerpt = match.excerpt || match.text || match.files?.[0]?.name || match.title;
      const source = match.noteTitle.trim() || '未命名笔记';
      const result = match.text.trim();
      const heading = result && result.length <= 120 ? result : match.title;
      const offset = heading.indexOf(excerpt);
      const separateExcerpt = offset < 0;
      const quotation = [`《${source}》`,heading,separateExcerpt ? excerpt : undefined,match.url].filter(Boolean).join('\n');
      const included = backgroundDraft?.text.includes(quotation);
      return <li key={JSON.stringify([match.noteId,match.todoId])}>
        <div className="qt-material-source"><strong>{!separateExcerpt && excerpt !== heading ? <>
          {heading.slice(0,offset)}<mark>{excerpt}</mark>{heading.slice(offset+excerpt.length)}
        </> : heading}</strong>
          {separateExcerpt && <blockquote>{excerpt}</blockquote>}
          <small>来自《{source}》 · {match.reason}</small>
          {match.purpose && match.purpose !== excerpt && <small>预留用途 · {match.purpose}</small>}
          {result && result !== excerpt && result !== heading && <details><summary>查看完整回执</summary><p>{result}</p></details>}
        </div>
        <div className="qt-material-links">
          {match.url && <a href={match.url} target="_blank" rel="noopener noreferrer">打开材料</a>}
          {onOpenNote && <button type="button" onClick={()=>onOpenNote(match.noteId,match.todoId)}>原待办</button>}
          {target && <UseMaterial match={match} target={target}/>}
          {backgroundDraft && <button type="button" disabled={included || backgroundDraft.busy} onClick={()=>{
            const next = [backgroundDraft.text,quotation].filter(Boolean).join('\n\n');
            if (next.length > 16000) {setError('项目背景最多可填 16000 字，缩短背景后可再引用。');return;}
            backgroundDraft.setText(next);setError('');
          }}>{included ? '已引用到项目背景' : '引用到项目背景'}</button>}
          {projectId && !target && (match.projectId === projectId ? <small>已归入本项目</small> :
            <button type="button" disabled={busy} title="归入当前项目，派发相关任务时带给 Agent" onClick={()=>void file(match)}>加入本项目</button>)}
        </div>
        <MaterialFiles files={match.files} noteId={match.noteId}/>
      </li>;
    })}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
