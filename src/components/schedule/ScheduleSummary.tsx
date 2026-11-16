import { TaskIcon } from "../ui/TaskIcon";
import { useState, useEffect } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { AgentSwatch } from '../ui/AgentBadge';
import { Icon } from '../ui/Icon';
import { Spiral } from './Spiral';
import { orchOf } from '../../data/orchestration';
import { nextDate, visibleIntervals } from '../../data/timeline';
import { scheduleClock, scheduleDayStatus, scheduleDayView, scheduleDuration } from '../../data/scheduleHistory';
import { useScheduleClock } from './useScheduleClock';
import { dailySchedule, pendingScheduleTasks } from '../../data/dailySchedule';
import { TaskScheduleButton } from './TaskScheduleButton';
import { PendingScheduleTasks } from './PendingScheduleTasks';
import './schedule-layout.css';

export function ScheduleSummary({ onExpand }: { onExpand: (date?: string) => void }) {
  const { snap, projectSnapshots, hoverPlan, setHoverPlan, scope, subtasksOpen, workspace, locateTask, selectWork, closeWorkspace, switchProject }=useWorkdeck();
  const clock=useScheduleClock(), [selectedDate,setSelectedDate]=useState<string|null>(null);
  useEffect(()=>setSelectedDate(null),[snap.project.id]);
  const view=scheduleDayView(snap,selectedDate,clock), {isToday}=scheduleClock(view,clock);
  const expand=()=>onExpand(view.date);
  const focusOrch=orchOf(snap,scope?.taskId??(workspace?.view==='tasks'?workspace.taskId:null)??Object.keys(subtasksOpen).find(k=>subtasksOpen[k])??null);
  const totals=scheduleDayStatus(view,clock);
  const sources=[...projectSnapshots.filter(source=>source.project.id!==snap.project.id),view];
  const today=dailySchedule(sources,view.date);
  const pending=isToday?pendingScheduleTasks(sources,view.date):[];
  const upcoming=today.rows.filter(row=>row.planned&&(!isToday||!row.finished&&row.planned[1]>=clock)).slice(0,3);
  const locate=async(projectId:string,taskId:string,itemId?:string)=>{
    if(projectId!==snap.project.id&&!await switchProject(projectId))return;
    closeWorkspace();requestAnimationFrame(()=>requestAnimationFrame(()=>{locateTask(taskId);if(itemId)selectWork(taskId,itemId);}));
  };
  return <aside className="qd-schedule" aria-label="日程与执行记录">
    <div className="qd-date qd-history-date"><button type="button" className="qd-icon-btn" aria-label="查看前一天" onClick={()=>setSelectedDate(nextDate(view.date,-1))}>‹</button><h2>{view.dateLabel}</h2><button type="button" className="qd-icon-btn" aria-label="查看后一天" onClick={()=>setSelectedDate(nextDate(view.date,1))}>›</button></div>
    {!isToday&&<button type="button" className="qd-history-today qd-text-btn" onClick={()=>setSelectedDate(null)}>回到今天</button>}
    <section className="qd-rhythm"><h3 className="qd-section-title">{isToday?'今日节奏':'当日节奏'}</h3><p className="qd-schedule-project-name"><span style={{background:snap.project.color??'#a94435'}}/>{snap.project.name}</p>
      <div className="qd-dial"><Spiral snap={view} clock={clock} hoverPlan={hoverPlan} size={184} focusTaskId={focusOrch?.taskId} onLocate={(taskId,itemId)=>void locate(snap.project.id,taskId,itemId)} onPlan={id=>{setHoverPlan(id);expand();}}/></div>
      <ul className="qd-dial-legend" aria-label="图例"><li><span className="qd-key plan" aria-hidden="true"/>计划</li><li><span className="qd-key actual" aria-hidden="true"/>实际</li>{snap.agents.filter(a=>a.tracked&&visibleIntervals(view).some(i=>i.agentId===a.id)).map(a=><li key={a.id}><AgentSwatch agent={a} size={8}/>{a.short}</li>)}</ul>
      {focusOrch&&<p className="qd-timeline-focus">{focusOrch.label}</p>}
      <dl className="qd-plan-totals"><div><dt>计划</dt><dd>{scheduleDuration(totals.planned)}</dd></div><div><dt>实际</dt><dd>{scheduleDuration(totals.actual)}</dd></div></dl>
      <p className="qd-history-explanation">{totals.message}{totals.planned===0&&' 未设置日程计划。'}</p>
      <div className="qd-history-actions">{totals.latestDate&&totals.latestDate!==view.date&&<button type="button" className="qd-text-btn" onClick={()=>setSelectedDate(totals.latestDate)}>最近执行 · {totals.latestDate.slice(5).replace('-','/')}<Icon name="arrow-right" size={13}/></button>}<button type="button" className="qd-text-btn" onClick={expand}>查看明细<Icon name="arrow-right" size={13}/></button></div>
    </section>
    <section className="qd-upcoming qd-next-up">
      <header><h3 className="qd-section-title">{isToday?'接下来':'当日安排'}</h3><button type="button" className="qd-text-btn" onClick={expand}>日程<Icon name="arrow-right" size={13}/></button></header>
      {upcoming.length > 0 && <ul className="qd-next-planned">{upcoming.map(row => <li key={row.key} className="qd-schedule-upcoming-item">
        <span className="qd-up-time">{row.plan.start}<small>{row.plan.minutes} 分钟</small></span>
        <div><span className="qd-daily-project" style={{'--project-color':row.project.color??'#a94435'} as React.CSSProperties}><span>{row.project.name}</span></span>{row.plan.taskId ? <button type="button" className="qd-up-title qd-link" title={row.title} onClick={()=>void locate(row.project.id,row.plan.taskId!,row.plan.workItemId)}><TaskIcon snapshot={row.snap} taskId={row.plan.taskId} workItemId={row.plan.workItemId} size={16}/><span>{row.title}</span></button> : <span>{row.title}</span>}</div>
      </li>)}</ul>}
      {pending.length > 0 && <div className="qd-next-pending"><p>还可以安排 <span>{pending.length} 项待办</span></p><ul>{pending.slice(0,2).map(row => <li key={row.key}>
        <div><small>{row.project.name}{row.task.estimate ? ` · ${row.task.estimate} 分钟` : ''}</small><button type="button" className="qd-up-title qd-link" title={row.task.title} onClick={()=>void locate(row.project.id,row.task.id)}><TaskIcon snapshot={row.snap} taskId={row.task.id} size={16}/><span>{row.task.title}</span></button></div><TaskScheduleButton compact taskId={row.task.id} projectId={row.project.id} date={view.date}/>
      </li>)}</ul></div>}
      {!upcoming.length && !pending.length && <p className="qd-schedule-empty">{isToday?'今天没有剩余安排。':'完整执行记录可在明细中查看。'}</p>}
    </section>
    <PendingScheduleTasks rows={pending} date={view.date} compact onLocate={(projectId,taskId)=>void locate(projectId,taskId)} onExpand={expand}/>
    <section className="qd-add-plan"><TaskScheduleButton date={view.date}/></section>
  </aside>;
}
