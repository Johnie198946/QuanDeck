import { useState } from 'react';
import type { CanvasIdea, InspirationNode } from '../../data/inspirationCanvas';
import { Icon } from '../ui/Icon';

export function IdeaCardEditor({node, save}:{node:InspirationNode; save:(original:CanvasIdea,next:CanvasIdea)=>Promise<boolean>}) {
  const [original,setOriginal]=useState<CanvasIdea>();
  const [draft,setDraft]=useState<CanvasIdea>();
  const [pending,setPending]=useState(false);
  function begin(){
    if(!node.idea)return;
    setOriginal(node.idea);setDraft(structuredClone(node.idea));
  }
  if(!draft || !original)return <button className="qd-card-edit" onClick={begin}><Icon name="pencil" size={14}/>编辑卡片</button>;
  async function submit(){
    if(!draft || !original || !draft.title.trim())return;
    setPending(true);
    try {if(await save(original,{...draft,title:draft.title.trim(),detail:draft.detail.trim()}))setDraft(undefined);}
    finally {setPending(false);}
  }
  return <form className="qd-card-form" onSubmit={e=>{e.preventDefault();void submit();}}>
    <label>卡片名称<input required value={draft.title} maxLength={240} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <label>卡片说明<textarea value={draft.detail} rows={3} onChange={e=>setDraft({...draft,detail:e.target.value})}/></label>
    {draft.method && (['input','output','standard'] as const).map((key,i)=><label key={key}>{['输入','输出','检查标准'][i]}<textarea rows={2} value={draft.method![key]} onChange={e=>setDraft({...draft,method:{...draft.method!,[key]:e.target.value}})}/></label>)}
    <div><button type="button" disabled={pending} onClick={()=>setDraft(undefined)}>取消</button><button type="submit" disabled={pending||!draft.title.trim()}>保存卡片</button></div>
  </form>;
}
