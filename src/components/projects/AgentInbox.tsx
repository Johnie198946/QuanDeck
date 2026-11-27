import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { canRetryDispatch } from '../../data/dispatchRecovery';
import { resultExcerpt } from '../../data/resultExcerpt';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import type { OpenNoteSource } from './NoteDispatchTrail';
import { formatInboxTime, inboxRows, type InboxFilter, type InboxRow } from './agentInboxData';
import { InboxTaskDetail } from './InboxTaskDetail';
import type { ProjectBoardEntry } from './ProductProjects';
import './agent-inbox.css';

const filters = [['all','全部'],['running','执行中'],['returned','有成果'],['attention','需处理']] as const;

function matches(row: InboxRow, filter: InboxFilter) {
  return filter === 'all' || (filter === 'returned' ? row.results.length>0 : row.group === filter);
}

function preview(row: InboxRow) {
  if (row.problem) return resultExcerpt(row.problem,85);
  if (row.group === 'running') return row.session?.step?.label;
  return row.results.length ? resultExcerpt(row.results[0].record.text,85) : undefined;
}

function nextAction(row: InboxRow) {
  if (row.attention?.blockedSessionId) return '补材料';
  if (row.attention?.kind === 'question') return '回复';
  if (row.attention?.kind === 'permission') return '查看授权';
  if (row.attention?.kind === 'decision') return '确认方案';
  if (canRetryDispatch(row.session)) return '重试发送';
  if (row.canDispatch) return '发任务';
  if (row.group === 'attention') return '查看原因';
  if (row.group === 'running') return '看进展';
  return row.results.length ? '看成果' : '查看';
}

interface Props {
  initial?: ProjectBoardEntry;
  onWriteNote:()=>void;
  onOpenNote:OpenNoteSource;
  onAttention:(id:string)=>void;
  onTools:(projectId?:string)=>void;
  onEditProject?:(projectId:string)=>void;
}

export function AgentInbox(props:Props) {
  // Different incoming links can point to different versions of the same task.
  const { initial } = props;
  return <InboxView key={JSON.stringify([initial?.projectId,initial?.taskId,initial?.itemId,initial?.resultId,initial?.attentionId])} {...props}/>;
}

