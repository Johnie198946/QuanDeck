import { useEffect, useState } from 'react';
import type { KnowledgeLibrary, NoteMemoryRef, QuestionMaterials } from '../../data/knowledgeNotes';
import { onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';

interface Pick { label:string; ref:NoteMemoryRef }
export function NoteQuestionMaterials({onChange}:{onChange:(value: QuestionMaterials)=>void}) {
  const [library,setLibrary] = useState<KnowledgeLibrary>();
  const [opened,setOpened] = useState(false);
  const [source,setSource] = useState('');
  const [quote,setQuote] = useState<{start:number;end:number}>();
  const [picks,setPicks] = useState<Pick[]>([]);
  const [background,setBackground] = useState('');
  const [error,setError] = useState('');
  useEffect(()=>{
    if (!opened) return;
    let version=0;
    const refresh=()=>{
      const current=++version;
      void readKnowledge().then(next=>{
        if (current === version) { setLibrary(next); setError(''); }
      }).catch(()=>{ if (current === version) setError('暂时读不到参考笔记。'); });
    };
    const off=onKnowledgeChange(refresh);
    refresh();
    return ()=>{version++; off();};
  },[opened]);
  function update(next: Pick[], text:string) {
    setPicks(next);setBackground(text);
    onChange({...(text.trim() && {background:text.trim()}),...(next.length && {memoryRefs:next.map(p=>p.ref)})});
  }
  const note=library?.notes.find(n=>'n:'+n.id===source);
  const card=library?.inspirationCanvas?.nodes.find(n=>'i:'+n.noteId===source);
  const add=()=>{
    const pick:Pick|undefined=note && quote ? {label:note.body.slice(quote.start,quote.end),ref:{kind:'passage',noteId:note.id,revision:note.revision,...quote}} :
      card?.idea ? {label:card.idea.title,ref:{kind:'idea',nodeId:card.noteId,title:card.idea.title,detail:card.idea.detail}} : undefined;
    if(pick && !picks.some(p=>JSON.stringify(p.ref)===JSON.stringify(pick.ref))) update([...picks,pick],background);
    setSource('');setQuote(undefined);
  };
  return <details className="qd-question-materials" onToggle={e=>setOpened(e.currentTarget.open)}>
    <summary>补充背景与参考{picks.length ? ' · '+picks.length : ''}</summary>
    <label>补充背景<textarea aria-label="补充背景" rows={2} value={background} onChange={e=>update(picks,e.target.value)}/></label>
    <label>引用<select value={source} onChange={e=>{setSource(e.target.value);setQuote(undefined);}}>
      <option value="">选择笔记选段或灵感卡片</option>
      <optgroup label="笔记">{library?.notes.filter(n=>!n.archivedAt).map(n=><option key={n.id} value={'n:'+n.id}>{n.title || '未命名笔记'}</option>)}</optgroup>
      <optgroup label="灵感卡片">{library?.inspirationCanvas?.nodes.filter(n=>n.idea).map(n=><option key={n.noteId} value={'i:'+n.noteId}>{n.idea!.title}</option>)}</optgroup>
    </select></label>
    {note && <label>划选要引用的文字<textarea aria-label="划选要引用的文字" rows={4} value={note.body} readOnly onSelect={e=>{
      const {selectionStart:start,selectionEnd:end}=e.currentTarget;setQuote(end>start?{start,end}:undefined);
    }}/></label>}
    {!!source && <button type="button" className="qd-link" disabled={!card?.idea && !quote} onClick={add}>加入这段参考</button>}
    {picks.map((p,i)=><div key={i}><span>{p.label.slice(0,45)}</span> <button type="button" className="qd-link" aria-label={'移除参考 '+(i+1)} onClick={()=>update(picks.filter((_,j)=>i!==j), background)}>移除</button></div>)}
    {error && <small role="alert">{error}</small>}
  </details>;
}
