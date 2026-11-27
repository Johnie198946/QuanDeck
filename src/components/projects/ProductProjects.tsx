import { Fragment, useMemo, useRef, useState, type DragEvent } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { projectRegister, type ProjectRegisterNode as OverviewNode } from './projectRegister';
import { taskKey } from '../../data/collaboration';
import { annotationHistory } from '../../data/annotationHistory';
import { planningTask, type PlannedTask } from '../../data/projectPlanning';
import { downloadOutputFile } from '../../data/outputFiles';
import { Icon } from '../ui/Icon';
import { DeliveryMap } from '../results/DeliveryMap';
import { ResultsIntegration } from '../results/ResultsIntegration';
import { ProjectGantt, type ProjectTreeRow } from './ProjectGantt';
import { TaskMaterials } from './TaskMaterials';
import { ProjectTaskDetail } from './ProjectTaskDetail';
import { SharedDecisions } from './SharedDecisions';
import { PlanSuggestions } from './PlanSuggestions';
import { startProductTaskDrag } from '../deck/ProductExecution';
import type { Snapshot } from '../../data/types';
import { ProjectMemory } from './ProjectMemory';
import { ProjectSubmit } from './projectResultCards';
import { ProjectCover, ProjectRail, ProjectOverview } from './ProjectOverview';
import './product-projects.css';
import './manage-overview.css';
import './manage-records.css';
import './manage-tasks.css';
import './dispatch-inbox.css';
import type { OpenNoteSource } from './NoteDispatchTrail';
import { boardResults, type BoardResult } from '../homepage/homeBoardData';
import { requestDeliveryFocus } from '../results/deliveryNavigation';

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


function visibleTree(registers:Map<Snapshot,OverviewNode>,projects:Snapshot[],folded:Set<string>,includeProject:boolean,hideDone:boolean): ProjectTreeRow[] {
  return projects.flatMap(snapshot=>{
    const order = new Map((snapshot.projectPlanning?.order??[]).map((key,index)=>[key,index]));
    const ranked=(list:OverviewNode[])=>[...list].sort((a,b)=>(order.get(localKey(a))??1e9)-(order.get(localKey(b))??1e9));
    const visit=(node:OverviewNode,depth:number,outline:string):ProjectTreeRow[]=>
      hideDone&&node.kind!=='project'&&node.bucket==='done'?[]:[
      {node,snapshot,depth,outline},...(!folded.has(node.key) ? ranked(node.children).flatMap((child,i)=>visit(child,depth+1,outline?outline+'.'+(i+1):String(i+1))) : []),
    ];
    const project = registers.get(snapshot) ?? projectRegister(snapshot);
    return includeProject ? visit(project,0,'') : ranked(project.children).flatMap((node,i)=>visit(node,0,String(i+1)));
  });
}

