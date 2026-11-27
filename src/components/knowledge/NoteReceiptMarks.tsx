import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Snapshot } from '../../data/types';
import { NoteReceiptDetails } from './NoteReceiptDetails';
import { createPortal } from 'react-dom';
import { receiptSelection, unreadReceiptCount, type NoteReceipt, type ReceiptAnchor } from '../../data/noteReceipts';
import { mutateKnowledge } from '../../data/knowledgeStore';
import { resolveNoteRange } from './noteSelectionRange';
import { Icon } from '../ui/Icon';
import './note-receipts.css';

export type OpenNoteReceipt = (row:Pick<NoteReceipt,'projectId'|'taskId'|'itemId'|'resultId'|'attentionId'>) => void;
interface Props {
  projects: Snapshot[];
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

export function NoteReceiptMarks({projects,sheet,body,indexed,noteId,anchors,read,onOpen}:Props) {
  const [pins,setPins]=useState<Pin[]>([]);
  const [detached,setDetached]=useState<ReceiptAnchor[]>([]);
  const [opened,setOpened]=useState<string[]>();
  const [selectedId,setSelectedId]=useState<string | null>(null);
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
    setOpened(group.map(anchor=>anchor.key));
    const rows=uniqueReceipts(group);
    setSelectedId((rows.find(row=>!read?.includes(row.id)) ?? rows[0]).id);
    setError('');
    const unread=rows.filter(row=>!read?.includes(row.id));
    if(unread.length) void acknowledge(unread.map(row=>row.id));
  }

  async function acknowledge(ids:string[]) {
    try {
      setError('');
      await mutateKnowledge(library=>{
        const note=library.notes.find(n=>n.id===noteId);
        if(note)note.readReceiptIds=[...new Set([...(note.readReceiptIds ?? []),...ids])];
      });
    }catch{setError('已读标记未保存。');}
  }

  const showButton=(group:ReceiptAnchor[],y?:number)=>{
    const records=uniqueReceipts(group);
    const count=unreadReceiptCount(group,read), label=records.some(r=>r.kind==='成果')?'成果':records[0].kind;
    return <button type="button" className="qnr-pill" style={y===undefined?undefined:{top:y}} data-unread={!!count}
      aria-label={(y===undefined?'原文位置已变化，':'')+'查看'+records.length+'条任务回执'+(count?'，'+count+'条未读':'')} onClick={()=>reveal(group)}>
      {label}{records.length>1 && <span>{records.length}</span>}
    </button>;
  };
  const group=opened ? anchors.filter(anchor=>opened.includes(anchor.key)) : [];
  const rows=uniqueReceipts(group);
  const selected=selectedId===null ? undefined : rows.find(row=>row.id===selectedId) ?? rows[0];
  return <>
    <div className="qnr-layer" aria-label="原文任务回执">{pins.map(pin=><span key={pin.anchors[0].key}>{showButton(pin.anchors,pin.y)}</span>)}</div>
    {!!detached.length && <div className="qnr-detached"><span>原文位置已变化</span>{showButton(detached)}</div>}
    {opened && createPortal(<dialog ref={dialog} className="qnr-dialog" aria-label="笔记任务回执" onCancel={()=>setOpened(undefined)}>
      <header className="qnr-dialog-head"><h2>任务回执</h2><button autoFocus type="button" className="qd-icon-btn" aria-label="关闭回执" onClick={()=>setOpened(undefined)}><Icon name="close" size={16}/></button></header>
      {group.map(anchor=><blockquote key={anchor.key}>{anchor.quote}</blockquote>)}
      <ul className="qnr-records">{rows.map(row=><NoteReceiptDetails key={row.id} row={row} expanded={row.id===selected?.id}
        project={projects.find(project=>project.project.id===row.projectId)} unread={!read?.includes(row.id)}
        onSelect={()=>{setSelectedId(row.id===selected?.id ? null : row.id);if(!read?.includes(row.id))void acknowledge([row.id]);}} onOpen={onOpen}/>)}</ul>
      {!rows.length && <p role="status">这条回执已处理。</p>}
      {error && <p role="alert">{error}<button className="qd-link" type="button" onClick={()=>void acknowledge(rows.map(row=>row.id))}>重新标为已读</button></p>}
    </dialog>,document.body)}
  </>;
}
