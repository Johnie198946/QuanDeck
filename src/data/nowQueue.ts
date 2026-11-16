import type { ProjectActivityEntry } from './projectActivity';
export interface NowQueueState { order: string[]; compactOrder: string[]; hidden: string[] }
export type NowQueueCommand = { type:'hide';id:string } | { type:'restore';id:string } | { type:'move';id:string;beforeId:string|null;view:'compact'|'all' };
const waiting=(entry:ProjectActivityEntry)=>entry.state==='waiting_reply'||entry.state==='waiting_permission';
const rank=(entries:ProjectActivityEntry[],order:string[])=>{
 const indices=new Map(order.map((id,i)=>[id,i]));
 return [...entries].sort((a,b)=>(indices.get(a.id)??Number.MAX_SAFE_INTEGER)-(indices.get(b.id)??Number.MAX_SAFE_INTEGER));
};
export function nowQueueView(entries:ProjectActivityEntry[],state?:NowQueueState,limit=3) {
 const all=rank(entries.filter(entry=>!state?.hidden.includes(entry.id)),state?.order??[]);
 const ordered=rank(all,state?.compactOrder??[]);
 const required=new Set([ordered.find(waiting)?.id,ordered.find(entry=>entry.state==='running')?.id].filter(Boolean));
 for(const item of ordered) { if(required.size>=limit) break;required.add(item.id); }
 return {all,compact:ordered.filter(entry=>required.has(entry.id)).slice(0,limit),hidden:entries.filter(entry=>state?.hidden.includes(entry.id))};
}
export function updateNowQueue(entries:ProjectActivityEntry[],old:NowQueueState|undefined,command:NowQueueCommand):NowQueueState {
 const ids=new Set(entries.map(entry=>entry.id));
 if(!ids.has(command.id)) throw new Error('这项执行已结束或不在当前项目中');
 const next:NowQueueState={order:[...(old?.order??[])],compactOrder:[...(old?.compactOrder??[])],hidden:[...(old?.hidden??[])]};
 if(command.type==='hide') next.hidden=[...new Set([...next.hidden,command.id])].slice(-500);
 else if(command.type==='restore') next.hidden=next.hidden.filter(id=>id!==command.id);
 else {
  if(command.beforeId && (!ids.has(command.beforeId)||command.beforeId===command.id)) throw new Error('排序位置已变化，请重试');
  const field=command.view==='all'?'order':'compactOrder';
  const ordered=[...new Set([...next[field].filter(id=>ids.has(id)),...entries.map(entry=>entry.id)])].filter(id=>id!==command.id);
  const index=command.beforeId?ordered.indexOf(command.beforeId):ordered.length;
  ordered.splice(index,0,command.id);next[field]=ordered;
 }
 return next;
}
