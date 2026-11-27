import { useMemo, useState } from 'react';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import type { NoteSourceRef } from '../../data/noteTaskSource';
import type { Snapshot } from '../../data/types';
import { NoteTaskDialog, type NoteTaskSource } from '../knowledge/NoteTaskDialog';
import { Icon } from '../ui/Icon';
import { HomeBoardDetail, type BoardNavigation } from './HomeBoardDetail';
import { boardSearchIndex, boardStates, cardTakeaway, homeBoardCards, type BoardCard } from './homeBoardData';
import './home-board.css';

export interface BoardProps extends BoardNavigation {
  projects: Snapshot[]; notes: KnowledgeNote[]; legacyNoteSources: ReadonlyMap<string,NoteSourceRef>;
  onCreateTask: (projectId?: string) => void; expanded?: boolean; today?: string;
}
const lanes = Object.entries(boardStates) as [keyof typeof boardStates, string][];
function dueDate(due: string) {
  if (due.length === 10) return due.slice(5).replace('-','/');
  return new Date(due).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
}
function BoardTile({card, open}: {card: BoardCard; open: () => void}) {
  const update = cardTakeaway(card);
  return <button type="button" className="qhb-tile" onClick={open} aria-label={'查看任务 '+card.title}>
    <span className="qhb-context"><Icon name={card.projectId?'folder':'check-square'} size={12}/>{card.project}</span>
    <strong>{card.title}</strong>
    {update && <span className="qhb-update" title={update.text}><span>{update.label}</span>{update.text}</span>}
    <span className="qhb-tile-meta"><span><Icon name={card.owners.includes('agent')?'flask':'user'} size={12}/>{card.ownerName}</span>
      {card.reason ? <small className="qhb-reason">{card.reason}</small> : card.due && <small><Icon name="calendar" size={11}/>{dueDate(card.due)}</small>}</span>
  </button>;
}

export function HomeBoard({projects,notes,legacyNoteSources,today,expanded,onCreateTask,...actions}: BoardProps) {
  const cards=useMemo(()=>homeBoardCards(projects,notes,legacyNoteSources,Date.now()),[projects,notes,legacyNoteSources,today]);
  const index=useMemo(()=>cards.map(card=>({card,search:boardSearchIndex(card)})),[cards]);
  const [project,setProject]=useState(''), [owner,setOwner]=useState(''), [query,setQuery]=useState('');
  const [more,setMore]=useState<string[]>([]);
  const [selection,setSelection]=useState(''), [send,setSend]=useState<NoteTaskSource>();
  const projectFilter=project==='personal' || projects.some(s=>s.project.id===project) ? project : '';
  const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible=index.filter(({card,search})=>(!projectFilter || (card.projectId??'personal')===projectFilter)
    && (!owner || card.owners.some(value=>value===owner)) && words.every(word=>search.includes(word))).map(row=>row.card);
  const hasFilters=!!(projectFilter||owner||words.length);
  const returned = visible.filter(card=>card.results.length).sort((a,b)=>b.results[0].at.localeCompare(a.results[0].at))[0];
  const selected = cards.find(card=>card.key===selection);
  function onOpenResult(card: BoardCard) {
    const result = card.results[0];
    if (card.projectId && card.taskId && result) actions.onOpenBoardTask(card.projectId,card.taskId,result.itemId,result.id);
  }
  const reset=()=>{setProject('');setOwner('');setQuery('');setMore([]);};
  return <div className="qhb-board">
    <div className="qhb-filters"><label className="qhb-search"><Icon name="search" size={15}/><input type="search" aria-label="搜索看板" placeholder="搜索任务、原想法、成果…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <select aria-label="看板项目" value={projectFilter} onChange={e=>setProject(e.target.value)}>
        <option value="">全部项目</option><option value="personal">个人待办</option>{projects.map(s=><option key={s.project.id} value={s.project.id}>{s.project.name}</option>)}</select>
      <select aria-label="看板负责人" value={owner} onChange={e=>setOwner(e.target.value)}>
        <option value="">全部负责人</option><option value="me">我负责</option><option value="agent">AI 负责</option><option value="unassigned">待分派</option></select>
      <button type="button" className="qhb-new" onClick={()=>onCreateTask(projectFilter && projectFilter!=='personal' ? projectFilter : undefined)}><Icon name="plus" size={14}/>新建任务</button>
    </div>
    {returned && <div className="qhb-brief"><Icon name="box" size={14}/><span>最近交回</span>
      <button type="button" onClick={()=>onOpenResult(returned)}>{returned.results[0].title}<Icon name="arrow-right" size={13}/></button>
      <small>{returned.project}</small></div>}
    {!visible.length && hasFilters ? <div className="qhb-empty"><span>没有找到符合条件的任务</span><button type="button" onClick={reset}>清除筛选</button></div> :
    <div className="qhb-lanes">{lanes.map(([state,label])=>{
      const rows=visible.filter(card=>card.state===state);
      const limit=expanded || more.includes(state) ? rows.length : 3;
      return <section className={'qhb-lane '+state} key={state} aria-label={label}>
        <h3><span className={'qhb-dot '+state}/>{label}<small aria-label={rows.length+' 项'}>{rows.length}</small></h3>
        {rows.slice(0,limit).map(card=><BoardTile key={card.key} card={card} open={()=>setSelection(card.key)}/>)}
        {!rows.length && <p className="qhb-lane-empty">暂无任务</p>}
        {rows.length>limit && <button type="button" className="qhb-more" onClick={()=>setMore(prev=>[...prev,state])}>另有 {rows.length-limit} 项<Icon name="chevron-down" size={13}/></button>}
        {!expanded && more.includes(state) && rows.length>3 && <button type="button" className="qhb-more" onClick={()=>setMore(prev=>prev.filter(s=>s!==state))}>收起</button>}
      </section>;
    })}</div>}
    {selected && <HomeBoardDetail key={selected.key} card={selected} notes={notes} {...actions} onClose={()=>setSelection('')} onSend={s=>{setSelection('');setSend(s);}}/>}
    {send && <NoteTaskDialog source={send} onClose={()=>setSend(undefined)}/>}
  </div>;
}
