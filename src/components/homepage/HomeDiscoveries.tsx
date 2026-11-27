import { useMemo, useState } from 'react';
import type { HomeDiscovery } from '../knowledge/KnowledgePages';
import { Icon } from '../ui/Icon';
import './home-sections.css';

type Props = {
  discoveries: HomeDiscovery[];
  onOpenNote: (id: string, evidenceKey?: string) => void;
  expanded?: boolean;
};

function summary(item: HomeDiscovery) {
  if (item.explanation) return item.explanation;
  if (item.kind === '冲突') return item.evidence.slice(0, 2).join(' ／ ');
  const shared = item.evidence.find(line => line.startsWith('共同提到'));
  if (shared) return shared + '，并引用了同一份资料。';
  return '两份资料引用了同一个链接，可以对照阅读。';
}

/** Each branch is one piece of evidence returned by the knowledge index. */
function ConnectionMap({ selected, links, select, open }: {
  selected: HomeDiscovery;
  links: HomeDiscovery[];
  select: (id: string) => void;
  open: () => void;
}) {
  const solo = links.length === 1;
  const center = solo ? 32 : 50;
  const positions = links.map((_, i) => {
    const left = i % 2 === 0;
    const sameSide = left ? Math.ceil(links.length / 2) : Math.floor(links.length / 2);
    return { x: solo ? 72 : left ? 17 : 83, y: (Math.floor(i / 2) + 0.5) * 100 / sameSide };
  });
  return <div className="qhd-map" aria-label="资料关联图" role="group">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {links.map((item, i) => {
        const {x, y} = positions[i];
        const middle = (center + x) / 2;
        return <path key={item.id} className={item.id === selected.id ? 'is-current' : undefined}
          d={`M ${center} 50 C ${middle} 50, ${middle} ${y}, ${x} ${y}`} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
    <button className="qhd-node qhd-node-origin" type="button" onClick={open}
      style={{left:center+'%',top:'50%'}} title={selected.noteTitle}>
      <Icon name="bulb" size={18}/><span><strong>{selected.noteTitle}</strong><small>笔记</small></span>
    </button>
    {links.map((item, i) => <button className="qhd-node qhd-node-source" key={item.id} type="button"
      aria-pressed={selected.id === item.id} onClick={() => select(item.id)}
      style={{left:positions[i].x+'%',top:positions[i].y+'%'}} title={summary(item)}>
      <Icon name={item.sourceKind === '项目' ? 'folder' : 'link'} size={16}/>
      <span><strong>{item.sourceTitle}</strong><small>{item.sourceKind}</small></span>
    </button>)}
  </div>;
}

export function HomeDiscoveries({ discoveries, onOpenNote, expanded = false }: Props) {
  const [selection, setSelection] = useState<string>();
  const selected = discoveries.find(item => item.id === selection) ?? discoveries[0];
  const siblings = useMemo(() => discoveries.filter(item => item.noteId === selected?.noteId), [discoveries, selected?.noteId]);
  if (!selected) return <div className="qhd-empty"><Icon name="link" size={17}/><span>暂时没有需要核对的新关联</span></div>;
  const page = Math.floor(siblings.indexOf(selected) / 4);
  const links = siblings.slice(page * 4, page * 4 + 4);
  const open = () => onOpenNote(selected.noteId, selected.id);
  return <div className="qhd-discoveries">
    <div className="qhd-discovery-view">
      <article className="qhd-summary" aria-live="polite">
        <div className="qhd-summary-copy">
          <Icon name={selected.kind === '冲突' ? 'alert' : 'bulb'} size={19}/>
          <div><h3>{selected.explanation || selected.kind === '冲突' ? selected.title : selected.noteTitle+' × '+selected.sourceTitle}</h3>
            <p>{summary(selected)}</p></div>
        </div>
        <button type="button" className="qhd-open" onClick={open}>查看详情 <Icon name="arrow-right" size={13}/></button>
      </article>
      <ConnectionMap selected={selected} links={links} select={setSelection} open={open}/>
    </div>
    {expanded && discoveries.length > 1 && <ul className="qhd-relation-list" aria-label="全部待核对的资料关联">
      {discoveries.map(item => <li key={item.id}><button type="button" aria-pressed={selected.id === item.id} onClick={() => setSelection(item.id)}>
        <Icon name={item.kind === '冲突' ? 'alert' : 'link'} size={14}/><span>{item.noteTitle}</span>
        <span className="qhd-to">与</span><span>{item.sourceTitle}</span><small>{item.kind === '冲突' ? '待核对' : item.kind === '同源' ? '同一来源' : item.kind}</small>
      </button></li>)}
    </ul>}
  </div>;
}
