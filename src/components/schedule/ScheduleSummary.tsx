import { TaskIcon } from "../ui/TaskIcon";
import { useState, useEffect } from 'react';
import { formatDuration } from '../../data/format';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { AgentSwatch } from '../ui/AgentBadge';
import { Icon } from '../ui/Icon';
import { Spiral } from './Spiral';
import { orchOf } from '../../data/orchestration';
import { timelinePlanTotals } from '../../data/timeline';
import { dailySchedule, pendingScheduleTasks } from '../../data/dailySchedule';
import { TaskScheduleButton } from './TaskScheduleButton';
import { PendingScheduleTasks } from './PendingScheduleTasks';
import './schedule-layout.css';

export function ScheduleSummary({ onExpand }: { onExpand: () => void }) {
  const { snap, projectSnapshots, hoverPlan, setHoverPlan, scope, subtasksOpen, workspace, locateTask, selectWork, closeWorkspace, switchProject }=useWorkdeck();
  const [,tick]=useState(0);useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),30000);return()=>clearInterval(timer);},[]);
  const focusOrch=orchOf(snap,scope?.taskId??(workspace?.view==='tasks'?workspace.taskId:null)??Object.keys(subtasksOpen).find(k=>subtasksOpen[k])??null);
  const totals=timelinePlanTotals(snap);
  const sources=[...projectSnapshots.filter(source=>source.project.id!==snap.project.id),snap];
  const today=dailySchedule(sources,snap.date);
  const pending=pendingScheduleTasks(sources,snap.date);
  const upcoming=today.rows.filter(row=>row.planned&&!row.finished&&row.planned[1]>=Date.now()).slice(0,3);
  const locate=async(projectId:string,taskId:string,itemId?:string)=>{
    if(projectId!==snap.project.id&&!await switchProject(projectId))return;
    closeWorkspace();requestAnimationFrame(()=>requestAnimationFrame(()=>{locateTask(taskId);if(itemId)selectWork(taskId,itemId);}));
  };
  return <aside className="qd-schedule" aria-label="今日日程摘要">
    <div className="qd-date"><h2>{snap.dateLabel}</h2></div>
    <section className="qd-rhythm"><h3 className="qd-section-title">今日节奏</h3><p className="qd-schedule-project-name"><span style={{background:snap.project.color??'#a94435'}}/>{snap.project.name}</p>
      <div className="qd-dial"><Spiral snap={snap} hoverPlan={hoverPlan} size={184} focusTaskId={focusOrch?.taskId} onLocate={(taskId,itemId)=>void locate(snap.project.id,taskId,itemId)} onPlan={id=>{setHoverPlan(id);onExpand();}}/></div>
      <ul className="qd-dial-legend" aria-label="图例"><li><span className="qd-key plan" aria-hidden="true"/>计划</li><li><span className="qd-key actual" aria-hidden="true"/>实际</li>{snap.agents.filter(a=>a.tracked&&snap.activity.some(i=>i.agentId===a.id)).map(a=><li key={a.id}><AgentSwatch agent={a} size={8}/>{a.short}</li>)}</ul>
      {focusOrch&&<p className="qd-timeline-focus">{focusOrch.label}</p>}
      <dl className="qd-plan-totals"><div><dt>计划</dt><dd>{formatDuration(totals.planned)}</dd></div><div><dt>实际</dt><dd>{formatDuration(totals.actual)}</dd></div></dl>
    </section>
    <section className="qd-upcoming qd-next-up">
      <header><h3 className="qd-section-title">接下来</h3><button type="button" className="qd-text-btn" onClick={onExpand}>日程<Icon name="arrow-right" size={13}/></button></header>
      {upcoming.length > 0 && <ul className="qd-next-planned">{upcoming.map(row => <li key={row.key} className="qd-schedule-upcoming-item">
        <span className="qd-up-time">{row.plan.start}<small>{row.plan.minutes} 分钟</small></span>
        <div><span className="qd-daily-project" style={{'--project-color':row.project.color??'#a94435'} as React.CSSProperties}><span>{row.project.name}</span></span>{row.plan.taskId ? <button type="button" className="qd-up-title qd-link" title={row.title} onClick={()=>void locate(row.project.id,row.plan.taskId!,row.plan.workItemId)}><TaskIcon snapshot={row.snap} taskId={row.plan.taskId} workItemId={row.plan.workItemId} size={16}/><span>{row.title}</span></button> : <span>{row.title}</span>}</div>
      </li>)}</ul>}
      {pending.length > 0 && <div className="qd-next-pending"><p>还可以安排 <span>{pending.length} 项待办</span></p><ul>{pending.slice(0,2).map(row => <li key={row.key}>
        <div><small>{row.project.name}{row.task.estimate ? ` · ${row.task.estimate} 分钟` : ''}</small><button type="button" className="qd-up-title qd-link" title={row.task.title} onClick={()=>void locate(row.project.id,row.task.id)}><TaskIcon snapshot={row.snap} taskId={row.task.id} size={16}/><span>{row.task.title}</span></button></div><TaskScheduleButton compact taskId={row.task.id} projectId={row.project.id} date={snap.date}/>
      </li>)}</ul></div>}
      {!upcoming.length && !pending.length && <p className="qd-schedule-empty">今天没有剩余安排。</p>}
    </section>
    <PendingScheduleTasks rows={pending} date={snap.date} compact onLocate={(projectId,taskId)=>void locate(projectId,taskId)} onExpand={onExpand}/>
    <section className="qd-add-plan"><TaskScheduleButton/></section>
  </aside>;
}
