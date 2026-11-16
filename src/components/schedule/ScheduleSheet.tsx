import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useRef, useState } from 'react';
import { scheduleDayView, scheduleDuration as formatDuration, latestExecutionDay, initialScheduleDate } from '../../data/scheduleHistory';
import { useScheduleClock } from './useScheduleClock';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { dailySchedule, dayChartRange, pendingScheduleTasks } from '../../data/dailySchedule';
import { nextDate, timeInZone } from '../../data/timeline';
import { TaskScheduleButton } from './TaskScheduleButton';
import { ScheduleCapacity } from './ScheduleCapacity';
import { PendingScheduleTasks } from './PendingScheduleTasks';
import './schedule-editor.css';
import { ScheduleDateField } from './SchedulePickers';
import './schedule-layout.css';

export function ScheduleSheet({ open, onClose, initialDate }: { open: boolean; onClose: () => void; initialDate?: string }) {
  const { snap, projectSnapshots, api, refreshProjects, switchProject, locateTask, selectWork, closeWorkspace, toast } = useWorkdeck();
  const dialog=useRef<HTMLDialogElement>(null);
  const clock=useScheduleClock(open), current=scheduleDayView(snap,null,clock);
  const [selectedDate,setDate]=useState<string|null>(null); const date=selectedDate??current.date; const [project,setProject]=useState('all'); const [busy,setBusy]=useState('');
  const sources=[...projectSnapshots.filter(s=>s.project.id!==snap.project.id),snap].filter(s=>project==='all'||s.project.id===project);
  const day=dailySchedule(sources,date);
  const pending=date===current.date?pendingScheduleTasks(sources,date):[];
  const latest=sources.map(latestExecutionDay).filter((value):value is string=>!!value).sort().at(-1);
  useEffect(()=>{
    const node=dialog.current;if(!open){node?.close();return;}
    const trigger=document.activeElement as HTMLElement|null;setDate(initialScheduleDate(snap,initialDate,Date.now()));node?.showModal();
    return()=>{node?.close();trigger?.focus();};
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
    <header className="qd-daily-head"><div><span>计划与真实执行 · 跨项目</span><h2 id="qd-daily-heading">每日记录</h2></div><button type="button" className="qd-icon-btn" onClick={onClose} aria-label="关闭日程"><Icon name="close" size={19}/></button></header>
    <div className="qd-daily-controls"><div className="qd-daily-date"><button type="button" className="qd-icon-btn" aria-label="前一天" onClick={()=>setDate(nextDate(date,-1))}>‹</button><ScheduleDateField label="查看日程日期" value={date} today={current.date} onChange={value=>{if(value)setDate(value);}}/><button type="button" className="qd-icon-btn" aria-label="后一天" onClick={()=>setDate(nextDate(date,1))}>›</button></div><button type="button" className="qd-text-btn" disabled={date===current.date} onClick={()=>setDate(null)}>今天</button>{latest&&latest!==date&&<button type="button" className="qd-text-btn" onClick={()=>setDate(latest)}>最近执行</button>}<select aria-label="筛选日程项目" value={project} onChange={e=>setProject(e.target.value)}><option value="all">全部项目</option>{projectSnapshots.map(s=><option key={s.project.id} value={s.project.id}>{s.project.name}</option>)}</select><TaskScheduleButton projectId={project==='all'?undefined:project} date={date}/></div>
    <dl className="qd-daily-totals"><div><dt>当日记录</dt><dd>{day.rows.length+day.unplanned.length}<small>项 / {day.projectCount} 项目</small></dd></div><div><dt>计划</dt><dd>{formatDuration(day.planned)}</dd></div><div><dt>实际</dt><dd>{formatDuration(day.actual)}</dd></div><div><dt>未完成</dt><dd>{day.unfinished}</dd></div></dl>
    <div className={`qd-daily-workspace${pending.length ? ' has-pending' : ''}`}><aside className="qd-daily-backlog">
    <PendingScheduleTasks rows={pending} date={date} scopeLabel={project==='all'?'全部项目':sources[0]?.project.name} onLocate={(projectId,taskId)=>void navigate(projectId,taskId)}/>
    </aside><section className="qd-daily-agenda" aria-label="当天计划与实际"><div className="qd-daily-agenda-heading"><h3>计划与执行</h3><span>{day.rows.length+day.unplanned.length} 项记录</span></div>
    {day.rows.some(row=>row.planned&&!row.finished)&&<details className="qd-daily-reflow"><summary><Icon name="sliders" size={15}/>整理弹性安排<span>预览后确认</span></summary><ScheduleCapacity projects={sources} date={date}/></details>}
    <div className="qd-daily-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    <ol className="qd-daily-list">{day.rows.map(row=><li key={row.key}>
      <div className="qd-daily-row-heading"><span className="qd-daily-project" style={{'--project-color':row.project.color??'#a94435'} as React.CSSProperties}>{row.project.name}</span><span className="qd-daily-status">{row.plan.cancelled?'已取消安排':row.finished?'已完成':row.plan.manualStartedAt?'正在计时':row.plan.kind==='fixed'?'固定时间':'弹性 · 可调整'}</span></div>
      <div className="qd-daily-task">{row.plan.taskId?<button type="button" className="qd-link" onClick={()=>void navigate(row.project.id,row.plan.taskId!,row.plan.workItemId)}><TaskIcon snapshot={row.snap} taskId={row.plan.taskId} workItemId={row.plan.workItemId} size={18}/>{row.title}<Icon name="arrow-right" size={13}/></button>:<strong>{row.title}</strong>}{row.plan.taskId&&<TaskScheduleButton compact projectId={row.project.id} date={row.plan.date??date} taskId={row.plan.taskId} itemId={row.plan.workItemId}/>}</div>
      <div className="qd-daily-track" role="img" aria-label={`${row.project.name}，${row.title}，计划${row.plan.start}开始${row.plan.minutes}分钟，实际${formatDuration(row.actualMinutes)}`}>
        {row.planned&&<span className="is-planned" style={dayChartRange(row.planned,date,row.project.timeZone)}/>}{row.actual.map((range,i)=><span key={i} className="is-actual" style={dayChartRange(range,date,row.project.timeZone)}/>)}
      </div>
      <div className="qd-daily-row-footer"><span>{row.planned?`${timeInZone(row.planned[0],row.project.timeZone)} · ${formatDuration((row.planned[1]-row.planned[0])/60000)}`:'实际记录'}{row.actualMinutes>0?` / 实际 ${formatDuration(row.actualMinutes)}`:''}</span>{!row.plan.cancelled&&!row.finished&&<button type="button" className="qd-text-btn" disabled={!!busy} onClick={()=>void timer(row.plan.id,row.project.id,!row.plan.manualStartedAt)}><Icon name="clock" size={13}/>{row.plan.manualStartedAt?'结束计时':'开始我的计时'}</button>}</div>
    </li>)}</ol>
    {day.unplanned.length>0&&<section className="qd-daily-unplanned" aria-label="未排期执行"><header><h3>未排期执行</h3><span>直接派发的任务也会留下记录</span></header><ol className="qd-daily-list">{day.unplanned.map(row=><li key={row.key}>
      <div className="qd-daily-row-heading"><span className="qd-daily-project" style={{'--project-color':row.project.color??'#a94435'} as React.CSSProperties}>{row.project.name}</span><span className="qd-daily-status">{row.purpose==='discussion'?'方案讨论':row.purpose==='review'?'成果核对':'任务执行'} · {row.agent?.short??'Agent'}</span></div>
      <div className="qd-daily-task">{row.taskId&&row.snap.tasks[row.taskId]?<button type="button" className="qd-link" onClick={()=>void navigate(row.project.id,row.taskId!,row.workItemId)}><TaskIcon snapshot={row.snap} taskId={row.taskId} workItemId={row.workItemId} size={18}/>{row.title}<Icon name="arrow-right" size={13}/></button>:<strong>{row.title}</strong>}</div>
      <div className="qd-daily-track" role="img" aria-label={`${row.title}，实际 ${formatDuration(row.actualMinutes)}`}>
        {row.actual.map((range,i)=><span key={i} className="is-actual" style={dayChartRange(range,date,row.project.timeZone)}/>)}
      </div>
      <div className="qd-daily-row-footer"><span>{row.actual.map(([start,end])=>`${timeInZone(start,row.project.timeZone)}–${timeInZone(end,row.project.timeZone)}`).join(' · ')}</span><strong>{formatDuration(row.actualMinutes)}</strong></div>
    </li>)}</ol></section>}
    {!day.rows.length&&!day.unplanned.length&&<div className="qd-daily-empty"><Icon name="calendar" size={26}/><p>{date===current.date?'今天尚无计划或执行记录。':'这一天没有计划或执行记录。'}</p><small>暂停和等待不会增加实际用时，过去的执行保留在原日期。</small>{latest&&latest!==date&&<button type="button" className="qd-text-btn" onClick={()=>setDate(latest)}>查看最近执行 · {latest}<Icon name="arrow-right" size={13}/></button>}</div>}
    <footer className="qd-daily-legend"><span><i className="is-planned"/>计划</span><span><i className="is-actual"/>实际</span><small>人工计时与 Agent 执行按同一时间线汇总，重叠时段只计一次。</small></footer>
    </section></div>
  </dialog>;
}
