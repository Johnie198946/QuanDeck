import { methodBoards } from '../../data/methodBoards';
import { useEffect, useState } from 'react';
import type { KnowledgeLibrary, NoteMemoryRef, NoteQuestionContext, QuestionMaterials } from '../../data/knowledgeNotes';
import { onKnowledgeChange, readKnowledge } from '../../data/knowledgeStore';
import { getConfiguredAgents } from '../../integration/configuredAgents';
import { TOOL_LABELS } from '../../integration/contracts';

interface Pick { label: string; ref: NoteMemoryRef }
interface Props {
  onChange: (value: QuestionMaterials) => void;
  surrounding?: NoteQuestionContext;
  quote?: string;
  newQuestion?: boolean;
}

export function NoteQuestionMaterials({ onChange, surrounding, quote, newQuestion }: Props) {
  const [library,setLibrary] = useState<KnowledgeLibrary>();
  const [opened,setOpened] = useState(false);
  const [source,setSource] = useState('');
  const [selection,setSelection] = useState<{start:number;end:number}>();
  const [picks,setPicks] = useState<Pick[]>([]);
  const [background,setBackground] = useState('');
  const [withContext,setWithContext] = useState(false);
  const [agent,setAgent] = useState('');
  const [error,setError] = useState('');
  const profiles = newQuestion && opened ? getConfiguredAgents().filter(profile =>
    profile.connectionId && ['codex','claude','dsh'].includes(profile.tool)) : [];

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

  useEffect(() => {
    onChange({
      ...(background.trim() && {background:background.trim()}),
      ...(picks.length && {memoryRefs:picks.map(p=>p.ref)}),
      ...(withContext && surrounding && {surrounding}),
      ...(agent && {agentConnectionId:agent}),
    });
  }, [background,picks,withContext,surrounding,agent,onChange]);

  const note = library?.notes.find(n=>'n:'+n.id===source);
  const boards = library ? methodBoards(library) : [];
  const cardKey = (boardId:string, nodeId:string) => boardId === 'default' ? 'i:'+nodeId : JSON.stringify([boardId,nodeId]);
  const selectedBoard = boards.find(({id,board})=>board.nodes.some(n=>cardKey(id,n.noteId)===source));
  const card = selectedBoard?.board.nodes.find(n=>cardKey(selectedBoard.id,n.noteId)===source);
  const add = () => {
    let pick: Pick;
    if (note?.body.trim()) {
      const range = selection ?? {start:0,end:note.body.length};
      pick = {label:selection ? note.title+' · '+note.body.slice(range.start,range.end) : note.title,
        ref:{kind:'passage',noteId:note.id,revision:note.revision,...range}};
    } else if (card?.idea) {
      pick = {label:card.idea.title,ref:{kind:'idea',nodeId:card.noteId,boardId:selectedBoard?.id,title:card.idea.title,detail:card.idea.detail}};
    } else return;
    if (!picks.some(p=>JSON.stringify(p.ref)===JSON.stringify(pick.ref))) setPicks([...picks,pick]);
    setSource('');setSelection(undefined);
  };

  return <details className="qd-question-materials" onToggle={e=>setOpened(e.currentTarget.open)}>
    <summary>补充背景与参考{picks.length ? ' · '+picks.length : ''}</summary>
    {profiles.length > 1 && <label>回答者<select value={agent} onChange={e=>setAgent(e.target.value)}>
      <option value="">默认 Agent</option>
      {profiles.map(p=><option key={p.id} value={p.connectionId}>{p.displayName || TOOL_LABELS[p.tool]}</option>)}
    </select></label>}
    {surrounding && (surrounding.before || surrounding.after || surrounding.title) && <>
      <label className="qd-context-toggle"><input type="checkbox" checked={withContext} onChange={e=>setWithContext(e.target.checked)}/>附上原文前后文</label>
      {withContext && <blockquote className="qd-context-preview"><strong>{surrounding.title}</strong>
        <p>{surrounding.before}<mark>{quote}</mark>{surrounding.after}</p></blockquote>}
    </>}
    <label>补充背景<textarea aria-label="补充背景" rows={2} value={background} onChange={e=>setBackground(e.target.value)}/></label>
    <label>引用<select value={source} onChange={e=>{setSource(e.target.value);setSelection(undefined);}}>
      <option value="">选择笔记或灵感</option>
      <optgroup label="笔记">{library?.notes.filter(n=>!n.archivedAt && n.body.trim()).map(n=><option key={n.id} value={'n:'+n.id}>{n.title || '未命名笔记'}</option>)}</optgroup>
      {boards.map(({id,title,board})=><optgroup key={id} label={'灵感 · '+title}>{board.nodes.filter(n=>n.idea).map(n=>
        <option key={n.noteId} value={cardKey(id,n.noteId)}>{n.idea!.title}</option>)}</optgroup>)}
    </select></label>
    {note && <label>也可以只划选一段<textarea aria-label="划选要引用的文字" rows={4} value={note.body} readOnly onSelect={e=>{
      const {selectionStart:start,selectionEnd:end}=e.currentTarget;setSelection(end>start?{start,end}:undefined);
    }}/></label>}
    {(note || card) && <button type="button" className="qd-link" onClick={add}>{note && !selection ? '引用整篇笔记' : '加入这段参考'}</button>}
    {picks.length > 0 && <small>提问时会读取所选参考里的公开网页。</small>}
    {picks.map((p,i)=><div className="qd-reference-pick" key={i}><span title={p.label}>{p.label}</span><button type="button" className="qd-link"
      aria-label={'移除参考 '+(i+1)} onClick={()=>setPicks(picks.filter((_,j)=>i!==j))}>移除</button></div>)}
    {error && <small role="alert">{error}</small>}
  </details>;
}
