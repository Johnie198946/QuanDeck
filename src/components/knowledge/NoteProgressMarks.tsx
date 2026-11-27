import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { writerLines } from './noteEditorLines';
import type { ProgressRow } from './noteProgressRows';
import './note-progress-marks.css';

interface Slot { host:HTMLElement; root:ShadowRoot; lineIndex:number }
const accent='qd-schedule-passage';
const clock=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

// Keep annotations out of the editable document, its Markdown, and the clipboard.
// Each empty host reserves space at the exact end of its row, including soft-broken paragraphs.
export function NoteProgressMarks({content,seed,body,rows}:{content:RefObject<HTMLElement|null>;seed:RefObject<HTMLElement|null>;body:string;rows:ProgressRow[]}) {
  const [slots,setSlots]=useState<Slot[]>([]);
  const owned=useRef(new Map<number,Slot>());
  useLayoutEffect(()=>{
    const editor=content.current, source=seed.current;
    if(!editor || !source) return;
    const wanted=new Set(rows.map(row=>row.lineIndex));
    let frame=0, composing=false;
    function position(){
      if(composing) return;
      const next:Slot[]=[], ranges:Range[]=[];
      for(const line of wanted.size ? writerLines(editor!,source!,body) : []) {
        if(!wanted.has(line.lineIndex)) continue;
        const range=line.range;
        let slot=owned.current.get(line.lineIndex);
        if(!slot) {
          const host=document.createElement('span');
          host.dataset.scheduleProgress='';
          host.contentEditable='false';
          slot={lineIndex:line.lineIndex,host,root:host.attachShadow({mode:'open'})};
          owned.current.set(line.lineIndex,slot);
        }
        const end=range.endContainer, at=range.endOffset;
        const following=end instanceof Text && at===end.length ? end.nextSibling : end.childNodes[at];
        if(following!==slot.host) {
          if(end instanceof Text && at===end.length) end.after(slot.host);
          else {
            const edge=range.cloneRange();edge.collapse(false);edge.insertNode(slot.host);
          }
        }
        next.push(slot);ranges.push(range);
      }
      const attached=new Set(next);
      for(const [id,slot] of owned.current) if(!attached.has(slot)){slot.host.remove();owned.current.delete(id);}
      if(typeof Highlight==='function') CSS.highlights.set(accent,new Highlight(...ranges));
      setSlots(old=>old.length===next.length && old.every((x,i)=>x===next[i]) ? old : next);
    }
    function queue(){ cancelAnimationFrame(frame);frame=requestAnimationFrame(position); }
    const start=()=>{composing=true;};
    const finish=()=>{composing=false;queue();};
    position();
    const observer=new MutationObserver(queue);
    observer.observe(editor,{childList:true,characterData:true,subtree:true});
    editor.addEventListener('compositionstart',start); editor.addEventListener('compositionend',finish);
    return ()=>{observer.disconnect();cancelAnimationFrame(frame);editor.removeEventListener('compositionstart',start);editor.removeEventListener('compositionend',finish);};
  },[content,seed,body,rows]);
  useLayoutEffect(()=>()=>{for(const slot of owned.current.values())slot.host.remove();owned.current.clear();globalThis.CSS?.highlights?.delete(accent);},[]);
  const byLine=new Map(rows.map(row=>[row.lineIndex,row.events]));
  return <>{slots.map(({lineIndex,root})=>{
    const events=byLine.get(lineIndex);
    if(!events?.length)return null;
    const [latest,...earlier]=events;
    return createPortal(<>
      <style>{cardStyle}</style>
      <aside aria-label="日程进展"><header><strong>日程进展</strong><time dateTime={latest.at}>{clock.format(new Date(latest.at))}</time></header>
        <p>{latest.text}</p>
        {earlier.length>0 && <details><summary>此前 {earlier.length} 条进展</summary><ul>{earlier.map(p=>
          <li key={p.id}><time dateTime={p.at}>{clock.format(new Date(p.at))}</time><p>{p.text}</p></li>)}</ul></details>}
      </aside>
    </>,root,String(lineIndex));
  })}</>;
}

const cardStyle=`
:host{display:block;color:#28483f;font:normal 14px/1.55 system-ui,sans-serif;white-space:normal;text-decoration:none;}
aside{position:relative;margin:10px 0 8px 1.35em;padding:9px 13px;max-width:640px;border-left:2px solid #649a87;border-radius:0 5px 5px 0;background:#f0f6f2;text-align:left}
aside::before{content:'';position:absolute;right:100%;top:-10px;width:12px;height:25px;border-left:1px solid #78a58e;border-bottom:1px solid #78a58e;border-bottom-left-radius:6px}
header{display:flex;gap:10px;align-items:baseline}strong{font-size:12px;font-weight:650}time,summary{font-size:12px;color:#4e695f}
p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:4px}summary{cursor:pointer;width:fit-content}
ul{padding:0;margin:3px 0;list-style:none}li{padding:5px 0;border-top:1px solid #dae6df}
`;