export interface ProjectBoardEntry { projectId: string; taskId?: string; itemId?: string; resultId?: string }
export function ProjectHub({onCreateProject,onEditProject,onOpenLegacyTasks,boardEntry,onOpenNote,onAttention}: {
  boardEntry?: ProjectBoardEntry;
  onOpenNote:OpenNoteSource;onAttention:(id:string)=>void;
  onCreateProject:()=>void;onEditProject:(projectId:string)=>void;onOpenLegacyTasks?:(projectId:string)=>void;
}) {
  const {snap,projectSnapshots,switchProject,refreshProjects,api,toast,openProjectDirection}=useWorkdeck();
  const [activeView,setActiveView]=useState<View>(boardEntry ? boardEntry.resultId ? 'results' : 'tasks' : 'summary');
  const [selected,setSelected]=useState<{taskId:string;itemId?:string;projectId:string}|undefined>(boardEntry?.taskId ? {projectId:boardEntry.projectId,taskId:boardEntry.taskId,itemId:boardEntry.itemId} : undefined);
  const [folded,setFolded]=useState<Set<string>>(()=>new Set());
  const [hideDone,setHideDone]=useState(false);
  const [crossProject,setCrossProject]=useState(false);
  const [editingDates,setEditingDates]=useState(false);
  const [newTask,setNewTask]=useState(!!boardEntry && !boardEntry.taskId),[taskTitle,setTaskTitle]=useState(''),[subtask,setSubtask]=useState(false);
  const [busy,setBusy]=useState(false),[more,setMore]=useState(false);
  const [error,setError]=useState('');
  const drag=useRef<ProjectTreeRow|undefined>(undefined);
  const registers = useMemo(() => new Map([...new Set([snap,...projectSnapshots])].map(snapshot => [snapshot,projectRegister(snapshot)])), [snap,projectSnapshots]);
  const rows=useMemo(()=>visibleTree(registers,activeView==='timeline'&&crossProject?projectSnapshots:[snap],folded,activeView==='timeline'&&crossProject,activeView!=='summary'&&hideDone),
    [registers,activeView,crossProject,projectSnapshots,snap,folded,hideDone]);
  const unfiltered=useMemo(()=>visibleTree(registers,[snap],new Set(),false,false),[registers,snap]);
  const current=rows.find(row=>row.node.taskId===selected?.taskId&&row.node.itemId===selected?.itemId&&row.node.projectId===selected?.projectId)??rows.find(row=>row.node.taskId&&row.node.projectId===snap.project.id);
  const projectNode=registers.get(snap)!;
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
  const openDecisionTask = (key:string) => {
    const row = unfiltered.find(row => localKey(row.node) === key);
    if (!row?.node.taskId) return;
    setHideDone(false);
    setFolded(new Set());
    openTask(row.node.taskId,row.node.itemId);
  };
  const taskResults=useMemo(()=>{
    const byScope=new Map<string,BoardResult[]>();
    for(const [taskId,entries] of boardResults(snap)) for(const entry of entries) {
      const scope=taskKey(taskId,entry.itemId);
      const group=byScope.get(scope);
      if(group) group.push(entry); else byScope.set(scope,[entry]);
    }
    return byScope;
  },[snap]);
  const showTaskResults = (row:ProjectTreeRow, resultId?:string) => {
    if (!row.node.taskId) return;
    if(resultId) requestDeliveryFocus(row.node.projectId,{taskId:row.node.taskId,workItemId:row.node.itemId},resultId);
    setEditingDates(false);
    openTask(row.node.taskId, row.node.itemId, true);
  };
  const pickRow=(row:ProjectTreeRow,open=false)=>{
    if(!row.node.taskId) {void switchProject(row.node.projectId);return;}
    setSelected({projectId:row.node.projectId,taskId:row.node.taskId,itemId:row.node.itemId});
    if(row.node.projectId!==snap.project.id && (activeView!=='timeline' || !crossProject || open))void switchProject(row.node.projectId);
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
    const all=visibleTree(registers,[from.snapshot],new Set(),false,false);
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
    const picked=Boolean(activeView !== 'summary' || selected) && node.key===current?.node.key;
    return <div className={'qp-tree-row'+(picked?' is-picked':'')+(node.children.length?' is-group':'')} style={{paddingInlineStart:Math.min(36,row.depth*15)+8}}
      draggable={!!node.taskId} onDragStart={event=>{if(!node.taskId)return;drag.current=row;startProductTaskDrag(event,{projectId:node.projectId,taskId:node.taskId,itemId:node.itemId});}}
      onDragEnd={()=>{drag.current=undefined;}} onDragOver={event=>{if(drag.current&&canReorder(drag.current,row))event.preventDefault();}}
      onDrop={event=>{if(!drag.current)return;event.preventDefault();void moveOrder(drag.current,row,event);drag.current=undefined;}}>
      {node.children.length?<button type="button" className="qp-icon qp-fold" aria-expanded={!folded.has(node.key)} aria-label={(folded.has(node.key)?'展开 ':'收起 ')+node.title} onClick={()=>fold(node.key)}><Icon name={folded.has(node.key)?'chevron-right':'chevron-down'} size={13}/></button>:<span className={'qp-tree-state '+node.bucket} title={node.state}><Icon name={node.bucket==='done'?'check-circle':node.kind==='project'?'folder':'dot'} size={13}/></span>}
      {activeView!=='summary'&&row.outline&&<span className="qp-tree-index" aria-hidden="true">{row.outline}</span>}
      <button type="button" className="qp-tree-link" aria-current={picked?'true':undefined} onClick={()=>pickRow(row)} title={node.title}>{node.title}</button>
      {activeView!=='summary'&&node.progress&&node.children.length>0&&<span className="qp-tree-ratio" title={node.progress.label+'完成数'}>{node.progress.done}/{node.progress.total}</span>}
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
  const summarySelection = selected?.projectId === snap.project.id
    ? unfiltered.find(row=>row.node.taskId===selected.taskId&&row.node.itemId===selected.itemId) : undefined;
  const selectProject = (id:string) => {
    if (id === snap.project.id) return;
    void switchProject(id); setSelected(undefined); setEditingDates(false); setMore(false);
    setNewTask(false); setTaskTitle(''); setSubtask(false); setError('');
  };
  const detailsKey = current?.node.key + ':' + editingDates;
  const projectHeader = <header className="qp-head qp-project-head qm-project-header"><div className="qm-project-identity"><ProjectCover project={snap.project}/><div><div className="qp-project-title">
        <h2>{snap.project.name}</h2>
        {activeView !== 'summary' && projectSnapshots.length > 1 && <label className="qp-project-switch">
          <Icon name="chevron-down" size={17}/>
          <select aria-label="切换项目" value={snap.project.id} onChange={event => {
            selectProject(event.target.value);
          }}>{projectSnapshots.map(project => <option key={project.project.id} value={project.project.id}>{project.project.name}</option>)}</select>
        </label>}
      </div>{snap.project.description&&<p>{snap.project.description}</p>}</div></div>
        <div className="qp-project-head-actions"><span className={'qp-state-badge '+projectNode.bucket}>{projectNode.state}</span>{snap.project.deadline&&<time dateTime={snap.project.deadline}><Icon name="calendar" size={14}/>{snap.project.deadline.slice(5).replace('-','/')}</time>}<button className="qp-icon" type="button" aria-expanded={more} aria-label="更多项目操作" onClick={()=>setMore(!more)}>···</button>
          {more&&<div className="qp-project-menu qp-panel">{activeView !== 'summary' && <button type="button" className="qp-quiet" onClick={onCreateProject}>新建项目</button>}<button type="button" className="qp-quiet" onClick={()=>{setMore(false);onEditProject(snap.project.id);}}>项目设置</button><button type="button" className="qp-quiet" onClick={()=>{setMore(false);void openProjectDirection(snap.project.id);}}>项目方向</button>
            {onOpenLegacyTasks&&<button type="button" className="qp-quiet" onClick={()=>onOpenLegacyTasks(snap.project.id)}>完整任务记录</button>}</div>}</div>
      </header>;
  const projectTabs = <nav className="qp-tabs" aria-label="项目页签">{views.map(([key,label])=><button type="button" key={key} aria-current={activeView===key?'page':undefined} onClick={()=>{setActiveView(key);setEditingDates(false);}}>{label}</button>)}</nav>;
  return <main className="qp-hub" data-project-view={activeView} data-has-project={Boolean(snap.project.id)}>
    {(!snap.project.id || activeView === 'summary') && <ProjectRail snapshots={projectSnapshots} registers={registers} activeId={snap.project.id} select={selectProject} create={onCreateProject}/>}
    {!snap.project.id?<section className="qp-stage qp-empty"><Icon name="folder" size={44}/><h2>开始一个项目</h2><p>把目标拆成任务，在这里跟进交付。</p><button type="button" className="qp-btn primary" onClick={onCreateProject}>新建项目</button></section>:<section className="qp-stage">
      {activeView==='timeline'?<div className="qp-calendar-project">{projectHeader}{projectTabs}</div>:<>{activeView!=='tasks'&&projectHeader}{projectTabs}</>}
      {newTask&&(activeView==='tasks'||activeView==='summary')&&<form className="qp-new-task qp-actions" onSubmit={event=>{event.preventDefault();void addTask();}}>
        <input autoFocus aria-label="新任务名称" placeholder="任务名称" value={taskTitle} maxLength={200} onChange={event=>setTaskTitle(event.target.value)} required />
        {current&&activeView==='tasks'&&<label><input type="checkbox" checked={subtask} onChange={event=>setSubtask(event.target.checked)}/> 作为子任务</label>}
        <button type="submit" className="qp-btn primary" disabled={busy||!taskTitle.trim()}>确认添加</button><button type="button" className="qp-btn" onClick={()=>setNewTask(false)}>取消</button>
        {error&&<p role="alert" className="qp-error">{error}</p>}
      </form>}
      {newTask && (activeView==='tasks'||activeView==='summary') && taskTitle.trim() &&
        <TaskMaterials query={{text:taskTitle,projectId:snap.project.id,projectName:snap.project.name}} onOpenNote={onOpenNote}/>}
      {activeView==='summary'&&<ProjectOverview key={snap.project.id} onOpenNote={onOpenNote} onAttention={onAttention} results={taskResults} showResult={showTaskResults} snapshot={snap} project={projectNode} rows={rows} allRows={unfiltered} selected={summarySelection} noteCount={summarySelection?annotationCounts.get(summarySelection.node.key)??0:0} tree={tree}
        select={row=>pickRow(row)} close={()=>setSelected(undefined)} open={row=>openTask(row.node.taskId!,row.node.itemId)} addTask={()=>setNewTask(!newTask)}>
        <SharedDecisions openTask={openDecisionTask}/>
        <PlanSuggestions key={snap.project.id}/>
        {!!snap.project.attachments?.length&&<section className="qp-panel qp-source"><h3>参考资料</h3>{snap.project.attachments.map(file=><button type="button" className="qp-btn" key={file.id} onClick={()=>void downloadOutputFile(snap.project.id,file).catch(error=>toast(error.message,'error'))}><Icon name="folder" size={14}/>{file.name}</button>)}</section>}
      </ProjectOverview>}
      {activeView==='tasks'&&<div className="qp-task-layout"><div className="qp-tree" aria-label="任务树">{projectHeader}<header className="qp-tree-heading"><h3>任务树</h3><span>{unfiltered.length} 项</span></header>
        <div className="qp-tree-tools"><button type="button" className="qp-btn" aria-expanded={newTask} onClick={()=>setNewTask(!newTask)}><Icon name="plus" size={15}/>新建任务</button><button type="button" className="qp-icon" aria-label="隐藏已完成" title="隐藏已完成" aria-pressed={hideDone} onClick={()=>setHideDone(!hideDone)}><Icon name="sliders" size={16}/></button></div>{rows.length?rows.map(row=><Fragment key={row.node.key}>{tree(row)}</Fragment>):<p className="qp-muted">没有任务可显示</p>}</div>
        {current?.node.taskId&&current.node.projectId===snap.project.id&&<ProjectTaskDetail key={detailsKey} row={current} openDecisionTask={openDecisionTask} onOpenNote={onOpenNote} results={taskResults.get(localKey(current.node))??[]} showResults={id=>showTaskResults(current,id)}/>}</div>}
      {activeView==='timeline'&&<><ProjectGantt key={JSON.stringify([snap.project.id,crossProject])} rows={rows} tree={tree} day={snap.date} crossProject={crossProject} onCrossProject={setCrossProject}
        selectedKey={current?.node.key} select={row=>pickRow(row)} openEditor={row=>{pickRow(row,true);setEditingDates(true);}} save={saveSchedule}/>
        {editingDates&&current?.node.taskId&&current.node.projectId===snap.project.id&&<ProjectTaskDetail key={detailsKey} row={current} onOpenNote={onOpenNote} results={taskResults.get(localKey(current.node))??[]} showResults={id=>showTaskResults(current,id)} datesOnly close={()=>setEditingDates(false)}/>}</>}
      {activeView==='results'&&<div className="qp-results">
        <DeliveryMap key={snap.project.id+':'+selected?.taskId+':'+selected?.itemId} projectBrowser projectSubmit={<ProjectSubmit snap={snap} items={unfiltered.flatMap(({node})=>node.taskId?[{taskId:node.taskId,itemId:node.itemId,title:node.title}]:[])}/>} taskFilter={<select aria-label="按任务查看成果" value={selected?.projectId===snap.project.id ? unfiltered.find(row=>row.node.taskId===selected.taskId&&row.node.itemId===selected.itemId)?.node.key??'':''} onChange={event=>{
        const match=unfiltered.find(row=>row.node.key===event.target.value);
        setSelected(match?.node.taskId?{projectId:snap.project.id,taskId:match.node.taskId,itemId:match.node.itemId}:undefined);
      }}><option value="">全部任务</option>{unfiltered.map(row=><option key={row.node.key} value={row.node.key}>{'　'.repeat(row.depth)+row.node.title}</option>)}</select>} scope={selected?.projectId===snap.project.id?{taskId:selected.taskId,workItemId:selected.itemId}:{}}/>
        {!!(snap.integration?.versions.length || snap.integration?.revisions.length) && <details className="qp-panel qd-data-preview">
          <summary>查看历史完整成果</summary><ResultsIntegration key={snap.project.id} />
        </details>}
      </div>}
      {activeView==='memory'&&<ProjectMemory key={snap.project.id} snapshot={snap} open={openTask}/>}
    </section>}
  </main>;
}
