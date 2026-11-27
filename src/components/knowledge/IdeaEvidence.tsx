import { useEffect, useState } from 'react';
import { desktopHost } from '../../integration/desktop';
import type { AtomAnchor, KnowledgeDecision, KnowledgeNote } from '../../data/knowledgeNotes';
import { knowledgeKindLabels, type KnowledgeRelation, type KnowledgeSource } from '../../data/knowledgeIndex';
import { Icon } from '../ui/Icon';

function FileQuotation({anchor,location}: {anchor:AtomAnchor;location:string}) {
  const [quote,setQuote]=useState('');
  useEffect(()=>{
    let active=true;
    setQuote('');
    void desktopHost()?.readKnowledgeFileQuote?.(anchor).then(value=>{ if(active)setQuote(value); })
      .catch(()=>{ if(active)setQuote('暂时无法核对附件原文。'); });
    return ()=>{active=false;};
  },[anchor.noteId,anchor.revision,anchor.source,anchor.start,anchor.end,anchor.digest]);
  return <>{location}{quote && <><br/>{quote}</>}</>;
}
export function readableNote(text: string) {
  return text.replace(/!\[[^\]\n]*\]\([^)]*\)/g, '').replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:\*\*|~~|__)/g, '').replace(/^#{1,6}\s+/gm, '').trim();
}

export function relationLabel(relation: KnowledgeRelation) {
  return relation.agent?.label ?? ({ 关联: '共同主题', 冲突: '可能冲突', 同源: '同一来源', 补充: '补充资料' }[relation.kind]);
}

function inspectRule(relation: KnowledgeRelation) {
  const values = relation.evidence.filter(line => !line.startsWith('共同提到'));
  const terms = relation.evidence.flatMap(line => line.startsWith('共同提到') ? [...line.matchAll(/「([^」]+)」/g)].map(match => match[1]) : []);
  switch (relation.kind) {
    case '冲突': return { terms: values.slice(0, 2), why: '两份资料对同一项写了不同数值，可能采用了不同的范围或时间。' };
    case '同源': return { terms: values, why: '两份资料引用了同一链接，可以回到同一来源核对。' };
    case '补充': return { terms, why: '这份项目资料也提到了' + terms.slice(0, 2).map(term => '「' + term + '」').join('、') + '，可以与笔记一起看。' };
    default: return { terms, why: '两篇笔记共同提到' + terms.slice(0, 3).map(term => '「' + term + '」').join('、') + '，可能在讨论同一主题。' };
  }
}

function evidenceLine(source: KnowledgeSource, terms: string[]) {
  const rows = [source.title, ...source.text.split('\n')];
  const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase();
  for (const term of terms) {
    const value = fold(term);
    const row = rows.find(line => fold(line).includes(value));
    if (row) {
      const start = Math.max(0, fold(row).indexOf(value) - 40);
      return (start > 0 ? '…' : '') + row.slice(start, start + Math.max(110, term.length)) + (start + Math.max(110, term.length) < row.length ? '…' : '');
    }
  }
  return '';
}

export function IdeaEvidence({ note, noteSource, relation, decision, saving, onDecide, onOpen }: {
  note: KnowledgeNote; noteSource: KnowledgeSource; relation: KnowledgeRelation; decision?: KnowledgeDecision['result']; saving: boolean;
  onDecide: (result: KnowledgeDecision['result']) => void; onOpen: (source: KnowledgeSource) => void;
}) {
  const agent = relation.agent;
  const reversed = agent && agent.from !== note.id;
  const first = reversed ? relation.source : noteSource;
  const second = reversed ? noteSource : relation.source;
  const local = inspectRule(relation);
  const label = relationLabel(relation);
  const members = agent?.sourceEvidence && [...new Map(agent.sourceEvidence.map(e => [e.noteId, e.title])).values()];
  const self = members?.length === 1;
  const combined = !!members && members.length > 2;
  return <article className="qd-idea-evidence" aria-label="关联依据" data-origin={agent ? 'agent' : 'local'}>
    <header><h3>{self ? '这篇笔记里的哪些内容相关' : combined ? '这些资料为什么相连' : !agent && relation.kind === '冲突' ? relation.title : '这两份资料为什么相连'}</h3>
      <small>{agent ? agent.provider + ' 解读' : '本机匹配'}</small></header>
    <div className="qd-idea-triple" aria-label="对象与关系">
      {self || combined ? <><b>{members!.join('、')}</b><span>{label}</span></>
        : <><b>{first.title}</b><span>{agent ? '→' : '↔'} {label} {agent ? '→' : '↔'}</span><b>{second.title}</b></>}
    </div>
    <p>{agent?.explanation ?? local.why}</p>
    {agent?.check && <p>{agent.consequence} 可验证的下一步：{agent.check} 适用边界：{agent.limitation}</p>}
    <div className="qd-idea-extracts">{(agent?.sourceEvidence?.map(e=>({id:'note:'+e.noteId,noteId:e.noteId,kind:'note' as const,title:e.title,text:e.quote})) ?? [first, second]).map((source, i) => {
      const quote = agent?.sourceEvidence?.[i]?.quote ?? (agent ? (i ? agent.toQuote : agent.fromQuote) : evidenceLine(source, local.terms));
      return <div key={source.id+':'+i}><button type="button" className="qd-link" onClick={() => onOpen(source)} aria-label={'打开来源：' + source.title}>
        <Icon name={source.noteId ? 'pencil' : 'folder'} size={13}/>{source.title}<Icon name="external" size={12}/></button>
        {quote && <blockquote>{agent?.sourceEvidence?.[i]?.origin && <small>{agent.sourceEvidence[i].origin} · </small>}{agent?.anchors?.[i]?.source.startsWith('attachment:') ? <FileQuotation anchor={agent.anchors[i]} location={quote}/> : quote}</blockquote>}
        {!quote && <small>{knowledgeKindLabels[source.kind]} · 可打开来源核对</small>}
      </div>;
    })}</div>
    {agent && !agent.anchors && relation.kind === '冲突' && <p><strong>本机还发现一处数值差异。</strong> {relation.evidence.slice(2, 4).join(' ／ ')}</p>}
    <footer>{(relation.kind === '冲突' || agent?.evidenceKey) && !decision && <button type="button" className="qd-link" disabled={saving} onClick={() => onDecide('accepted')}>{relation.kind === '冲突' ? '确认有冲突' : '保留这条推断'}</button>}
      {decision === 'accepted' && <small>已保留</small>}
      <button type="button" className="qd-link" disabled={saving} onClick={() => onDecide(decision === 'dismissed' ? 'accepted' : 'dismissed')}>{decision === 'dismissed' ? '重新保留' : '忽略'}</button>
    </footer>
  </article>;
}
