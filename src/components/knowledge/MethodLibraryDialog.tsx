import { useEffect, useRef, useState } from 'react';
import type { KnowledgeLibrary } from '../../data/knowledgeNotes';
import { createMethodBoard, deleteMethodBoard, deleteMethodTemplate, renameMethodBoard, saveMethodTemplate, type MethodBoard } from '../../data/methodBoards';
import { summarizeMethod } from '../../data/methodImport';
import { Icon } from '../ui/Icon';

export type BoardAction = 'create' | 'rename' | 'delete' | 'save' | 'templates';
export type WriteLibrary = (apply: (library: KnowledgeLibrary) => void, cleanup?: boolean) => Promise<KnowledgeLibrary | undefined>;
const headings: Record<BoardAction,string> = {create:'新建画布',rename:'重命名画布',delete:'删除画布',save:'保存为方法模板',templates:'方法模板库'};

export function MethodLibraryDialog({action,current,library,write,close,initialTemplateId}:{
  initialTemplateId?:string; action:BoardAction; current?:MethodBoard; library:KnowledgeLibrary; write:WriteLibrary; close:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const snapshot=useRef(current);
  const entry=snapshot.current;
  const [title,setTitle]=useState(action==='create'?'':entry?.title??'');
  const [summary,setSummary]=useState('');
  const [removing,setRemoving]=useState('');
  const [pending,setPending]=useState(false), [error,setError]=useState('');
  const [thinking,setThinking]=useState(false);
  const templates=library.methodTemplates??[];
  useEffect(()=>{
    dialog.current?.showModal();
    if(initialTemplateId && action==='templates') {
      const item=Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-template]')??[]).find(el=>el.dataset.template===initialTemplateId);
      item?.focus();item?.scrollIntoView({block:'nearest'});
    }
  },[initialTemplateId,action]);
  async function apply(update:(lib:KnowledgeLibrary)=>void, cleanup=false, exit=true) {
    setPending(true);setError('');
    try {
      const fresh=await write(update,cleanup);
      if(!fresh) throw Error('未能保存更改，请重试。');
      if(exit) close();
      else setRemoving('');
    } catch(cause){setError(cause instanceof Error?cause.message:'未能保存更改，请重试。');}
    finally {setPending(false);}
  }
  async function summarize() {
    if(!entry)return;
    setThinking(true);setError('');
    try {setSummary(await summarizeMethod(title.trim()||entry.title,entry.board,library.notes));}
    catch(cause){setError(cause instanceof Error?cause.message:'总结未完成，可直接填写。');}
    finally {setThinking(false);}
  }
  function submit(){
    if(action==='create') return apply(lib=>{createMethodBoard(lib,title);});
    if(!entry)return;
    if(action==='rename')return apply(lib=>renameMethodBoard(lib,entry.id,title));
    if(action==='delete')return apply(lib=>deleteMethodBoard(lib,entry.id),true);
    if(action==='save')return apply(lib=>{saveMethodTemplate(lib,entry.id,title,summary,JSON.stringify(entry.board));});
  }
  return <dialog className="qd-method-dialog" ref={dialog} aria-label={headings[action]} onCancel={e=>{e.preventDefault();if(!pending)close();}}>
    <header><h3>{headings[action]}</h3><button type="button" aria-label="关闭窗口" disabled={pending} onClick={close}><Icon name="close" size={17}/></button></header>
    {action==='templates'? <div className="qd-method-shelf">
      {!templates.length && <p>还没有方法模板。在画布上点「存为模板」，下次可以直接复用。</p>}
      {templates.map(template=><article key={template.id} data-template={template.id} data-target={initialTemplateId===template.id} tabIndex={-1}>
        <div><strong>{template.title}</strong><small>{template.board.nodes.length} 张卡片 · {template.board.links.length} 条连线</small></div>
        {template.summary && <p>{template.summary}</p>}
        <div className="qd-method-template-actions">{removing===template.id
          ? <><span>删除这个模板？</span><button disabled={pending} onClick={()=>setRemoving('')}>取消</button><button className="danger" disabled={pending} onClick={()=>void apply(lib=>deleteMethodTemplate(lib,template.id),true,false)}>确认删除</button></>
          : <><button disabled={pending} className="accent" onClick={()=>void apply(lib=>{createMethodBoard(lib,template.title,template.id);})}><Icon name="plus" size={14}/>用模板新建</button><button disabled={pending} aria-label={'删除模板「'+template.title+'」'} onClick={()=>setRemoving(template.id)}><Icon name="trash" size={15}/></button></>}
        </div>
      </article>)}
    </div> : <form onSubmit={e=>{e.preventDefault();void submit();}}>
      {action==='delete'? <p>删除「{entry?.title}」及其中的 {entry?.board.nodes.length??0} 张卡片和 {entry?.board.links.length??0} 条连线？已保存的方法模板仍可使用。</p> :
        <label>{action==='save'?'模板名称':'画布名称'}<input autoFocus required placeholder={action==='save'?'例如：出行规划':'例如：日本行程规划'} value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/></label>}
      {action==='save' && <div className="qd-method-summary"><div className="qd-method-summary-label"><label htmlFor="qd-method-summary-text">方法总结</label><button type="button" disabled={thinking||pending} onClick={()=>void summarize()}><Icon name="ask-ai" size={15}/>{thinking?'正在总结…':'让 AI 写总结'}</button></div><textarea id="qd-method-summary-text" rows={4} value={summary} disabled={thinking} placeholder="这套方法适合什么时候用？" onChange={e=>setSummary(e.target.value)}/></div>}
      <footer><button type="button" disabled={pending} onClick={close}>取消</button><button type="submit" disabled={pending||thinking||(action!=='delete'&&!title.trim())} className={action==='delete'?'danger':'primary'}>{action==='delete'?'确认删除':action==='create'?'创建':'保存'}</button></footer>
    </form>}
    {error&&<p role="alert" className="qd-logic-error">{error}</p>}
  </dialog>;
}
