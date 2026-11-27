import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { taskKey } from '../../data/collaboration';
import { planningTask, type PlannedTask } from '../../data/projectPlanning';
import type { Snapshot } from '../../data/types';
import { Icon } from '../ui/Icon';
import { NoteDispatchTrail, type OpenNoteSource } from './NoteDispatchTrail';
import type { BoardResult } from '../homepage/homeBoardData';
import type { NoteWorkChange } from '../../data/noteWorkSharing';
import { AnnotationHistory } from '../journal/AnnotationHistory';
import { TaskAttachmentsPanel } from '../workspace/TaskAttachments';
import type { ProjectTreeRow } from './ProjectGantt';
import type { ProjectRegisterNode } from './projectRegister';

function percentage(node: ProjectRegisterNode) {
  if (node.progress?.total) return Math.round(100 * node.progress.done / node.progress.total);
  if (node.bucket === 'done') return 100;
  if (node.bucket === 'pending' && node.kind !== 'project') return 0;
}

function shortDate(date: string) { return date.slice(5).replace('-', '/'); }

function dateRange(plan: PlannedTask) {
  if (plan.start && plan.end && plan.start !== plan.end) return shortDate(plan.start) + ' – ' + shortDate(plan.end);
  const date = plan.end || plan.start;
  return date ? shortDate(date) : '未排期';
}

export function ProjectCover({project}: {project:Snapshot['project']}) {
  const style = { '--cover': project.color || '#436fba' } as CSSProperties;
  return <span aria-hidden="true" className="qm-project-cover" style={style}><i/><b/></span>;
}

function Progress({node}: {node:ProjectRegisterNode}) {
  const value = percentage(node);
  if (value === undefined) return <span className="qm-unknown" aria-label="暂无进度">—</span>;
  const description = node.progress ? node.progress.done + '/' + node.progress.total + ' 项' + node.progress.label + '完成' : node.state;
  return <span className={'qm-meter '+node.bucket} title={description}>
    <progress value={value} max={100} aria-label={description}/><small>{value}%</small>
  </span>;
}

function inProgress(node: ProjectRegisterNode) {
  return node.bucket === 'running' || node.bucket === 'attention'
    || (node.bucket === 'pending' && (node.progress?.done ?? 0) > 0);
}

export function ProjectRail({snapshots,registers,activeId,create,select}: {
  snapshots:Snapshot[];registers:Map<Snapshot,ProjectRegisterNode>;activeId:string;create:()=>void;select:(id:string)=>void;
}) {
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'all'|'running'|'done'>('all');
  const groups = {
    all:snapshots,
    running:snapshots.filter(snapshot=>inProgress(registers.get(snapshot)!)),
    done:snapshots.filter(snapshot=>registers.get(snapshot)!.bucket==='done'),
  };
  const query=search.trim().toLocaleLowerCase();
  const shown=groups[filter].filter(snapshot=>snapshot.project.name.toLocaleLowerCase().includes(query));
  return <aside className="qp-project-rail qm-project-rail" aria-label="我的项目">
    <div className="qp-rail-head"><h1>我的项目</h1><button type="button" className="qp-btn primary" onClick={create}><Icon name="plus" size={14}/>新建项目</button></div>
    <label className="qp-rail-search"><Icon name="search" size={15}/><input type="search" aria-label="筛选项目" placeholder="搜索项目…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <div className="qm-project-filters" aria-label="项目状态筛选">
      {([['all','全部'],['running','进行中'],['done','已完成']] as const).map(([id,label])=><button type="button" aria-pressed={filter===id} key={id} onClick={()=>setFilter(id)}>{label} <span>{groups[id].length}</span></button>)}
    </div>
    <div className="qp-project-list">{shown.map(snapshot=>{
      const node=registers.get(snapshot)!, project=snapshot.project;
      return <button type="button" key={project.id} aria-current={project.id===activeId?'true':undefined} className={'qp-project-entry'+(project.id===activeId?' is-picked':'')} onClick={()=>select(project.id)}>
        <ProjectCover project={project}/><span className="qm-project-card-copy"><strong>{project.name}</strong><small><i className={'qm-state-dot '+node.bucket}/>{node.state}{project.deadline?' · '+shortDate(project.deadline):''}</small>
        {node.progress&&<Progress node={node}/>}</span>
      </button>;
    })}</div>
    {!!snapshots.length&&!shown.length&&<p className="qp-register-empty" role="status">{query?'没有匹配的项目':'这个状态下还没有项目'}</p>}
  </aside>;
}

