import { dayBounds, instant, planRanges, planIncludesInterval, visibleIntervals } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import './timeline.css';
const TAU=Math.PI*2;
function point(r:number,min:number) { const a=min/1440*TAU-Math.PI/2;return [100+r*Math.cos(a),100+r*Math.sin(a)]; }
function arc(r:number,start:number,end:number) {
  const e=Math.min(end,start+1439.99),[x,y]=point(r,start),[ex,ey]=point(r,e);
  return `M${x} ${y}A${r} ${r} 0 ${e-start>720?1:0} 1 ${ex} ${ey}`;
}
/** One local calendar day. All execution lanes use ISO-backed intervals and the same date window. */
export function Spiral({snap,hoverPlan,size=200,focusTaskId,onLocate,onPlan}: {
  snap:Snapshot;hoverPlan:string|null;size?:number;focusTaskId?:string|null;
  onLocate:(taskId:string,itemId?:string)=>void;onPlan?:(planId:string)=>void;
}) {
  const zone=snap.project.timeZone ?? 'Asia/Shanghai';
  const [start,end]=dayBounds(snap.date,zone);
  const position=(ms:number)=>(ms-start)/(end-start)*1440;
  const intervals=visibleIntervals(snap);
  const visible=focusTaskId?intervals.filter(i=>i.taskId===focusTaskId):intervals;
  const agents=snap.agents.filter(a=>a.tracked && intervals.some(i=>i.agentId===a.id));
  const radius=(id:string)=>60-Math.max(0,agents.findIndex(a=>a.id===id))*7;
  const lanes = new Map<string,number>();
  const ends: number[] = [];
  [...visible].sort((a,b)=>a.from-b.from).forEach(i=>{ let lane=ends.findIndex(e=>e<=i.from); if(lane<0)lane=ends.length; ends[lane]=i.to; lanes.set(i.id,lane); });
  const laneRadius=(i:number)=>62-i*Math.min(5,30/Math.max(1,ends.length-1));
  const ticks=Array.from({length:24},(_,i)=>{try{return {hour:i,min:position(Date.parse(instant(`${String(i).padStart(2,'0')}:00`,snap.date,zone)))};}catch{return null;}}).filter((v):v is {hour:number;min:number}=>v!==null);
  const nowMin=position(Date.parse(snap.timeline?.asOf ?? instant(snap.now,snap.date,zone)));
  const [nx,ny]=point(94,Math.max(0,Math.min(nowMin,1440)));
  const activate=(taskId?:string,itemId?:string)=>taskId ? ()=>onLocate(taskId,itemId):undefined;
  const keys=(fn?:()=>void)=> (e:React.KeyboardEvent<SVGPathElement>)=> {if(fn && (e.key==='Enter'||e.key===' ')){e.preventDefault();fn();}};
  return <svg width={size} height={size} viewBox="-8 -8 216 216" className="qd-spiral" role="group" aria-label={`今日节奏：00:00 至 24:00，${zone}；当前 ${snap.now}`}>
    {ticks.map(({hour,min})=> {const [x,y]=point(91,min),[ex,ey]=point(hour%6?89:87,min);return <line key={hour} x1={x} y1={y} x2={ex} y2={ey} className="qd-tick"/>;})}
    {ticks.filter(t=>t.hour%6===0).map(({hour,min})=>{const [x,y]=point(99,min);return <text key={hour} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="qd-clock-label">{String(hour).padStart(2,'0')}</text>;})}
    <circle cx="100" cy="100" r="85" className="qd-ring"/>
    <circle cx="100" cy="100" r="74" className="qd-ring"/>
    {focusTaskId ? ends.map((_,i)=><circle key={i} cx="100" cy="100" r={laneRadius(i)} className="qd-ring thin"/>) : agents.map(a=><circle key={a.id} cx="100" cy="100" r={radius(a.id)} className="qd-ring thin"/>)}
    {snap.plans.map(p=>{
      const at=Date.parse(instant(p.start,snap.date,zone)),s=position(at),e=Math.min(1440,position(at+p.minutes*60000));
      const fn=p.taskId?activate(p.taskId,p.workItemId):onPlan?()=>onPlan(p.id):undefined;
      return <path key={p.id} d={arc(85,s,e)} className={`qd-arc-plan ${p.kind} ${hoverPlan===p.id?'is-hover':''}`} tabIndex={fn?0:undefined} role={fn?'button':undefined} onClick={fn} onKeyDown={keys(fn)} aria-label={`计划 ${p.title} ${p.start} · ${p.minutes} 分钟`}><title>{`计划 ${p.title} ${p.start} · ${p.minutes}m`}</title></path>;
    })}
    {snap.plans.flatMap(p=>planRanges(p,snap).map(([s,e],i)=>{
      const fn=p.taskId?activate(p.taskId,p.workItemId):onPlan?()=>onPlan(p.id):undefined;
      return <path key={`${p.id}:${i}`} d={arc(74,position(s),position(e))} className={`qd-arc-actual ${hoverPlan===p.id?'is-hover':''}`} tabIndex={fn?0:undefined} role={fn?'button':undefined} onClick={fn} onKeyDown={keys(fn)} aria-label={`实际 ${p.title}，点击查看`}><title>{`实际 ${p.title}`}</title></path>;
    }))}
    {visible.filter(i=>!snap.plans.some(p=>planIncludesInterval(p,i,snap))).map(i=><path key={`actual:${i.id}`} d={arc(74,i.from,i.to)} className="qd-arc-actual" />)}
    {visible.map(i=>{
      const a=snap.agents.find(a=>a.id===i.agentId);if(!a?.tracked)return null;
      const task=i.taskId?snap.tasks[i.taskId]:undefined;
      const item=i.taskId&&i.workItemId?snap.orchestrations?.[i.taskId]?.items[i.workItemId]:undefined;
      const fn=activate(i.taskId,i.workItemId);
      const label=`${a.short} · ${item?.title ?? task?.title ?? '历史活动'} · ${i.startLabel}—${i.endLabel}${i.end===null?' · 运行中':''}`;
      return <path key={i.id} d={arc(focusTaskId ? laneRadius(lanes.get(i.id) ?? 0) : radius(a.id),i.from,i.to)} stroke={a.color} className="qd-arc-agent" tabIndex={fn?0:undefined} role={fn?'button':undefined} onClick={fn} onKeyDown={keys(fn)} aria-label={label}><title>{label}</title></path>;
    })}
    {nowMin>=0 && nowMin<=1440 && <><line x1="100" y1="100" x2={nx} y2={ny} className="qd-hand"/><circle cx={nx} cy={ny} r="2.8" className="qd-now-dot"/></>}
    <circle cx="100" cy="100" r="24" className="qd-center"/>
    <text x="100" y="101" className="qd-center-time" textAnchor="middle" dominantBaseline="middle">{snap.now}</text>
  </svg>;
}
