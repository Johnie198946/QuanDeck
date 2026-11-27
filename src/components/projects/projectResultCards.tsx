import { useState } from 'react';
import { taskKey } from '../../data/collaboration';
import { OutputDialog } from '../outputs/OutputDialog';
import type { Snapshot, OutputAttachment } from '../../data/types';
import { deliverySlotKey, type DeliverySlot, DELIVERY_STATE, type deliveryPresentation } from '../../data/deliveryPresentation';
import { resultExcerpt } from '../../data/resultExcerpt';
import { Icon, type IconName } from '../ui/Icon';

type HistoryItem=ReturnType<typeof deliveryPresentation>['history'][number];
export type ProjectResultCard = {
  key:string; history:boolean; title:string; summary:string; kind:string; state:string; task:string; at?:string; author?:string;
};
export type ResultFilters={query:string;kind:string;state:string};
export const clearResultFilters:ResultFilters={query:'',kind:'',state:''};
function kindOf(format='',files:OutputAttachment[]=[],body='') {
  const formats=[format,...files.flatMap(file=>[file.type,file.name.split('.').at(-1)??''])].join(' ').toLowerCase();
  if (/powerpoint|presentation|\bpptx?\b|\bkey\b/.test(formats)) return '演示文稿';
  if (/spreadsheet|excel|\bxlsx?\b|\bcsv\b/.test(formats)) return '表格';
  if (/image\/|\b(png|jpe?g|gif|webp)\b/.test(formats)||/!\[.*?\]\(/.test(body)) return '图文';
  if (/video\/|\b(mp4|webm|mov)\b/.test(formats)) return '视频';
  return '文档';
}
export function slotCard(snap:Snapshot,slot:DeliverySlot):ProjectResultCard {
  return {key:deliverySlotKey(slot),history:false,title:slot.title,summary:resultExcerpt(slot.artifact?.body||slot.description||'',80),
    kind:kindOf(slot.contract?.format,slot.artifact?.attachments,slot.artifact?.body),state:DELIVERY_STATE[slot.state],
    task:(slot.workItemId&&snap.orchestrations?.[slot.taskId]?.items[slot.workItemId]?.title)||snap.tasks[slot.taskId]?.title||'',at:slot.artifact?.createdAt};
}
export function historyCard(snap:Snapshot,row:HistoryItem):ProjectResultCard {
  const {record}=row.entry;
  const agent=record.agentId ?? (row.entry.sessionId && snap.sessions[row.entry.sessionId]?.agentId);
  return {key:record.id,history:true,title:record.title,summary:resultExcerpt(record.text,80),
    kind:kindOf('',record.attachments,record.text),state:row.entry.status,task:row.taskTitle,at:record.at,
    author:record.origin==='human'?'我':snap.agents.find(item=>item.id===agent)?.name};
}
export function matchesResult(card:ProjectResultCard,filters:ResultFilters) {
  const text=filters.query.trim().toLocaleLowerCase();
  return (!filters.kind||card.kind===filters.kind)&&(!filters.state||card.state===filters.state)&&(!text||[card.title,card.task,card.summary].some(value=>value.toLocaleLowerCase().includes(text)));
}
const kinds:Record<string,IconName>={'演示文稿':'play','表格':'chart','图文':'expand','视频':'play','文档':'folder'};
export function ProjectResultIndex({cards,active,pick,timeZone}:{cards:ProjectResultCard[];active?:string;pick:(key:string,history:boolean)=>void;timeZone?:string}) {
  const formatter=new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',timeZone});
  return <nav className="qm-result-index" aria-label="交付件地图">{cards.map(card=><button key={JSON.stringify([card.history,card.key])} type="button"
    aria-current={active===card.key?'true':undefined} onClick={()=>pick(card.key,card.history)}>
    <span className="qm-file-icon" data-kind={card.kind}><Icon name={kinds[card.kind]} size={21}/></span>
    <span className="qm-result-copy"><strong>{card.title}</strong><small>{card.kind} · {card.task}</small>
      {card.summary&&<span>{card.summary}</span>}
      <span className="qm-result-meta"><em data-status={card.state}>{card.state}</em><small>{[card.author,card.at&&Number.isFinite(Date.parse(card.at))?formatter.format(new Date(card.at)):undefined].filter(Boolean).join(' · ')}</small></span>
    </span></button>)}</nav>;
}

export function ProjectSubmit({snap,items}:{snap:Snapshot;items:{taskId:string;itemId?:string;title:string}[]}) {
  const [choosing, setChoosing]=useState(false);
  const [picked,setPicked]=useState<(typeof items)[number]>();
  const eligible=items.filter(item=>{
    const record=snap.collaboration?.tasks[taskKey(item.taskId,item.itemId)];
    return !record?.archived && record?.status!=='done' && record?.status!=='cancelled';
  });
  if (!eligible.length) return null;
  const draft=picked && Object.values(snap.outputs??{}).find(output=>output.taskId===picked.taskId && (output.workItemId??null)===(picked.itemId??null) && output.status==='draft');
  return <div className="qm-submit">
    <button type="button" className="qp-btn primary" aria-expanded={choosing} onClick={()=>setChoosing(!choosing)}><Icon name="plus" size={15}/>提交成果</button>
    {choosing&&<section className="qm-submit-options" aria-label="选择提交成果的任务" onKeyDown={event=>{if(event.key==='Escape')setChoosing(false);}}>
      <header>选择任务<button type="button" aria-label="关闭任务选择" onClick={()=>setChoosing(false)}><Icon name="close" size={14}/></button></header>
      {eligible.map(item=><button type="button" key={taskKey(item.taskId,item.itemId)} onClick={()=>{setPicked(item);setChoosing(false);}}>{item.title}<Icon name="chevron-right" size={14}/></button>)}
    </section>}
    {picked&&<OutputDialog taskId={picked.taskId} itemId={picked.itemId} output={draft} onClose={()=>setPicked(undefined)}/>}
  </div>;
}
