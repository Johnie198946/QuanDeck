import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { receiptSelection, unreadReceiptCount, type NoteReceipt, type ReceiptAnchor } from '../../data/noteReceipts';
import { mutateKnowledge } from '../../data/knowledgeStore';
import { resolveNoteRange } from './noteSelectionRange';
import { Icon } from '../ui/Icon';
import './note-receipts.css';

export type OpenNoteReceipt = (row:Pick<NoteReceipt,'projectId'|'taskId'|'itemId'|'resultId'|'attentionId'>) => void;
interface Props {
  sheet: RefObject<HTMLElement | null>;
  body: string;
  indexed: boolean;
  noteId: string;
  anchors: ReceiptAnchor[];
  read?: string[];
  onOpen: OpenNoteReceipt;
}
interface Pin { y: number; anchors: ReceiptAnchor[] }

function uniqueReceipts(anchors: ReceiptAnchor[]) {
  return Array.from(new Map(anchors.flatMap(anchor => anchor.receipts.map(row => [row.id,row] as const))).values())
    .sort((a,b)=>b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function NoteReceiptMarks({sheet,body,indexed,noteId,anchors,read,onOpen}:Props) {
  const [pins,setPins]=useState<Pin[]>([]);
  const [detached,setDetached]=useState<ReceiptAnchor[]>([]);
  const [opened,setOpened]=useState<ReceiptAnchor[]>();
  const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if (!indexed) {setPins([]);setDetached([]);return;}
    const root=sheet.current, editor=root?.querySelector<HTMLElement>('.qd-writer-content'), seed=root?.querySelector<HTMLElement>('[data-note-source]');
    if (!root || !editor || !seed) return;
    let frame=0;
    const tone='qd-returned-passage';
    function position() {
      const layer=root!.getBoundingClientRect(), scale=layer.height / root!.offsetHeight || 1;
      const ranges:Range[]=[], points:Pin[]=[], lost:ReceiptAnchor[]=[];
      for (const anchor of anchors) {
        const selection=receiptSelection(anchor,body);
        const range=selection && resolveNoteRange(editor!,seed!,body,selection);
        const rect=range && Array.from(range.getClientRects()).filter(box=>box.height && box.width).at(-1);
        if (!range || !rect) {lost.push(anchor);continue;}
        ranges.push(range);
        const y=((rect.top+rect.bottom)/2-layer.top)/scale-root!.clientTop;
        // Two selections can finish on the same screen row. One capsule opens both.
        const existing=points.find(point=>Math.abs(point.y-y)<19);
        if(existing)existing.anchors.push(anchor);
        else points.push({y,anchors:[anchor]});
      }
      if(typeof Highlight==='function') CSS.highlights.set(tone,new Highlight(...ranges));
      setPins(points);setDetached(lost);
    }
    function queue() { cancelAnimationFrame(frame);frame=requestAnimationFrame(position); }
    position();
    const resize=new ResizeObserver(queue);
    resize.observe(root);resize.observe(editor);
    const mutation=new MutationObserver(queue);
    mutation.observe(editor,{childList:true,characterData:true,subtree:true,attributeFilter:['style','src']});
    root.addEventListener('load',queue,true);
    return ()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();root.removeEventListener('load',queue,true);globalThis.CSS?.highlights?.delete(tone);};
  },[anchors,body,indexed,sheet]);

  useEffect(()=>{
    if(!opened) return;
    const el=dialog.current;el?.showModal();
    return ()=>el?.close();
  },[opened]);

  function reveal(group:ReceiptAnchor[]) {
    setOpened(group);setError('');
    const unread=uniqueReceipts(group).filter(row=>!read?.includes(row.id));
    if(unread.length) void acknowledge(unread.map(row=>row.id));
  }

  async function acknowledge(ids:string[]) {
    try {
      await mutateKnowledge(library=>{
        const note=library.notes.find(n=>n.id===noteId);
        if(note)note.readReceiptIds=[...new Set([...(note.readReceiptIds ?? []),...ids])];
      });
      return true;
    }catch{setError('已读标记未保存，可重新点击。');return false;}
  }

  const showButton=(group:ReceiptAnchor[],y?:number)=>{
    const records=uniqueReceipts(group);
    const count=unreadReceiptCount(group,read), label=records.some(r=>r.kind==='成果')?'成果':records[0].kind;
    return <button type="button" className="qnr-pill" style={y===undefined?undefined:{top:y}} data-unread={!!count}
      aria-label={(y===undefined?'原文位置已变化，':'')+'查看'+records.length+'条任务回执'+(count?'，'+count+'条未读':'')} onClick={()=>reveal(group)}>
      {label}{records.length>1 && <span>{records.length}</span>}
    </button>;
  };
  const rows=opened && uniqueReceipts(opened);
  const current=opened && new Map(uniqueReceipts(anchors).map(row=>[row.id,row]));
  return <>
    <div className="qnr-layer" aria-label="原文任务回执">{pins.map(pin=><span key={pin.anchors[0].key}>{showButton(pin.anchors,pin.y)}</span>)}</div>
    {!!detached.length && <div className="qnr-detached"><span>原文位置已变化</span>{showButton(detached)}</div>}
    {opened && rows && createPortal(<dialog ref={dialog} className="qnr-dialog" aria-label="笔记任务回执" onCancel={()=>setOpened(undefined)}>
      <header><h2>任务回执</h2><button autoFocus type="button" className="qd-icon-btn" aria-label="关闭回执" onClick={()=>setOpened(undefined)}><Icon name="close" size={16}/></button></header>
      {opened.map(anchor=><blockquote key={anchor.key}>{anchor.quote}</blockquote>)}
      <ul>{rows.map(row=><li key={row.id}><small>{!read?.includes(row.id) && <i aria-label="未读"/>}{row.kind} · {row.projectName}{row.at && ' · '+new Date(row.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>
        <strong>{row.title}</strong>{row.text && <p>{row.text}</p>}
        {current?.has(row.id) ? <button className="qd-link" type="button" onClick={async()=>{if(!read?.includes(row.id) && !await acknowledge([row.id]))return;onOpen(current.get(row.id)!);}}>
          {row.kind==='提醒'?'处理提醒':row.kind==='分工'?'查看相关任务':'打开这版成果'} <Icon name="external" size={12}/>
        </button> : <small>{row.kind==='提醒'?'这条提醒已经处理。':'这版成果已有更新。'}</small>}</li>)}</ul>
      {rows.some(row=>!read?.includes(row.id)) && <footer><button className="qd-link" type="button" onClick={()=>void acknowledge(rows.map(row=>row.id))}>标为已读</button></footer>}
      {error && <p role="alert">{error}</p>}
    </dialog>,document.body)}
  </>;
}