function SummaryTaskInspector({row,noteCount,close,open,onOpenNote,onAttention,results,showResult}: {
  row:ProjectTreeRow;noteCount:number;close:()=>void;open:()=>void;onOpenNote:OpenNoteSource;
  onAttention:(id:string)=>void;results:BoardResult[];showResult:(id:string)=>void;
}) {
  const {snapshot,node}=row;
  const key=taskKey(node.taskId!,node.itemId);
  const record=snapshot.collaboration?.tasks[key];
  const spec=snapshot.collaboration?.specs.find(spec=>spec.key===key&&spec.revision===record?.specRevision);
  const timing=planningTask(snapshot,node.taskId!,node.itemId);
  const noteTask=!node.itemId && snapshot.tasks[node.taskId!]?.inputs?.some(input=>input.noteSource) ? snapshot.tasks[node.taskId!] : undefined;
  const [section,setSection]=useState<'detail'|'discussion'|'files'>('detail');
  const [discussionVisited,setDiscussionVisited]=useState(false);
  const target=node.itemId?snapshot.orchestrations?.[node.taskId!]?.items[node.itemId]:snapshot.tasks[node.taskId!];
  const panel=useRef<HTMLElement>(null);
  const title=useRef<HTMLHeadingElement>(null);
  const trigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const focused=document.activeElement;
    if(focused instanceof HTMLElement && !panel.current?.contains(focused)) trigger.current=focused;
    title.current?.focus({preventScroll:true});
    if(window.matchMedia('(max-width:1050px)').matches) panel.current?.scrollIntoView({block:'nearest'});
  },[node.key]);
  const dismiss=()=>{close();trigger.current?.focus({preventScroll:true});};
  return <aside ref={panel} className="qp-panel qm-task-inspector" aria-label="任务详情" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();dismiss();}}}>
    <header><h3>任务详情</h3><button type="button" className="qp-icon" aria-label="关闭任务详情" onClick={dismiss}><Icon name="close" size={17}/></button></header>
    <h4 ref={title} tabIndex={-1}>{node.title}</h4><span className={'qp-state-badge '+node.bucket}>{node.state}</span>
    <nav className="qm-inspector-nav" aria-label="任务详情分栏">
      <button type="button" aria-pressed={section==='detail'} onClick={()=>setSection('detail')}>详情</button>
      <button type="button" aria-pressed={section==='discussion'} onClick={()=>{setDiscussionVisited(true);setSection('discussion');}}>讨论{noteCount>0&&<small>{noteCount}</small>}</button>
      <button type="button" aria-pressed={section==='files'} onClick={()=>setSection('files')}>相关资料{!!target?.attachments?.length&&<small>{target.attachments.length}</small>}</button>
    </nav>
    {section==='detail'&&<>
    {noteTask && <NoteDispatchTrail key={noteTask.id} task={noteTask} results={results} onResult={showResult} onOpenNote={onOpenNote}/>}
    {node.attention && node.attention.kind!=='review' && <button type="button" className="qp-btn" onClick={()=>onAttention(node.attention!.id)}><Icon name="alert" size={14}/>{node.attention.label} · {node.attention.action}</button>}
    {!noteTask&&<><section><h5><Icon name="check-square" size={16}/>任务目标</h5><p>{spec?.goal || node.description || node.title}</p></section>
    <section><h5><Icon name="check-square" size={16}/>验收标准</h5>{spec?.criteria.length?<ul>{spec.criteria.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p className="qm-unknown">尚未填写</p>}</section></>}
    <dl><div><dt><Icon name="user" size={15}/>负责人</dt><dd>{node.owner||'待分配'}</dd></div>
      {(!noteTask||timing.start||timing.end)&&<div><dt><Icon name="calendar" size={15}/>时间</dt><dd title={[timing.start,timing.end].filter(Boolean).join(' 至 ')}>{dateRange(timing)}</dd></div>}
      {(!noteTask||timing.priority)&&<div><dt><Icon name="pin" size={15}/>优先级</dt><dd>{timing.priority||'未设置'}</dd></div>}
      {(!noteTask||node.progress)&&<div><dt><Icon name="chart" size={15}/>进度</dt><dd><Progress node={node}/></dd></div>}</dl></>}
    {discussionVisited&&<div className="qm-inspector-content" hidden={section!=='discussion'}>
      <AnnotationHistory key={node.key} taskId={node.taskId} itemId={node.itemId} inline/>
      {timing.conclusion&&<section className="qm-inspector-conclusion"><h5><Icon name="bulb" size={15}/>研究结论</h5><p>{timing.conclusion}</p></section>}
    </div>}
    {section==='files'&&<div className="qm-inspector-content"><TaskAttachmentsPanel key={node.key} taskId={node.taskId!} workItemId={node.itemId}/></div>}
    <button className="qp-btn primary" type="button" onClick={open}>打开任务<Icon name="arrow-right" size={15}/></button>
  </aside>;
}

