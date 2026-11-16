export interface SessionLogEntry {id:string;at:string;kind:string;title:string;detail?:string}
/** Root and child views never borrow another execution's events. */
export function scopedSessionEvents(events:unknown[],source:{sessionId?:string;childSessionId?:string;childCallId?:string}) {
 const child=!!(source.childSessionId||source.childCallId),target=source.childSessionId??source.sessionId;
 return events.filter(raw=>{
  if(!raw||typeof raw!=='object')return false;
  const e=raw as Record<string,any>;
  if(child)return (!!source.childSessionId&&e.targetSessionId===source.childSessionId)|| (!!source.childSessionId&&e.child?.sessionId===source.childSessionId)|| (!!source.childCallId&&e.child?.id===source.childCallId);
  return !e.targetSessionId||e.targetSessionId===target;
 });
}
const labels:Record<string,string>={running:'开始运行',queued:'进入队列',waiting_reply:'等待回复',waiting_permission:'等待权限',paused:'已暂停',done:'执行结束',failed:'执行失败',cancelled:'已取消'};
/** Only public normalized receipts are rendered. Unknown/private payloads are never dumped. */
export function sessionLogs(events:unknown[],density:'standard'|'detailed'):SessionLogEntry[] {
 const result:SessionLogEntry[]=[];
 for(const raw of events){
  if(!raw||typeof raw!=='object')continue;
  const e=raw as Record<string,any>;
  if(typeof e.id!=='string'||typeof e.at!=='string')continue;
  const add=(kind:string,title:unknown,detail?:unknown)=>{if(typeof title==='string'&&title)result.push({id:`${e.id}:${kind}`,at:e.at,kind,title,...(typeof detail==='string'&&detail?{detail}:{})});};
  if(e.log && ['tool','command','file','test','artifact'].includes(e.log.kind))add(e.log.kind,e.log.label,`${typeof e.log.detail==='string'?e.log.detail:''}${typeof e.log.exitCode==='number'?`\n退出码 ${e.log.exitCode}`:''}`.trim());
  if(e.step?.label)add('step',typeof e.step.total==='number'?`${e.step.completed??0}/${e.step.total} 步 · ${e.step.label}`:e.step.label);
  if(e.error)add('error','失败原因',e.error);
  if(density==='standard')continue;
  if(e.status)add('status',labels[e.status]??e.status,e.reason);
  if(typeof e.tokens==='number')add('usage',`累计 ${e.tokens.toLocaleString()} token`);
  if(e.reply?.text)add('reply','本轮结论',e.reply.text);
  if(e.request?.prompt)add('request',e.request.kind==='permission'?'请求权限':'需要回复',e.request.prompt);
  if(e.requestResolved)add('request-resolved','请求已处理');
  if(e.child?.title)add('child',`子 Agent · ${e.child.title}`,labels[e.child.status]??e.child.status);
  if(e.child?.reply)add('child-reply','子 Agent 结论',e.child.reply);
  if(e.notice)add('notice','源端提示',e.notice);
 }
 return result;
}
