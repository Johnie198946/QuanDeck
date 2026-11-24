import { Fragment, useMemo, useRef, useState, type DragEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { overviewProject, type OverviewNode } from '../../data/overviewTree';
import { taskKey } from '../../data/collaboration';
import { annotationHistory } from '../../data/annotationHistory';
import { planningTask, type PlannedTask } from '../../data/projectPlanning';
import { downloadOutputFile } from '../../data/outputFiles';
import { Icon } from '../ui/Icon';
import { DeliveryMap } from '../results/DeliveryMap';
import { ResultsIntegration } from '../results/ResultsIntegration';
import { ProjectGantt, type ProjectTreeRow } from './ProjectGantt';
import { ProjectTaskDetail } from './ProjectTaskDetail';
import { PlanSuggestions } from './PlanSuggestions';
import { startProductTaskDrag } from '../deck/ProductExecution';
import type { Snapshot } from '../../data/types';
import './product-projects.css';

export {ProjectCreatePage} from './ProjectCreatePage';

const views = [['summary','总览'],['tasks','任务'],['timeline','甘特图'],['results','成果'],['memory','记忆']] as const;
type View = typeof views[number][0];
const localKey=(node:OverviewNode)=>taskKey(node.taskId??'',node.itemId);
function parentOf({node,snapshot}:ProjectTreeRow) {
  return node.taskId && node.itemId ? snapshot.orchestrations?.[node.taskId]?.items[node.itemId]?.parentTaskId || node.taskId : undefined;
}
function canReorder(from:ProjectTreeRow,to:ProjectTreeRow) {
  return !!(from.node.taskId && to.node.taskId && from.node.projectId===to.node.projectId && from.node.key!==to.node.key && parentOf(from)===parentOf(to));
}


function visibleTree(projects:Snapshot[],folded:Set<string>,includeProject:boolean,hideDone:boolean): ProjectTreeRow[] {
  return projects.flatMap(snapshot=>{
    const order = new Map((snapshot.projectPlanning?.order??[]).map((key,index)=>[key,index]));
    const ranked=(list:OverviewNode[])=>hideDone
      ? list.filter(node=>node.kind==='project'||node.bucket!=='done').sort((a,b)=>(order.get(localKey(a))??1e9)-(order.get(localKey(b))??1e9))
      : [...list].sort((a,b)=>(order.get(localKey(a))??1e9)-(order.get(localKey(b))??1e9));
    const visit=(node:OverviewNode,depth:number):ProjectTreeRow[]=>[
      {node,snapshot,depth},...(!folded.has(node.key) ? ranked(node.children).flatMap(child=>visit(child,depth+1)) : []),
    ];
    const project = overviewProject(snapshot);
    return includeProject ? visit(project,0) : ranked(project.children).flatMap(node=>visit(node,0));
  });
}

function TaskScheduleList({rows,tree,onSelect}: {rows:ProjectTreeRow[];tree:(row:ProjectTreeRow)=>React.ReactNode;onSelect:(row:ProjectTreeRow)=>void}) {
  if (!rows.length) return <p className="qp-empty">还没有任务</p>;
  return <div className="qp-schedule-list">
    <table>
      <thead><tr><th>任务</th><th>负责人</th><th>日期</th><th>状态</th></tr></thead>
      <tbody>{rows.map(row=>{
        const planned=planningTask(row.snapshot,row.node.taskId!,row.node.itemId);
        return <tr key={row.node.key} onDoubleClick={()=>onSelect(row)}><td>{tree(row)}</td><td>{row.node.owner||'—'}</td>
          <td>{planned.start&&planned.end?planned.start+' 至 '+planned.end:planned.end||planned.start||'未排期'}</td>
          <td><span className={'qp-state-badge '+row.node.bucket}>{row.node.state}</span></td></tr>;
      })}</tbody>
    </table>
  </div>;
}

const eventLabels: Record<string,string> = {
  project_created:'建立项目', task_created:'建立任务', plan_adopted:'采用方案',
  goal_plan_materialized:'确认任务计划', spec_revised:'修改任务要求', dependencies_changed:'调整前置任务',
  result_submitted:'提交成果', result_reviewed:'验收成果', decision_recorded:'记录决定',
  project_planning_changed:'更新任务计划', task_annotation_saved:'记录任务批注',
};

function ProjectMemory({snapshot,open}: {snapshot:Snapshot;open:(taskId:string,itemId?:string,results?:boolean)=>void}) {
  const c=snapshot.collaboration;
  const rows=useMemo(()=>[...(c?.events??[])].filter(event=>eventLabels[event.type]&&Number.isFinite(Date.parse(event.at)))
    .sort((a,b)=>b.at.localeCompare(a.at)||b.sequence-a.sequence),[c]);
  const [selected,setSelected]=useState('');
  const event=rows.find(row=>row.id===selected)??rows[0];
  const task=event?.taskKey ? c?.tasks[event.taskKey]:undefined;
  const review=event?.type==='result_reviewed'?c?.reviews.find(record=>record.id===event.detail):undefined;
  const submission=c?.submissions.find(record=>record.id===(review?.submissionId ?? (event?.type==='result_submitted'?event.detail:null)));
  const artifact=submission&&c?.artifacts.find(record=>record.id===submission.artifactId);
  const decision=event?.type==='decision_recorded'?c?.decisions.find(record=>record.id===event.detail):undefined;
  const annotation=event?.type==='task_annotation_saved'?c?.taskAnnotations?.find(record=>record.id===event.detail):undefined;
  const planningChange=event?.type==='project_planning_changed'?snapshot.projectPlanning?.changes?.find(change=>change.eventId===event.id):undefined;
  const safeDetail=event && ['project_created','project_planning_changed','spec_revised','task_created'].includes(event.type)?event.detail:undefined;
  const dateFormat=new Intl.DateTimeFormat('zh-CN',{day:'numeric',month:'long',year:'numeric',timeZone:snapshot.project.timeZone});
  const timeFormat=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:snapshot.project.timeZone});
  return <div className="qp-memory">
    <ol aria-label="项目时间线">
      {rows.map((row,index)=>{
        const date=dateFormat.format(new Date(row.at));
        const group=index===0||date!==dateFormat.format(new Date(rows[index-1].at));
        return <Fragment key={row.id}>
          {group&&<li className="qp-memory-date">{date}</li>}
          <li><button type="button" className={event?.id===row.id?'is-picked':''} onClick={()=>setSelected(row.id)}>
            <time dateTime={row.at}>{timeFormat.format(new Date(row.at))}</time><strong>{eventLabels[row.type]}</strong>
            <small>{row.taskKey&&c?.tasks[row.taskKey]?.title}</small>
          </button></li>
        </Fragment>;
      })}
    </ol>
    {event?<article className="qp-panel qp-memory-detail">
      <h2>{eventLabels[event.type]}</h2>
      <p className="qp-muted">{dateFormat.format(new Date(event.at))} · {timeFormat.format(new Date(event.at))}</p>
      <p>{(review?.verdict==='accepted'?'已验收。':review?'已退回。':'')+(review?.note||artifact?.title||decision?.text||annotation?.text||safeDetail||'未记录具体原因')}</p>
      {planningChange && <details><summary>查看本次变更</summary>{planningChange.fields.conclusion&&<p>{planningChange.fields.conclusion}</p>}{planningChange.fields.start&&<p>{planningChange.fields.start} 至 {planningChange.fields.end||'未设截止日期'}</p>}{planningChange.fields.researchSourceId&&<p>研究回执 {planningChange.fields.researchSourceId}</p>}{planningChange.previous?.conclusion&&planningChange.previous.conclusion!==planningChange.fields.conclusion&&<p>此前结论 · {planningChange.previous.conclusion}</p>}</details>}
      {task&&<button type="button" className="qp-btn" onClick={()=>open(task.taskId,task.workItemId,!!artifact)}><Icon name="link" size={14}/>{task.title}</button>}
      {artifact?.attachments?.map(file=><button type="button" className="qp-btn" key={file.id} onClick={()=>void downloadOutputFile(snapshot.project.id,file)}>{file.name}</button>)}
      <details><summary>来源记录</summary><p>记录 {event.id}</p>{artifact&&<p>成果 {artifact.title} · 版本 {artifact.version}</p>}</details>
    </article>:<p className="qp-empty">项目建立、任务变更和成果验收会显示在这里。</p>}
  </div>;
}

