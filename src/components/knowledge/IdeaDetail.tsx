import { useState } from 'react';
import { noteChanges, type KnowledgeNote, type KnowledgeDecision } from '../../data/knowledgeNotes';
import type { KnowledgeRelation } from '../../data/knowledgeIndex';
import { Icon } from '../ui/Icon';
import { readableNote, relationLabel } from './IdeaEvidence';

export function IdeaDetail({ note, relations, activeKey, decisions, onOpenNote, onRelation }: {
  note: KnowledgeNote; relations: KnowledgeRelation[]; activeKey?: string;
  decisions: ReadonlyMap<string, KnowledgeDecision['result']>;
  onOpenNote: (id: string) => void; onRelation: (key: string) => void;
}) {
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const body = readableNote(note.body);
  const changes = tab === 'history' ? noteChanges(note).slice().reverse() : [];
  function relatedTitles(relation: KnowledgeRelation) {
    const evidence = relation.agent?.sourceEvidence;
    if (!evidence) return relation.source.title;
    const others = new Map(evidence.filter(e => e.noteId !== note.id).map(e => [e.noteId, e.title]));
    return [...others.values()].join('、') || '本篇内的记录';
  }
  return <section className="qd-idea-detail qd-idea-panel" aria-label="灵感详情">
    <header className="qd-idea-detail-head"><span className="qd-idea-kicker"><Icon name="bulb" size={15}/>来自帮你记</span>
      <h2>{note.title}</h2>
      <div><time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleDateString('zh-CN')} 更新</time>
        <button type="button" className="qd-link" onClick={() => onOpenNote(note.id)}>打开笔记 <Icon name="external" size={13}/></button></div>
    </header>
    <div className="qd-idea-detail-tabs" role="group" aria-label="笔记详情视图">
      <button type="button" aria-pressed={tab === 'details'} onClick={() => setTab('details')}>灵感详情</button>
      <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>思考演进</button>
    </div>
    {tab === 'details' ? <>
      <section className="qd-idea-note-body"><h3><Icon name="pencil" size={17}/>灵感原文</h3>
        <p>{body || (note.attachments.length ? '这篇笔记的内容在附件里。' : '尚未写下正文。')}</p>
        {note.expansions.length > 0 && <details><summary>{note.expansions.length} 条选段问答</summary>
          {note.expansions.map(item => <div key={item.id}><strong>{item.question}</strong><p>{item.answer}</p></div>)}</details>}
      </section>
      <section className="qd-idea-related"><h3><Icon name="link" size={17}/>关联内容 <small>{relations.length}</small></h3>
        {relations.length ? <ul aria-label="来自其他资料的关联">{relations.map(relation => <li key={relation.evidenceKey}>
          <button type="button" aria-pressed={activeKey === relation.evidenceKey} onClick={() => onRelation(relation.evidenceKey)}>
            <span>{relationLabel(relation)}{decisions.get(relation.evidenceKey) === 'dismissed' && ' · 已忽略'}</span>
            <strong>{relatedTitles(relation)}</strong><Icon name="chevron-right" size={14}/>
          </button></li>)}</ul> : <p>还没有找到关联。</p>}
      </section>
    </> : <section className="qd-idea-history"><h3><Icon name="clock" size={17}/>改动记录</h3>
      {changes.length ? <ol>{changes.map((change, i) => <li key={i}>
        <time>{new Date(change.at).toLocaleString('zh-CN')}</time><strong>{change.field}</strong>
        {change.before && <del>{change.before}</del>}{change.after && <ins>{change.after}</ins>}
      </li>)}</ol> : <p>尚无改动记录。</p>}
    </section>}
  </section>;
}
