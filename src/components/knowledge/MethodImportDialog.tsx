import {useEffect,useRef,useState} from 'react';
import {desktopHost} from '../../integration/desktop';
import {KNOWLEDGE_FILES,type KnowledgeNote} from '../../data/knowledgeNotes';
import type {InspirationBoard} from '../../data/inspirationCanvas';
import {methodFragment,type MethodInput,type MethodPreview} from '../../data/methodImport';
import {saveOutputFile,removeOutputFile} from '../../data/outputFiles';
import type {OutputAttachment} from '../../data/types';
import {Icon} from '../ui/Icon';
import './method-import.css';

interface Item { key:string; label:string; file?:File; input?:MethodInput }
interface Result { item:Item; preview?:MethodPreview; error?:string }
const message=(e:unknown)=> e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'未能读取这份资料';
export function MethodImportDialog({notes,close,apply}:{notes:KnowledgeNote[];close:()=>void;apply:(board:InspirationBoard)=>Promise<boolean>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const alive=useRef(true), applying=useRef(false);
  const [tab,setTab]=useState<'note'|'file'|'url'>('note');
  const [find,setFind]=useState(''),[noteIds,setNoteIds]=useState<string[]>([]),[files,setFiles]=useState<File[]>([]),[links,setLinks]=useState('');
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[results,setResults]=useState<Result[]>(),[chosen,choose]=useState<string[]>([]);
  useEffect(()=>{alive.current=true;dialog.current?.showModal();return ()=>{alive.current=false;};},[]);
  const available=notes.filter(n=>!n.archivedAt),urls=Array.from(new Set(links.split(/\s+/u).filter(Boolean)));
  const selectionCount=noteIds.length+files.length+urls.length;
  function addFiles(next:File[]) {
    if(next.some(f=>f.size>25*1024*1024)){setError('单个文件上限为 25 MB。');return;}
    setFiles(current=>[...current,...next.filter(f=>!current.some(old=>old.name===f.name&&old.size===f.size&&old.lastModified===f.lastModified))]);setError('');
  }
  function toggle(list:string[],key:string) {return list.includes(key)?list.filter(x=>x!==key):[...list,key];}
  async function analyze(){
    const host=desktopHost();
    if(!host?.analyzeMethod){setError('请在桌面版连接 Agent 后导入。');return;}
    const items:Item[]=[];
    for(const note of available.filter(n=>noteIds.includes(n.id))) {
      items.push({key:'n'+note.id,label:note.title,input:{kind:'note',id:note.id}});
      for(const f of note.attachments)items.push({key:'a'+note.id+'/'+f.id,label:f.name,input:{kind:'note',id:note.id,fileId:f.id}});
    }
    files.forEach((f,i)=>items.push({key:'f'+i,label:f.name,file:f}));
    try {urls.forEach(raw=>{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();items.push({key:'u'+url.href,label:url.hostname,input:{kind:'url',url:url.href}});});}
    catch {setError('请输入完整的公开网页地址，每行一个。');return;}
    if(!items.length)return;
    setError('');setBusy('正在读取资料…');
    const response:Result[]=new Array(items.length);
    let at=0,done=0;
    async function worker(){
      while(at<items.length&&alive.current) {
        const i=at++, item=items[i];
        try {
          const input=item.input ?? {kind:'file' as const,name:item.file!.name,bytes:await item.file!.arrayBuffer()};
          response[i]={item,preview:await host!.analyzeMethod!(input)};
        }catch(cause){response[i]={item,error:message(cause)};}
        if(alive.current)setBusy('已分析 '+(++done)+' / '+items.length);
      }
    }
    await Promise.all([worker(),worker()]);
    if(alive.current){setResults(response);choose(response.filter(r=>r.preview?.steps.length).map(r=>r.item.key));setBusy('');}
  }
  async function commit(){
    if(!results||applying.current)return;
    applying.current=true;setBusy('正在加入画布…');setError('');
    const stored:OutputAttachment[]=[];
    try {
      const rows=[];
      for(const r of results.filter(r=>chosen.includes(r.item.key)&&r.preview)) {
        const preview=r.preview!;
        const src=preview.source;
        if((src.kind==='note'||src.kind==='noteFile')&&!notes.some(n=>n.id===src.noteId&&n.revision===src.revision))
          throw Error('来源笔记已变化，请返回重新分析。');
        const file=r.item.file?await saveOutputFile(KNOWLEDGE_FILES,r.item.file):undefined;
        if(file)stored.push(file);
        rows.push({preview,file});
      }
      if(!await apply(methodFragment(rows)))throw Error('画布未保存，可重试。');
      close();
    }catch(cause){
      const cleanup=await Promise.allSettled(stored.map(f=>removeOutputFile(KNOWLEDGE_FILES,f.id)));
      setError(message(cause)+(cleanup.some(r=>r.status==='rejected')?' 部分暂存文件仍需清理。':''));
    }finally{applying.current=false;if(alive.current)setBusy('');}
  }
  return <dialog ref={dialog} className="qd-method-import-dialog" aria-labelledby="qd-method-title" onCancel={e=>{e.preventDefault();if(!applying.current)close();}}>
    <header><div><h3 id="qd-method-title">{results?'导入预览':'从资料生成工作流'}</h3><p>{results?'选择要加入画布的内容。':'选择方法文档或碎片灵感，先看识别结果。'}</p></div><button aria-label="关闭导入" disabled={applying.current} onClick={close}><Icon name="close" size={17}/></button></header>
    <div className="qd-method-body">
    {results ? results.map(({item,preview,error:fail})=><article key={item.key} className="qd-method-preview">
      <label><input type="checkbox" disabled={!!busy||!preview?.steps.length} checked={chosen.includes(item.key)} onChange={()=>choose(toggle(chosen,item.key))}/>
      <b>{preview?.source.title || item.label}</b><small data-flow={preview?.classification==='workflow'}>{!preview?'未读取':preview.classification==='workflow'?'方法流程':'参考灵感'}</small></label>
      <p>{fail||preview?.reason}</p>
      {preview&&<>{'partial' in preview.source&&preview.source.partial&&<small>依据可读取的正文片段</small>}
      {preview.steps.map(s=><details key={s.id}><summary>{s.title}<span>{s.component}</span></summary><p>{s.detail}</p><MethodEvidence step={s}/></details>)}
      {preview.links.length>0&&<ul>{preview.links.map(e=><li key={e.from+'-'+e.to}>{preview.steps.find(s=>s.id===e.from)?.title} → {preview.steps.find(s=>s.id===e.to)?.title} · {e.label}</li>)}</ul>}</>}
    </article>):<>
      <div className="qd-method-tabs">{([['note','帮你记'],['file','文件'],['url','链接']] as const).map(([key,label])=><button key={key} aria-pressed={tab===key} disabled={!!busy} onClick={()=>setTab(key)}>{label}</button>)}</div>
      <fieldset disabled={!!busy}>
      {tab==='note'?<><input className="qd-method-search" aria-label="查找来源笔记" placeholder="查找笔记" value={find} onChange={e=>setFind(e.target.value)}/>
      <div className="qd-method-notes">{available.filter(n=>(n.title+' '+n.body).toLocaleLowerCase().includes(find.toLocaleLowerCase())).map(n=>
        <label key={n.id}><input type="checkbox" checked={noteIds.includes(n.id)} onChange={()=>setNoteIds(toggle(noteIds,n.id))}/>{n.title}</label>)}</div>
      {!available.length&&<p>还没有笔记，也可以从文件或链接导入。</p>}</>:
      tab==='file'?<><label className="qd-method-files" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)addFiles(Array.from(e.dataTransfer.files));}}>选择或拖入文件
        <small>Word、Excel、PPT、文本；Mac 还支持 PDF 和图片文字识别。</small>
        <input aria-label="选择方法文件" type="file" multiple onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value='';}}/></label>
        {files.map((f,i)=><div className="qd-method-file" key={f.name+i}><span>{f.name}</span><button aria-label={'移除 '+f.name} onClick={()=>setFiles(files.filter((_,j)=>j!==i))}><Icon name="close" size={14}/></button></div>)}</>:
      <label>公开网页<textarea rows={4} placeholder="每行一个网址" value={links} onChange={e=>setLinks(e.target.value)}/></label>}
      </fieldset></>}
      {error&&<p role="alert">{error}</p>}
    </div>
    <footer>{results?<button disabled={!!busy} onClick={()=>{setResults(undefined);setError('');}}>返回资料</button>:<span>已选 {selectionCount} 份资料</span>}
    <button className="qd-method-primary" disabled={!!busy||(results?!chosen.length:!selectionCount)} onClick={()=>void(results?commit():analyze())}>{busy||(results?'加入画布':'AI 识别')}</button></footer>
  </dialog>;
}
function MethodEvidence({step}:{step:MethodPreview['steps'][number]}) {
  return <>{[ ['输入',step.input],['输出',step.output],['标准',step.standard]].filter(([,v])=>v).map(([k,v])=><p key={k}>{k} · {v}</p>)}<blockquote>{step.quote}</blockquote></>;
}