export function ProjectHub({onCreateProject,onEditProject,onOpenLegacyTasks}: {
  onCreateProject:()=>void;onEditProject:(projectId:string)=>void;onOpenLegacyTasks?:(projectId:string)=>void;
}) {
  const {snap,projectSnapshots,switchProject,refreshProjects,api,toast,openProjectDirection}=useWorkdeck();
  const [activeView,setActiveView]=useState<View>('summary');
  const [selected,setSelected]=useState<{taskId:string;itemId?:string;projectId:string}>();
  const [folded,setFolded]=useState<Set<string>>(()=>new Set());
  const [hideDone,setHideDone]=useState(false);
  const [crossProject,setCrossProject]=useState(false);
  const [editingDates,setEditingDates]=useState(false);
  const [search,setSearch]=useState('');
  const [newTask,setNewTask]=useState(false),[taskTitle,setTaskTitle]=useState(''),[subtask,setSubtask]=useState(false);
  const [busy,setBusy]=useState(false),[more,setMore]=useState(false);
  const [error,setError]=useState('');
  const drag=useRef<ProjectTreeRow|undefined>(undefined);
  const rows=useMemo(()=>visibleTree(activeView==='timeline'&&crossProject?projectSnapshots:[snap],folded,activeView==='timeline'&&crossProject,hideDone),
    [activeView,crossProject,projectSnapshots,snap,folded,hideDone]);
  const unfiltered=useMemo(()=>visibleTree([snap],new Set(),false,false),[snap]);
  const current=rows.find(row=>row.node.taskId===selected?.taskId&&row.node.itemId===selected?.itemId&&row.node.projectId===selected?.projectId)??rows.find(row=>row.node.taskId&&row.node.projectId===snap.project.id);
  const projectNode=useMemo(()=>overviewProject(snap),[snap]);
  const annotationCounts=useMemo(()=>{
    const projects = new Map((activeView==='timeline'&&crossProject?projectSnapshots:[snap]).map(snapshot=>[snapshot.project.id,snapshot]));
    const counts=new Map<string,number>();
    for (const [projectId,snapshot] of projects) for (const row of annotationHistory(snapshot)) {
      if(row.state!=='current'||!(row.kind==='note'||row.kind==='discussion')||!row.taskId)continue;
      const key=JSON.stringify([projectId,row.taskId,row.itemId??null]);
      counts.set(key,(counts.get(key)??0)+1);
    }
    return counts;
  },[snap,activeView,crossProject,projectSnapshots]);
  const openTask=(taskId:string,itemId?:string,results=false)=>{
    setSelected({projectId:snap.project.id,taskId,itemId});
    setActiveView(results?'results':'tasks');
  };
  const pickRow=(row:ProjectTreeRow,open=false)=>{
    if(!row.node.taskId) {void switchProject(row.node.projectId);return;}
    setSelected({projectId:row.node.projectId,taskId:row.node.taskId,itemId:row.node.itemId});
    if(row.node.projectId!==snap.project.id)void switchProject(row.node.projectId);
    if(open && activeView==='summary') setActiveView('tasks');
  };
  const fold=(key:string)=>setFolded(prev=>{
    const next=new Set(prev);
    if(next.has(key))next.delete(key);else next.add(key);
    return next;
  });
  const moveOrder=async(from:ProjectTreeRow,to:ProjectTreeRow,event:DragEvent)=>{
    if(!api.updateProjectPlanning||!canReorder(from,to))return;
    const bounds=event.currentTarget.getBoundingClientRect();
    const all=visibleTree([from.snapshot],new Set(),false,false);
    const values=all.map(row=>localKey(row.node)).filter(key=>key!==localKey(from.node));
    values.splice(values.indexOf(localKey(to.node))+(event.clientY>bounds.top+bounds.height/2?1:0),0,localKey(from.node));
    try {
      const receipt=await api.updateProjectPlanning(from.node.projectId,{kind:'order',order:values,expectedRevision:from.snapshot.projectPlanning?.revision??0});
      if(!receipt.ok)throw Error(receipt.message||'未调整顺序');
      await refreshProjects();
    } catch(cause){toast(cause instanceof Error?cause.message:'未调整顺序','error');}
  };
  const tree=(row:ProjectTreeRow)=>{
    const {node}=row;
    const count=annotationCounts.get(node.key)??0;
    return <div className={'qp-tree-row'+(node.key===current?.node.key?' is-picked':'')} style={{paddingInlineStart:Math.min(36,row.depth*15)+8}}
      draggable={!!node.taskId} onDragStart={event=>{if(!node.taskId)return;drag.current=row;startProductTaskDrag(event,{projectId:node.projectId,taskId:node.taskId,itemId:node.itemId});}}
      onDragEnd={()=>{drag.current=undefined;}} onDragOver={event=>{if(drag.current&&canReorder(drag.current,row))event.preventDefault();}}
      onDrop={event=>{if(!drag.current)return;event.preventDefault();void moveOrder(drag.current,row,event);drag.current=undefined;}}>
      {node.children.length?<button type="button" className="qp-icon qp-fold" aria-expanded={!folded.has(node.key)} aria-label={(folded.has(node.key)?'展开 ':'收起 ')+node.title} onClick={()=>fold(node.key)}><Icon name={folded.has(node.key)?'chevron-right':'chevron-down'} size={13}/></button>:<span className={'qp-tree-state '+node.bucket} title={node.state}><Icon name={node.bucket==='done'?'check-circle':node.kind==='project'?'folder':'dot'} size={13}/></span>}
      <button type="button" className="qp-tree-link" aria-current={node.key===current?.node.key?'true':undefined} onClick={()=>pickRow(row,true)}>{node.title}</button>
      {count>0&&<span className="qp-tree-notes" aria-label={count+' 条批注'} title={count+' 条批注'}><Icon name="message" size={12}/>{count}</span>}
    </div>;
  };
  const saveSchedule=async(row:ProjectTreeRow,fields:PlannedTask,expected:PlannedTask)=>{
    if(!row.node.taskId||!api.updateProjectPlanning)return false;
    try {
      const latest=(await api.listProjects()).find(value=>value.project.id===row.node.projectId);
      if(!latest)throw Error('项目已不存在');
      const actual=planningTask(latest,row.node.taskId,row.node.itemId);
      if(actual.start!==expected.start||actual.end!==expected.end)throw Error('日期已变化，请核对后再改');
      const result=await api.updateProjectPlanning(row.node.projectId,{kind:'task',taskId:row.node.taskId,itemId:row.node.itemId,expectedRevision:latest.projectPlanning?.revision??0,fields:{...actual,start:fields.start,end:fields.end}});
      if(!result.ok)throw Error(result.message||'排期未保存');
      await refreshProjects(); toast('排期已更新');return true;
    } catch(cause){toast(cause instanceof Error?cause.message:'排期未保存','error');return false;}
  };
  const addTask=async()=>{
    const title=taskTitle.trim();
    if(!title||busy)return;
    setBusy(true);setError('');
    try {
      if(activeView==='tasks'&&subtask&&current?.node.taskId){
        const id=current.node.taskId;
        const result=await api.addManualSubtask(id,current.node.itemId??id,title);
        if(!result.ok||!result.itemId) throw Error(result.message||'子任务未创建');
        if(folded.has(current.node.key))fold(current.node.key);
        openTask(id,result.itemId);
      } else {
        const result=await api.createTaskWithAttachments(title,[],snap.project.id);
        if(!result.ok||!result.taskId) throw Error(result.message||'任务未创建');
        openTask(result.taskId);
      }
      setTaskTitle('');setNewTask(false);setSubtask(false);
    } catch(cause){setError(cause instanceof Error?cause.message:'任务未创建');}
    finally{setBusy(false);}
  };
  const shown=projectSnapshots.filter(snapshot=>snapshot.project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const detailsKey = current?.node.key + ':' + editingDates;
  return <main className="qp-hub">
    <aside className="qp-project-rail" aria-label="我的项目">
      <div className="qp-rail-head"><h1>我的项目</h1><button type="button" className="qp-btn primary" onClick={onCreateProject}><Icon name="plus" size={15}/>新建项目</button></div>
      {projectSnapshots.length>5&&<label className="qp-rail-search"><Icon name="search" size={15}/><input type="search" aria-label="筛选项目" value={search} onChange={event=>setSearch(event.target.value)}/></label>}
      <div className="qp-project-list">{shown.map(snapshot=>{
        const value=overviewProject(snapshot);
        return <button type="button" key={snapshot.project.id} aria-current={snapshot.project.id===snap.project.id?'true':undefined} className={'qp-project-entry'+(snapshot.project.id===snap.project.id?' is-picked':'')}
          onClick={()=>{void switchProject(snapshot.project.id);setSelected(undefined);setEditingDates(false);setMore(false);}}>
          <span className="qp-project-icon"><Icon name="folder" size={18}/></span><span><strong>{snapshot.project.name}</strong><small>{value.state}{snapshot.project.deadline?' · '+snapshot.project.deadline:''}</small></span></button>;
      })}</div>
    </aside>
    {!snap.project.id?<section className="qp-stage qp-empty"><h2>开始一个项目</h2><button type="button" className="qp-btn primary" onClick={onCreateProject}>新建项目</button></section>:<section className="qp-stage">
      <header className="qp-head qp-project-head"><div><div className="qp-kicker">帮你管</div><h2>{snap.project.name}</h2>{snap.project.description&&<p>{snap.project.description}</p>}</div>
        <div className="qp-project-head-actions"><button className="qp-icon" type="button" aria-expanded={more} aria-label="更多项目操作" onClick={()=>setMore(!more)}>···</button>
          {more&&<div className="qp-project-menu qp-panel"><button type="button" className="qp-quiet" onClick={()=>{setMore(false);onEditProject(snap.project.id);}}>项目设置</button><button type="button" className="qp-quiet" onClick={()=>{setMore(false);void openProjectDirection(snap.project.id);}}>项目方向</button>
            {onOpenLegacyTasks&&<button type="button" className="qp-quiet" onClick={()=>onOpenLegacyTasks(snap.project.id)}>完整任务记录</button>}</div>}</div>
      </header>
      <nav className="qp-tabs" aria-label="项目页签">{views.map(([key,label])=><button type="button" key={key} aria-current={activeView===key?'page':undefined} onClick={()=>{setActiveView(key);setEditingDates(false);}}>{label}</button>)}</nav>
      {(activeView==='tasks'||activeView==='summary')&&<div className="qp-toolbar qp-actions">
        <button type="button" className="qp-btn" onClick={()=>setNewTask(!newTask)}><Icon name="plus" size={15}/>新建任务</button>
        {activeView==='tasks'&&<label><input type="checkbox" checked={hideDone} onChange={event=>setHideDone(event.target.checked)}/> 隐藏已完成</label>}
      </div>}
      {newTask&&(activeView==='tasks'||activeView==='summary')&&<form className="qp-new-task qp-actions" onSubmit={event=>{event.preventDefault();void addTask();}}>
        <input aria-label="新任务名称" value={taskTitle} maxLength={200} onChange={event=>setTaskTitle(event.target.value)} required />
        {current&&activeView==='tasks'&&<label><input type="checkbox" checked={subtask} onChange={event=>setSubtask(event.target.checked)}/> 作为子任务</label>}
        <button type="submit" className="qp-btn primary" disabled={busy||!taskTitle.trim()}>确认添加</button><button type="button" className="qp-btn" onClick={()=>setNewTask(false)}>取消</button>
        {error&&<p role="alert" className="qp-error">{error}</p>}
      </form>}
      {activeView==='summary'&&<div className="qp-overview">
        <section className="qp-panel qp-summary"><strong>项目进度</strong><div>{projectNode.progress?<>
          <progress max={projectNode.progress.total} value={projectNode.progress.done} aria-label="项目进度"/><small>{projectNode.progress.done} / {projectNode.progress.total} 项主任务已完成</small>
        </>:<p className="qp-muted">尚无任务</p>}</div>
        <dl><div><dt>截止日期</dt><dd>{snap.project.deadline??'未设置'}</dd></div><div><dt>负责人</dt><dd>{snap.project.ownerName??'待确认'}</dd></div>
          <div><dt>需要关注</dt><dd>{unfiltered.find(row=>row.node.bucket==='attention')?.node.title||'当前无待处理事项'}</dd></div></dl>
        </section>
        <PlanSuggestions key={snap.project.id}/>
        {!!snap.project.attachments?.length&&<section className="qp-panel qp-source"><h3>参考资料</h3>{snap.project.attachments.map(file=><button type="button" className="qp-btn" key={file.id} onClick={()=>void downloadOutputFile(snap.project.id,file).catch(error=>toast(error.message,'error'))}><Icon name="folder" size={14}/>{file.name}</button>)}</section>}
        <section className="qp-panel"><h3>任务计划</h3><TaskScheduleList rows={rows} tree={tree} onSelect={row=>pickRow(row,true)}/></section>
        {unfiltered.some(row=>planningTask(snap,row.node.taskId!,row.node.itemId).milestone) && <section className="qp-panel"><h3>近期里程碑</h3>
          <ol className="qp-milestones">{unfiltered.flatMap(row=>{const timing=planningTask(snap,row.node.taskId!,row.node.itemId);return timing.milestone&&timing.end?[{row,when:timing.end}]:[];}).sort((a,b)=>a.when.localeCompare(b.when)).slice(0,6).map(({row,when})=>
            <li key={row.node.key}><button type="button" className="qp-quiet" onClick={()=>pickRow(row,true)}>{row.node.title}</button><time dateTime={when}>{when}</time></li>)}</ol></section>}
      </div>}
      {activeView==='tasks'&&<div className="qp-task-layout"><div className="qp-tree" aria-label="任务树">{rows.length?rows.map(row=><Fragment key={row.node.key}>{tree(row)}</Fragment>):<p className="qp-muted">没有任务可显示</p>}</div>
        {current?.node.taskId&&current.node.projectId===snap.project.id&&<ProjectTaskDetail key={detailsKey} row={current} showResults={()=>setActiveView('results')}/>}</div>}
      {activeView==='timeline'&&<><ProjectGantt rows={rows} tree={tree} day={snap.date} crossProject={crossProject} onCrossProject={setCrossProject}
        selectedKey={current?.node.key} select={row=>pickRow(row)} openEditor={row=>{pickRow(row);setEditingDates(true);}} save={saveSchedule}/>
        {editingDates&&current?.node.taskId&&current.node.projectId===snap.project.id&&<ProjectTaskDetail key={detailsKey} row={current} showResults={()=>{setActiveView('results');setEditingDates(false);}} datesOnly close={()=>setEditingDates(false)}/>}</>}
      {activeView==='results'&&<div className="qp-results"><label>按任务查看 <select aria-label="按任务查看成果" value={selected?.projectId===snap.project.id ? unfiltered.find(row=>row.node.taskId===selected.taskId&&row.node.itemId===selected.itemId)?.node.key??'':''} onChange={event=>{
        const match=unfiltered.find(row=>row.node.key===event.target.value);
        setSelected(match?.node.taskId?{projectId:snap.project.id,taskId:match.node.taskId,itemId:match.node.itemId}:undefined);
      }}><option value="">全部任务</option>{unfiltered.map(row=><option key={row.node.key} value={row.node.key}>{'　'.repeat(row.depth)+row.node.title}</option>)}</select></label>
        {!!(snap.integration?.versions.length || snap.integration?.revisions.length) && <details className="qp-panel qd-data-preview">
          <summary>查看历史完整成果</summary><ResultsIntegration key={snap.project.id} />
        </details>}
        <DeliveryMap key={selected?.taskId+':'+selected?.itemId} scope={selected?.projectId===snap.project.id?{taskId:selected.taskId,workItemId:selected.itemId}:{}}/></div>}
      {activeView==='memory'&&<ProjectMemory key={snap.project.id} snapshot={snap} open={openTask}/>}
    </section>}
  </main>;
}
