import { useState } from 'react';
import { noteChanges, type KnowledgeNote, type KnowledgeDecision } from '../../data/knowledgeNotes';
import type { KnowledgeRelation } from '../../data/knowledgeIndex';
import { Icon } from '../ui/Icon';
import { readableNote, relationLabel } from './IdeaEvidence';

export function IdeaDetail({ note, relations, activeKey, decisions, onOpenNote, onRelation, relatedNotes, onSelectNote, hideEvidence }: {
  note: KnowledgeNote; relations: KnowledgeRelation[]; activeKey?: string;
  decisions: ReadonlyMap<string, KnowledgeDecision['result']>;
  onOpenNote: (id: string) => void; onRelation: (key: string) => void;
  hideEvidence?: boolean;
  relatedNotes?: { id: string; title: string }[];
  onSelectNote?: (id: string) => void;
}) {
  const [tab, setTab] = useState<'details' | 'related' | 'history'>('details');
  const activeTab = tab === 'related' && !relatedNotes ? 'details' : tab;
  const body = readableNote(note.body);
  const changes = activeTab === 'history' ? noteChanges(note).slice().reverse() : [];
  function relatedTitles(relation: KnowledgeRelation) {
    const evidence = relation.agent?.sourceEvidence;
    if (!evidence) return relation.source.title;
    const others = new Map(evidence.filter(e => e.noteId !== note.id).map(e => [e.noteId, e.title]));
    return [...others.values()].join('、') || '本篇内的记录';
  }
  function relatedNoteList(items: NonNullable<typeof relatedNotes>) {
    return <ul aria-label="关联笔记列表">{items.map(item => <li key={item.id}>
      <button type="button" disabled={!onSelectNote} onClick={() => onSelectNote?.(item.id)}>
        <strong>{item.title}</strong><Icon name="chevron-right" size={14}/>
      </button>
    </li>)}</ul>;
  }
  return <section className="qd-idea-detail qd-idea-panel" aria-label="灵感详情">
    <header className="qd-idea-detail-head"><span className="qd-idea-kicker"><Icon name="bulb" size={15}/>来自帮你记</span>
      <h2>{note.title}</h2>
      <div><time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleDateString('zh-CN')} 更新</time>
        <button type="button" className="qd-link" onClick={() => onOpenNote(note.id)}>打开笔记 <Icon name="external" size={13}/></button></div>
    </header>
    <div className="qd-idea-detail-tabs" role="group" aria-label="笔记详情视图">
      <button type="button" aria-pressed={activeTab === 'details'} onClick={() => setTab('details')}>内容概览</button>
      {relatedNotes && <button type="button" aria-pressed={activeTab === 'related'} onClick={() => setTab('related')}>关联笔记 {relatedNotes.length}</button>}
      <button type="button" aria-pressed={activeTab === 'history'} onClick={() => setTab('history')}>思考演进</button>
    </div>
    {activeTab === 'details' ? <>
      <section className="qd-idea-note-body"><h3><Icon name="pencil" size={17}/>灵感原文</h3>
        <p>{body || (note.attachments.length ? '这篇笔记的内容在附件里。' : '尚未写下正文。')}</p>
        {note.expansions.length > 0 && <details><summary>{note.expansions.length} 条选段问答</summary>
          {note.expansions.map(item => <div key={item.id}><strong>{item.question}</strong><p>{item.answer}</p></div>)}</details>}
      </section>
      {relatedNotes && <section className="qd-idea-related"><h3><Icon name="link" size={17}/>关联笔记 <small>{relatedNotes.length}</small></h3>
        {relatedNotes.length ? <>{relatedNoteList(relatedNotes.slice(0, 3))}
          {relatedNotes.length > 3 && <button type="button" className="qd-link" onClick={() => setTab('related')}>查看全部关联笔记 <Icon name="chevron-right" size={14}/></button>}
        </> : <p>暂无关联笔记。</p>}
      </section>}
      {!hideEvidence && <section className="qd-idea-related"><h3><Icon name="link" size={17}/>关联内容 <small>{relations.length}</small></h3>
        {relations.length ? <ul aria-label="来自其他资料的关联">{relations.map(relation => <li key={relation.evidenceKey}>
          <button type="button" aria-pressed={activeKey === relation.evidenceKey} onClick={() => onRelation(relation.evidenceKey)}>
            <span>{relationLabel(relation)}{decisions.get(relation.evidenceKey) === 'dismissed' && ' · 已忽略'}</span>
            <strong>{relatedTitles(relation)}</strong><Icon name="chevron-right" size={14}/>
          </button></li>)}</ul> : <p>还没有找到关联。</p>}
      </section>}
    </> : activeTab === 'related' ? <section className="qd-idea-related"><h3><Icon name="link" size={17}/>关联笔记 <small>{relatedNotes?.length ?? 0}</small></h3>
      {relatedNotes?.length ? relatedNoteList(relatedNotes) : <p>暂无关联笔记。</p>}
    </section> : <section className="qd-idea-history"><h3><Icon name="clock" size={17}/>改动记录</h3>
      {changes.length ? <ol>{changes.map((change, i) => <li key={i}>
        <time>{new Date(change.at).toLocaleString('zh-CN')}</time><strong>{change.field}</strong>
        {change.before && <del>{change.before}</del>}{change.after && <ins>{change.after}</ins>}
      </li>)}</ol> : <p>尚无改动记录。</p>}
    </section>}
  </section>;
}
