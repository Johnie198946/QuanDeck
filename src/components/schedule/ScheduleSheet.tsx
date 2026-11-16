import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../data/format';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { dailySchedule, dayChartRange, pendingScheduleTasks } from '../../data/dailySchedule';
import { nextDate, timeInZone } from '../../data/timeline';
import { TaskScheduleButton } from './TaskScheduleButton';
import { ScheduleCapacity } from './ScheduleCapacity';
import { PendingScheduleTasks } from './PendingScheduleTasks';
import './schedule-editor.css';

export function ScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snap, projectSnapshots, api, refreshProjects, switchProject, locateTask, selectWork, closeWorkspace, toast } = useWorkdeck();
  const dialog=useRef<HTMLDialogElement>(null);
  const [date,setDate]=useState(snap.date); const [project,setProject]=useState('all'); const [busy,setBusy]=useState('');
  const [,tick]=useState(0);
  const sources=[...projectSnapshots.filter(s=>s.project.id!==snap.project.id),snap].filter(s=>project==='all'||s.project.id===project);
  const day=dailySchedule(sources,date);
  const pending=pendingScheduleTasks(sources,date);
  useEffect(()=>{
    const node=dialog.current;if(!open){node?.close();return;}
    const trigger=document.activeElement as HTMLElement|null;setDate(snap.date);node?.showModal();
    const timer=setInterval(()=>tick(value=>value+1),15000);
    return()=>{clearInterval(timer);node?.close();trigger?.focus();};
  },[open]);
  const navigate=async(projectId:string,taskId:string,itemId?:string)=>{
    if(projectId!==snap.project.id && !await switchProject(projectId))return;
    onClose();closeWorkspace();requestAnimationFrame(()=>requestAnimationFrame(()=>{locateTask(taskId);if(itemId)selectWork(taskId,itemId);}));
  };
  const timer=async(planId:string,projectId:string,running:boolean)=>{
    if(busy)return;setBusy(planId);
    try{await api.setPlanTimer(planId,running,projectId);await refreshProjects();toast(running?'开始记录我的用时':'已保存实际用时');}
    catch(error){toast(error instanceof Error?error.message:'计时失败','error');}finally{setBusy('');}
  };
  return <dialog ref={dialog} className="qd-daily-sheet" aria-labelledby="qd-daily-heading" onCancel={e=>{e.preventDefault();onClose();}}>
    <header className="qd-daily-head"><div><span>按任务安排 · 跨项目</span><h2 id="qd-daily-heading">每日日程</h2></div><button type="button" className="qd-icon-btn" onClick={onClose} aria-label="关闭日程"><Icon name="close" size={19}/></button></header>
    <div className="qd-daily-controls"><div className="qd-daily-date"><button type="button" className="qd-icon-btn" aria-label="前一天" onClick={()=>setDate(nextDate(date,-1))}>‹</button><input type="date" aria-label="查看日程日期" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/><button type="button" className="qd-icon-btn" aria-label="后一天" onClick={()=>setDate(nextDate(date,1))}>›</button></div><select aria-label="筛选日程项目" value={project} onChange={e=>setProject(e.target.value)}><option value="all">全部项目</option>{projectSnapshots.map(s=><option key={s.project.id} value={s.project.id}>{s.project.name}</option>)}</select><TaskScheduleButton projectId={project==='all'?undefined:project} date={date}/></div>
    <dl className="qd-daily-totals"><div><dt>任务安排</dt><dd>{day.rows.filter(r=>r.planned).length}<small>项 / {day.projectCount} 项目</small></dd></div><div><dt>计划</dt><dd>{formatDuration(day.planned)}</dd></div><div><dt>实际</dt><dd>{formatDuration(day.actual)}</dd></div><div><dt>未完成</dt><dd>{day.unfinished}</dd></div></dl>
    <PendingScheduleTasks rows={pending} date={date} scopeLabel={project==='all'?'全部项目':sources[0]?.project.name} onLocate={(projectId,taskId)=>void navigate(projectId,taskId)}/>
    {day.rows.some(row=>row.planned&&!row.finished)&&<ScheduleCapacity projects={sources} date={date}/>}
    <div className="qd-daily-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    <ol className="qd-daily-list">{day.rows.map(row=><li key={row.key}>
      <div className="qd-daily-row-heading"><span className="qd-daily-project" style={{'--project-color':row.project.color??'#a94435'} as React.CSSProperties}>{row.project.name}</span><span className="qd-daily-status">{row.plan.cancelled?'已取消安排':row.finished?'已完成':row.plan.manualStartedAt?'正在计时':row.plan.kind==='fixed'?'固定':'弹性'}</span></div>
      <div className="qd-daily-task">{row.plan.taskId?<button type="button" className="qd-link" onClick={()=>void navigate(row.project.id,row.plan.taskId!,row.plan.workItemId)}><TaskIcon snapshot={row.snap} taskId={row.plan.taskId} workItemId={row.plan.workItemId} size={18}/>{row.title}<Icon name="arrow-right" size={13}/></button>:<strong>{row.title}</strong>}{row.plan.taskId&&<TaskScheduleButton compact projectId={row.project.id} date={row.plan.date??date} taskId={row.plan.taskId} itemId={row.plan.workItemId}/>}</div>
      <div className="qd-daily-track" role="img" aria-label={`${row.project.name}，${row.title}，计划${row.plan.start}开始${row.plan.minutes}分钟，实际${formatDuration(row.actualMinutes)}`}>
        {row.planned&&<span className="is-planned" style={dayChartRange(row.planned,date,row.project.timeZone)}/>}{row.actual.map((range,i)=><span key={i} className="is-actual" style={dayChartRange(range,date,row.project.timeZone)}/>)}
      </div>
      <div className="qd-daily-row-footer"><span>{row.planned?`${timeInZone(row.planned[0],row.project.timeZone)} · ${formatDuration((row.planned[1]-row.planned[0])/60000)}`:'实际记录'}{row.actualMinutes>0?` / 实际 ${formatDuration(row.actualMinutes)}`:''}</span>{!row.plan.cancelled&&!row.finished&&<button type="button" className="qd-text-btn" disabled={!!busy} onClick={()=>void timer(row.plan.id,row.project.id,!row.plan.manualStartedAt)}><Icon name="clock" size={13}/>{row.plan.manualStartedAt?'结束计时':'开始我的计时'}</button>}</div>
    </li>)}</ol>
    {!day.rows.length&&<div className="qd-daily-empty"><Icon name="calendar" size={26}/><p>{pending.length?'从待安排中选一项，设置开始时间。':'这一天还没有安排'}</p>{!pending.length&&<TaskScheduleButton date={date}/>}</div>}
    <footer className="qd-daily-legend"><span><i className="is-planned"/>计划</span><span><i className="is-actual"/>实际</span><small>人工计时与 Agent 执行按同一时间线汇总，重叠时段只计一次。</small></footer>
  </dialog>;
}
