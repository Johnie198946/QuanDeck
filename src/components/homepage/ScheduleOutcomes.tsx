import { useMemo, useState } from 'react';
import type { AgendaEntry } from '../../data/agendaSchedule';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import type { Snapshot } from '../../data/types';
import { materialTargetKey, type MaterialTarget } from '../../data/materialUse';
import { outcomeUrl, type NoteTodo } from '../../data/noteTodos';
import { outcomeShelf } from './outcomeShelf';
import type { OutcomeMode } from './ScheduleOutcomeDialog';
import { MaterialFiles } from './MaterialActions';
import { Icon } from '../ui/Icon';
import './outcome-library.css';

export type OutcomeAction = (noteId:string,todo:NoteTodo,mode:OutcomeMode)=>void;
type Filter = 'all'|'material'|'used'|'empty';
interface Props {
  groups:AgendaEntry[][]; notes:KnowledgeNote[]; projects:Snapshot[]; zone:string;
  onRecord:OutcomeAction;
  onOpenNote:(noteId:string,todoId:string)=>void;
  onOpenProject:(projectId:string)=>void;
  onOpenResult:(projectId:string,taskId:string,itemId?:string,resultId?:string)=>void;
}

export function ScheduleOutcomes({groups,notes,projects,zone,onRecord,onOpenNote,onOpenProject,onOpenResult}:Props) {
  const [filter,setFilter]=useState<Filter>('all'), [query,setQuery]=useState(''), [limit,setLimit]=useState(10);
  const data=useMemo(()=>outcomeShelf(groups,notes,projects),[groups,notes,projects]);
  const tabs:[Filter,string,number][]=[['all','全部',data.length],['material','有材料',data.filter(x=>x.hasMaterial).length],
    ['used','已引用',data.filter(x=>x.uses.length).length],['empty','待补结果',data.filter(x=>!x.hasMaterial).length]];
  const visible=data.filter(x=>(filter==='all'||(filter==='used'?x.uses.length:filter==='material'?x.hasMaterial:!x.hasMaterial)) &&
    x.search.includes(query.trim().toLocaleLowerCase()));
  const openTarget=(t:MaterialTarget)=>'noteId' in t ? onOpenNote(t.noteId,t.todoId) : onOpenResult(t.projectId,t.taskId,t.itemId);
  const openEntry=(e:AgendaEntry)=>'noteId' in e ? onOpenNote(e.noteId,e.todoId) : e.taskId ? onOpenResult(e.projectId,e.taskId) : onOpenProject(e.projectId);
  const stamp=(at:string)=>new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:zone});
  const shortDate=(at:string)=>new Date(at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',timeZone:zone});

  return <section className="qh-shelf" aria-label="日程结果">
    <div className="qh-shelf-bar"><div role="group" aria-label="结果筛选">
      {tabs.map(([key,label,count])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>{setFilter(key);setLimit(10);}}>
        {label}<small>{count}</small></button>)}</div>
      <label><Icon name="search" size={14}/><input aria-label="搜索日程结果" type="search" value={query}
        placeholder="搜材料、人名或使用它的任务" onChange={e=>{setQuery(e.target.value);setLimit(10);}}/></label>
    </div>
    {!visible.length && <p className="qh-outcome-empty">{data.length ? '没有匹配的结果。' : '完成的日程会收在这里。'}</p>}
    <ul className="qh-shelf-list">{visible.slice(0,limit).map(({entry,todo,outcome,resultText,delivered,uses,at,projectName,hasMaterial,latest,trail})=>{
      const title=resultText || outcome?.files?.[0]?.name || delivered[0]?.title || entry.title;
      const waiting=!!todo?.followup && !todo.followup.receivedAt;
      const url=outcome?.url && outcomeUrl(outcome.url);
      return <li key={entry.key} className="qh-shelf-item">
        <span className="qh-shelf-marker" data-material={hasMaterial}><Icon name={hasMaterial?'box':'check-square'} size={18}/></span>
        <div className="qh-shelf-body">
          <div className="qh-shelf-meta"><time dateTime={at}>{shortDate(at)}</time>{projectName && <span>{projectName}</span>}</div>
          <h3>{title}</h3>
          <div className="qh-shelf-trail"><span>来自</span><button type="button" title={entry.source}
            onClick={()=>openEntry(entry)}>
              {entry.title===title ? entry.source : entry.title}<Icon name="arrow-right" size={11}/></button>
            {uses.length>0 && <><span className="qh-shelf-used">已用于</span>{uses.map(({target,title:label})=>
              <button key={materialTargetKey(target)} type="button" onClick={()=>openTarget(target)}>{label}<Icon name="arrow-right" size={11}/></button>)}</>}
          </div>
          {outcome?.purpose && <p className="qh-shelf-purpose">预留用途 · {outcome.purpose}</p>}
          {!hasMaterial && latest && <p className="qh-shelf-purpose">{latest}</p>}
          {url && <a className="qh-shelf-url" href={url} target="_blank" rel="noreferrer"><Icon name="link" size={13}/>打开材料 ↗</a>}
          {'noteId' in entry && <MaterialFiles files={outcome?.files} noteId={entry.noteId}/>}
          {'projectId' in entry && entry.taskId && delivered.map(d=><button className="qh-shelf-url" type="button" key={d.id}
            onClick={()=>onOpenResult(entry.projectId,entry.taskId!,d.itemId,d.id)}>{d.title} ↗</button>)}
          {(trail.length>1 || trail.some(x=>x.entry.progress?.length)) && <details className="qh-outcome-path">
            <summary><span>查看经过</span> · {trail.length} 条日程</summary>
            <ol aria-label="关联日程">{trail.map(part=><li key={part.entry.key}>
              <div><button type="button" onClick={()=>openEntry(part.entry)}>{part.entry.title}</button>
                <small>{part.entry.done?'已完成':'未完成'}</small></div>
              {part.entry.progress?.map(p=><p key={p.id}><time dateTime={p.at}>{stamp(p.at)}</time>{p.text}</p>)}
              {part.resultText && <p><time dateTime={part.at}>{stamp(part.at)}</time>{part.resultText}</p>}
              {part.entry.key!==entry.key && <>
                {part.outcome?.url && outcomeUrl(part.outcome.url) && <a href={outcomeUrl(part.outcome.url)} target="_blank" rel="noreferrer">打开材料 ↗</a>}
                {'noteId' in part.entry && <MaterialFiles files={part.outcome?.files} noteId={part.entry.noteId}/>}
                {'projectId' in part.entry && part.entry.taskId && part.delivered.map(d=><button type="button" key={d.id}
                  onClick={()=>'projectId' in part.entry && onOpenResult(part.entry.projectId,part.entry.taskId!,d.itemId,d.id)}>{d.title} ↗</button>)}
                {part.todo && 'noteId' in part.entry && part.entry.done && <button type="button" onClick={()=>'noteId' in part.entry && onRecord(part.entry.noteId,part.todo!,'record')}>编辑这条结果</button>}
              </>}
            </li>)}</ol>
          </details>}
        </div>
        {todo && 'noteId' in entry && <button type="button" className="qh-shelf-edit"
          onClick={()=>onRecord(entry.noteId,todo,waiting?'receive':'record')}>{waiting?'记下收到的材料':hasMaterial?'编辑结果':'记录结果'}</button>}
      </li>;})}</ul>
    {visible.length>limit && <button className="qh-outcome-more" type="button" onClick={()=>setLimit(limit+10)}>查看更多记录</button>}
  </section>;
}
