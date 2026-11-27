import { useEffect, useRef, useState } from 'react';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { saveNoteGraphLinks } from '../../data/knowledgeStore';
import { Icon } from '../ui/Icon';

type Props = {
  notes: KnowledgeNote[];
  onClose: () => void;
} & ({root: KnowledgeNote; initialIds: string[]; onUpdated: () => void} | {root?: undefined; onPick: (id: string) => void});

export function NoteGraphPicker(props: Props) {
  const {notes, onClose, root} = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(() => new Set(props.root ? props.initialIds : []));
  const [chosen, setChosen] = useState(() => new Set(initial));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const saving = useRef(false);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  const candidates = notes.filter(n => n.id !== root?.id && n.title.normalize('NFKC').toLocaleLowerCase().includes(search.trim().normalize('NFKC').toLocaleLowerCase()));
  const added = [...chosen].filter(id => !initial.has(id)).length;
  const removed = [...initial].filter(id => !chosen.has(id)).length;
  async function save() {
    if (!props.root || saving.current || !added && !removed) return;
    saving.current = true;
    setBusy(true);
    setIssue('');
    try {
      await saveNoteGraphLinks(props.root.id,[...initial],[...chosen]);
      props.onUpdated();
    } catch (cause) {
      setIssue(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { saving.current = false; setBusy(false); }
  }
  return <dialog className="qd-personal-picker" ref={dialog} aria-labelledby="personal-picker-title"
    onCancel={event => {event.preventDefault();if (!saving.current) onClose();}}>
    <header><h2 id="personal-picker-title">{root ? '关联其他图谱' : '选择中心笔记'}</h2>
      <button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" size={17}/></button></header>
    {root && <p>为《{root.title}》勾选直接关联的笔记。更新后，两篇笔记都能看到这条连线。</p>}
    <input type="search" autoFocus aria-label="搜索笔记" placeholder="搜索笔记标题" value={search} onChange={e => setSearch(e.target.value)}/>
    <div className="qd-personal-choices">
      {candidates.map(n => root ? <label key={n.id}><input type="checkbox" aria-label={n.title} checked={chosen.has(n.id)} disabled={busy} onChange={event => {
        const checked = event.target.checked;
        setChosen(previous => {const next = new Set(previous); if (checked) next.add(n.id); else next.delete(n.id); return next;});
      }}/><span>{n.title}<small>{n.body.trim().slice(0,64)}</small></span></label>
        : <button key={n.id} type="button" onClick={() => {if (!props.root) props.onPick(n.id);}}>{n.title}<Icon name="arrow-right" size={14}/></button>)}
      {!candidates.length && <p>{search ? '没有匹配的笔记' : '还没有其他可关联的笔记'}</p>}
    </div>
    {issue && <p role="alert">{issue}</p>}
    <footer>{root && <small role="status">{added || removed ? [added && ('新增 '+added+' 篇'),removed && ('解除 '+removed+' 篇')].filter(Boolean).join(' · ') : '已关联 '+initial.size+' 篇'}</small>}
      <button type="button" disabled={busy} onClick={onClose}>取消</button>
      {root && <button type="button" className="primary" disabled={busy || !added && !removed} onClick={() => void save()}>{busy ? '正在保存…' : '更新图谱'}</button>}</footer>
  </dialog>;
}
