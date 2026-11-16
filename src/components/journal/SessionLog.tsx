import { useEffect, useState } from 'react';
import { desktopHost } from '../../integration/desktop';
import { scopedSessionEvents, sessionLogs } from '../../data/sessionLogs';
import { clockTime } from '../../data/format';
import type { Session } from '../../data/types';
import type { LogDensity } from '../../state/preferences';
import './session-log.css';

export function SessionLog({session,density,timeZone,source=session.source}:{session:Pick<Session,'runtime'|'source'>&Partial<Pick<Session,'id'|'rounds'>>;density:LogDensity;timeZone?:string;source?:Session['source']}) {
 const [events,setEvents]=useState<{runId:string;values:unknown[]}>({runId:'',values:[]}),[error,setError]=useState(''),[limit,setLimit]=useState(100);
 const [reading,setReading]=useState(false);
 const runId=session.runtime?.runId,host=desktopHost();
 useEffect(()=>{
  if(density==='brief'||!runId||!host)return;
  let alive=true,sequence=0;
  const read=async()=>{const request=++sequence;try{const run=await host.getRun(runId);if(alive&&request===sequence){setEvents({runId,values:run.events});setError('');}}catch(e){if(alive&&request===sequence)setError(e instanceof Error?e.message:'记录暂不可用');}};
  void read();const off=host.onRunEvent(e=>{if(e.runId===runId)void read();});return()=>{alive=false;off();};
 },[runId,density,host]);
 if(density==='brief')return null;
 const fallback=!source?.childCallId&&!source?.childSessionId?(session.rounds??[]).map(r=>({id:r.id,at:r.at,reply:{text:r.reply}})):[];
 const scoped=runId&&events.runId===runId?scopedSessionEvents(events.values,source??{}):fallback;
 const rows=sessionLogs(scoped,density),shown=rows.slice(-limit);
 const readSource=async()=>{if(!host||!session.id||reading)return;setReading(true);setError('');try{const r=await host.command('prepareSourceSession',[session.id]) as {ok:boolean;message?:string};if(!r.ok)setError(r.message??'源端记录暂不可用');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setReading(false);}};
 return <section className="qd-session-log" aria-label={density==='standard'?'标准执行记录':'详细执行记录'}>
  <header><strong>{density==='standard'?'步骤与工具记录':'事件时间线'}</strong><small>{rows.length?`${rows.length} 条`:''}</small></header>
  {error?<p role="status">{error}</p>:shown.length?<div className="qd-session-log-scroll">{rows.length>limit&&<button className="qd-link" onClick={()=>setLimit(v=>v+100)}>展开更早记录</button>}<ol>{shown.map(row=><li key={row.id}><time dateTime={row.at}>{clockTime(row.at,timeZone)}</time><div><span>{row.title}</span>{row.detail&&<details><summary>查看内容</summary><pre>{row.detail}</pre></details>}</div></li>)}</ol></div>:<p>{density==='standard'?'源端尚未返回可展示的步骤或工具记录。':'当前会话尚无可读取的事件时间线。'}</p>}
  {!runId&&host&&session.id&&source&&<button type="button" className="qd-link" disabled={reading} onClick={()=>void readSource()}>{reading?'读取中…':'读取源端工具记录'}</button>}
 </section>;
}