function WorkChanges({changes,allRows,select}:{changes:NoteWorkChange[];allRows:ProjectTreeRow[];select:(row:ProjectTreeRow)=>void}) {
  if(!changes.length) return null;
  const [latest,...older]=[...changes].sort((a,b)=>b.at.localeCompare(a.at));
  const render=(change:NoteWorkChange)=><div key={change.id} className="qn-change">
    <strong>{change.title}</strong><p>{change.detail}</p><nav aria-label="涉及的任务">{[...new Set([change.taskId,...change.relatedTaskIds])].map(id=>{
      const row=allRows.find(row=>row.node.taskId===id&&!row.node.itemId);
      return row && <button type="button" key={id} onClick={()=>select(row)}>{row.node.title}<Icon name="chevron-right" size={12}/></button>;
    })}</nav></div>;
  return <section className="qp-panel qn-work-changes" aria-label="分工变动"><h3 className="qn-changes-title"><Icon name="user" size={16}/>分工变动</h3>
    {render(latest)}{older.length>0 && <details><summary>之前的 {older.length} 次变动</summary>{older.map(render)}</details>}</section>;
}

export function ProjectOverview({snapshot,project,rows,allRows,selected,noteCount,tree,select,close,open,addTask,children,results,showResult,onOpenNote,onAttention}: {
  snapshot:Snapshot;project:ProjectRegisterNode;rows:ProjectTreeRow[];allRows:ProjectTreeRow[];selected?:ProjectTreeRow;noteCount:number;
  results:Map<string,BoardResult[]>;showResult:(row:ProjectTreeRow,id:string)=>void;onOpenNote:OpenNoteSource;onAttention:(id:string)=>void;
  tree:(row:ProjectTreeRow)=>ReactNode;select:(row:ProjectTreeRow)=>void;close:()=>void;open:(row:ProjectTreeRow)=>void;addTask:()=>void;children:ReactNode;
}) {
  const [view,setView]=useState<'all'|'running'|'attention'|'returned'>('all');
  const hasResult=(row:ProjectTreeRow)=>results.has(taskKey(row.node.taskId!,row.node.itemId));
  const groups={all:allRows,running:allRows.filter(row=>row.node.bucket==='running'),attention:allRows.filter(row=>row.node.attention),returned:allRows.filter(hasResult)};
  const visible=view==='all'?rows:groups[view];
  const attention=allRows.find(row=>row.node.attention)??allRows.find(row=>row.node.bucket==='attention');
  const milestones=allRows.map(row=>({row,timing:planningTask(snapshot,row.node.taskId!,row.node.itemId)}))
    .filter(({timing})=>timing.milestone).sort((a,b)=>(a.timing.end??a.timing.start??'9999').localeCompare(b.timing.end??b.timing.start??'9999'));
  return <div className={'qm-overview-layout'+(selected?' has-inspector':'')}><div className="qp-overview qm-overview">
    <section className="qp-panel qm-progress-panel" aria-label="项目进度">
      <div className="qm-progress-line"><h3>项目进度</h3>{project.progress?<Progress node={project}/>:<span className="qm-unknown">尚无任务</span>}</div>
      <dl className="qm-facts">{snapshot.project.description&&<div><dt><Icon name="check-square" size={15}/>项目目标</dt><dd>{snapshot.project.description}</dd></div>}
        {snapshot.project.deadline&&<div><dt><Icon name="calendar" size={15}/>截止时间</dt><dd>{snapshot.project.deadline}</dd></div>}
        {snapshot.project.ownerName&&<div><dt><Icon name="user" size={15}/>负责人</dt><dd>{snapshot.project.ownerName}</dd></div>}
        <div><dt><Icon name="alert" size={15}/>风险与待办</dt><dd>{attention?<button type="button" className="qp-quiet" onClick={()=>select(attention)}>{attention.node.attention?.label||attention.node.state} · {attention.node.title}</button>:'暂无待处理事项'}</dd></div>
      </dl>
    </section>
    <section className="qp-panel qm-plan-panel"><header><h3>任务计划</h3><button type="button" className="qp-btn" onClick={addTask}><Icon name="plus" size={14}/>新建任务</button></header>
      {allRows.length>0 && <nav className="qm-views" aria-label="筛选任务计划">
        {([['all','全部'],['running','执行中'],['attention','需处理'],['returned','有成果']] as const).map(([key,label])=>
          <button type="button" key={key} data-tone={key} aria-pressed={key===view} onClick={()=>setView(key)}>{key!=='all'&&<i/>}{label}<small>{groups[key].length}</small></button>)}
      </nav>}
      {visible.length?<div className="qp-schedule-list qm-task-table"><table><thead><tr><th>任务</th><th>负责人</th><th>时间</th><th>状态</th><th>进度</th></tr></thead>
        <tbody>{visible.map(row=>{
          const timing=planningTask(row.snapshot,row.node.taskId!,row.node.itemId);
          return <tr key={row.node.key} data-selected={row.node.key===selected?.node.key||undefined} onClick={event=>{if(!(event.target as Element).closest('button')) select(row);}}>
            <td>{tree(row)}</td><td>{row.node.owner||'待分配'}</td><td title={[timing.start,timing.end].filter(Boolean).join(' 至 ')}>{dateRange(timing)}</td>
            <td><span className={'qp-state-badge '+row.node.bucket}>{row.node.state}</span></td><td><Progress node={row.node}/></td></tr>;
        })}</tbody></table></div>:<p className="qp-empty">{view==='all'?'还没有任务':'没有符合条件的任务'}</p>}
    </section>
    <WorkChanges changes={snapshot.noteWorkChanges??[]} allRows={allRows} select={select}/>
    {milestones.length>0&&<section className="qp-panel qm-milestone-panel"><h3>里程碑</h3><ol>
      {milestones.map(({row,timing})=><li key={row.node.key} className={row.node.bucket}><button type="button" onClick={()=>select(row)}>
        <span className="qm-milestone-pin">{row.node.bucket==='done'&&<Icon name="check" size={11}/>}</span><strong>{row.node.title}</strong><small>{timing.end?shortDate(timing.end):timing.start?shortDate(timing.start):'未排期'}</small></button></li>)}
    </ol></section>}
    {children}
  </div>{selected&&<SummaryTaskInspector onOpenNote={onOpenNote} onAttention={onAttention} results={results.get(taskKey(selected.node.taskId!,selected.node.itemId))??[]} showResult={id=>showResult(selected,id)} row={selected} noteCount={noteCount} close={close} open={()=>open(selected)}/>}</div>;
}