function InboxView({initial,onWriteNote,onOpenNote,onAttention,onTools,onEditProject}:Props) {
  const {snap,projectSnapshots} = useWorkdeck();
  const projects = useMemo(()=>{
    const byId=new Map(projectSnapshots.map(project=>[project.project.id,project]));
    if (snap.project.id) byId.set(snap.project.id,snap);
    return [...byId.values()].filter(project=>project.project.id && !project.project.deletedAt);
  },[snap,projectSnapshots]);
  const [projectId,setProjectId]=useState(initial?.projectId ?? '');
  const [target,setTarget]=useState(initial);
  const rows=useMemo(()=>inboxRows(projects.filter(project=>!projectId || project.project.id===projectId),target),[projects,projectId,target]);
  const [filter,setFilter]=useState<InboxFilter>('all');
  const [opened,setOpened]=useState(initial?.taskId ? JSON.stringify([initial.projectId,initial.taskId]) : undefined);
  const rowRef=useRef<HTMLLIElement>(null);
  const reveal=useRef(!!initial?.taskId);
  const menu=useRef<HTMLDetailsElement>(null);
  const detailId=useId();
  useEffect(()=>{
    if (reveal.current && rowRef.current) {
      rowRef.current.scrollIntoView({block:'nearest'});
      reveal.current=false;
    }
  },[rows]);

  const selection=projects.find(project=>project.project.id===projectId);
  const menuProject=selection?.project ?? snap.project;
  const visible=rows.filter(row=>matches(row,filter));
  const resetSelection=()=>{
    setOpened(undefined);
    setTarget(undefined);
  };
  function closeMenu(restoreFocus=false) {
    if (!menu.current?.open) return;
    menu.current.open=false;
    if (restoreFocus) menu.current.querySelector('summary')?.focus();
  }
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      if (event.target instanceof Node && !menu.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener('pointerdown',outside);
    return ()=>document.removeEventListener('pointerdown',outside);
  },[]);

  return <main aria-label="Agent 任务收件箱" className="qi-inbox">
    <header className="qi-head"><h1>帮你管</h1>
      <div className="qi-head-actions">
        <details ref={menu} className="qi-menu" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeMenu(true);}}}
          onBlur={event=>{if(event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeMenu();}}>
          <summary aria-label="项目菜单"><Icon name="folder" size={15}/><span>{selection?.project.name || '项目'}</span><Icon name="chevron-down" size={13}/></summary>
          <div className="qi-menu-panel">
            <label>查看项目<select aria-label="查看项目" value={projectId} onChange={event=>{setProjectId(event.target.value);setFilter('all');resetSelection();closeMenu(true);}}>
              <option value="">全部项目</option>
              {projects.map(project=><option key={project.project.id} value={project.project.id}>{project.project.name}</option>)}
            </select></label>
            {menuProject.id && <div className="qi-menu-tools"><small>{menuProject.name}</small>
              {onEditProject && <button type="button" onClick={()=>{closeMenu(true);onEditProject(menuProject.id);}}>项目设置</button>}
              <button type="button" onClick={()=>{closeMenu(true);onTools(menuProject.id);}}>项目工具</button>
            </div>}
            {!menuProject.id && <button type="button" onClick={()=>{closeMenu(true);onTools();}}>项目工具</button>}
          </div>
        </details>
        <button type="button" className="qp-btn primary" onClick={onWriteNote}><Icon name="pencil" size={15}/>写需求</button>
      </div>
    </header>
    <section className="qi-stream" aria-label="收到的任务">
      <nav className="qi-filters" aria-label="任务筛选">{filters.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}<span>{rows.filter(row=>matches(row,key)).length}</span></button>)}</nav>
      {initial?.taskId && target && !rows.some(row=>row.task.id===initial.taskId) && <p role="status" className="qi-missing">原任务已不可用。</p>}
      {visible.length===0 && <div className="qi-empty"><Icon name="inbox" size={30}/><h2>{rows.length?'这里暂时没有任务':'还没有发给 Agent 的任务'}</h2>
        {!rows.length && <p>在「帮你记」选中需求，点纸飞机发送。</p>}</div>}
      <ul className="qi-list">{visible.map(row=>{
        const expanded=opened===row.key;
        const excerpt=expanded ? undefined : preview(row);
        const scope=target?.taskId===row.task.id && target?.projectId===row.snapshot.project.id ? target : undefined;
        return <li key={row.key} data-open={expanded} ref={expanded ? rowRef : undefined}>
          <button type="button" className="qi-row" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
            onClick={()=>{setOpened(expanded?undefined:row.key);setTarget(undefined);}}>
            <span className={'qi-status is-'+row.group}><i/>{row.status}</span>
            <span className="qi-row-body"><strong>{row.task.title}</strong>
              <span className="qi-meta">{row.snapshot.project.name}<i/>{row.agent}</span>
              {excerpt && <span className="qi-excerpt">{excerpt}</span>}</span>
            <span className="qi-row-end"><time dateTime={row.at}>{formatInboxTime(row.at)}</time>{!expanded && row.results.length>0 && <small>{row.results.length} 项成果</small>}</span>
            <span className="qi-action">{expanded ? '收起' : nextAction(row)}<Icon name={expanded?'chevron-down':'chevron-right'} size={15}/></span>
          </button>
          {expanded && <div id={detailId}><InboxTaskDetail key={JSON.stringify([row.key,scope?.itemId,scope?.resultId])} row={row}
            itemId={scope?.itemId} resultId={scope?.resultId} onShowTask={()=>setTarget(undefined)}
            onOpenNote={onOpenNote} onAttention={onAttention}/></div>}
        </li>;
      })}</ul>
    </section>
  </main>;
}
