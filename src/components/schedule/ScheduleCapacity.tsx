import { useEffect, useState } from 'react';
import type { Snapshot } from '../../data/types';
import { scheduleCapacity } from '../../data/dailySchedule';
import { formatDuration } from '../../data/format';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ScheduleTimeField } from './SchedulePickers';

export function ScheduleCapacity({projects,date}:{projects:Snapshot[];date:string}) {
  const {snap,api,refreshProjects,toast}=useWorkdeck();
  const [start,setStart]=useState('09:00'),[end,setEnd]=useState('18:00'),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false);
  const revision=projects.map(p=>`${p.project.id}:${p.version}`).join('|');
  useEffect(()=>setPreview(false),[date,start,end,revision]);
  let capacity:ReturnType<typeof scheduleCapacity>|undefined,error='';
  try {capacity=scheduleCapacity(projects,date,{start,end,timeZone:snap.project.timeZone});}catch(e){error=e instanceof Error?e.message:'可用时段无效';}
  const apply=async()=>{
    if(!capacity?.moves.length||busy)return;setBusy(true);
    try {await api.applyPlanMoves(capacity.moves);await refreshProjects();setPreview(false);toast(`已调整 ${capacity.moves.length} 项弹性安排`);}
    catch(e){toast(e instanceof Error?e.message:'调整失败','error');await refreshProjects();}finally{setBusy(false);}
  };
  return <section className="qd-capacity" aria-label="日程容量与冲突">
    <p className="qd-capacity-guide">弹性安排允许调整开始时间。先选当天可用时段，再预览建议；点击“应用”才会保存。固定安排和已经开始的任务不会移动。</p>
    <div className="qd-capacity-head"><strong>可用时段</strong><ScheduleTimeField label="可用开始时间" value={start} onChange={setStart}/><span>—</span><ScheduleTimeField label="可用结束时间" value={end} onChange={setEnd}/><small>{snap.project.timeZone??'Asia/Shanghai'}</small></div>
    {error?<p role="status">{error}</p>:capacity&&<>
      <div className="qd-capacity-summary"><span>弹性任务 <strong>{formatDuration(capacity.demand)}</strong></span><span>可用 <strong>{formatDuration(capacity.available)}</strong></span>{capacity.overload>0&&<span className="is-warning">超出 {formatDuration(capacity.overload)}</span>}</div>
      <div className="qd-capacity-meter" role="img" aria-label={`弹性任务 ${capacity.demand} 分钟，可用 ${capacity.available} 分钟`}><span className={capacity.overload>0?'is-warning':''} style={{width:`${capacity.available?Math.min(100,capacity.demand/capacity.available*100):capacity.demand?100:0}%`}}/></div>
      {capacity.conflicts.length>0&&<details className="qd-capacity-conflicts"><summary>{capacity.conflicts.length} 处安排重叠</summary><ul>{capacity.conflicts.map(({a,b,minutes})=><li key={`${a.key}:${b.key}`}>{a.project.name} · {a.title} / {b.project.name} · {b.title}<small>重叠 {formatDuration(minutes)}</small></li>)}</ul></details>}
      <div className="qd-capacity-actions"><small>{capacity.expired?'此日可用时段已结束，可手动安排到其他日期。':'按当前时间计算；固定和已开始的安排保持原时间。'}</small>{!capacity.expired&&capacity.demand>0&&<button type="button" className="qd-link" onClick={()=>setPreview(v=>!v)} aria-expanded={preview}>{preview?'收起建议':'预览弹性重排'}</button>}</div>
      {preview&&<div className="qd-capacity-preview"><strong>重排预览</strong>{capacity.unplaced.length>0?<p role="status">{capacity.unplaced.length} 项无法放进连续空档。请在任务右侧调整时长或日期，再预览。当前安排保留。</p>:capacity.moves.length?<><ul>{capacity.moves.map(move=>{const row=capacity!.rows.find(r=>r.plan.id===move.planId&&r.project.id===move.projectId)!;return <li key={row.key}><span>{row.project.name} · {row.title}</span><small>{move.from} → {move.to}</small></li>;})}</ul><button type="button" className="qd-btn primary small" disabled={busy} onClick={()=>void apply()}>{busy?'保存中…':`应用 ${capacity.moves.length} 项时间调整`}</button></>:<p>当前顺序已适合可用时段。</p>}</div>}
    </>}
  </section>;
}
