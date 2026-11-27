import { useState } from 'react';
import { resultExcerpt } from '../../data/resultExcerpt';
import { Icon } from '../ui/Icon';
import { briefDate, evidenceLabels } from './BriefTaskTrail';
import type { BriefEvidence, ProjectBrief } from './projectBriefs';

interface Props {
  records: BriefEvidence[];
  briefs: ProjectBrief[];
  active?: ProjectBrief;
  query: string;
  scope: string;
  setScope: (scope: string) => void;
  onOpen: (row: BriefEvidence) => void;
  onClose: () => void;
  manageSource?: (row: BriefEvidence) => React.ReactNode;
}

function evidenceExcerpt(text: string, query: string) {
  if (!text) return '';
  const words = query.trim().split(/\s+/).filter(Boolean);
  const first = words.map(word => text.toLowerCase().indexOf(word.toLowerCase())).filter(index => index >= 0).sort((a,b) => a-b)[0] ?? 0;
  const start = Math.max(0, first - 22);
  return (start ? '…' : '') + resultExcerpt(text.slice(start), 120);
}

export function BriefLibrary({records, briefs, active, query, scope, setScope, onOpen, onClose, manageSource}: Props) {
  const [limit,setLimit] = useState(12);
  return <section className="qpb-library" aria-label="资料检索结果">
    <header><div><h3>{query.trim() ? '找到的相关记录' : '项目资料'}</h3><span>{records.length} 条</span></div>
      <button className="qpb-close" type="button" aria-label="返回项目简报" onClick={onClose}><Icon name="close" size={17}/></button></header>
    <div className="qpb-search-scope" role="group" aria-label="资料范围">
      <button type="button" aria-pressed={scope === ''} onClick={() => setScope('')}>全部资料</button>
      {active && <button type="button" aria-pressed={scope === active.id} onClick={() => setScope(active.id)}>{active.name}</button>}
    </div>
    {records.length ? <ul className="qpb-matches">{records.slice(0,limit).map(row => {
      const context = briefs.find(item => item.id === row.projectId)?.name ?? (row.cardKey ? '个人待办' : '帮你记');
      return <li key={row.id}><button className="qpb-match" type="button" onClick={() => onOpen(row)}>
        <span className="qpb-type">{evidenceLabels[row.kind]}</span>
        <span className="qpb-match-copy"><strong>{row.title}</strong>{row.text && row.text !== row.title && <span>{evidenceExcerpt(row.text,query)}</span>}
        <small>{context} · {briefDate(row.at)}</small></span>
        <Icon name="arrow-right" size={14}/></button>{manageSource?.(row)}</li>;
    })}</ul> : <p className="qpb-empty">{query.trim() ? '没有找到相关记录。可以换一个原话中的词。' : '这个项目还没有资料。'}</p>}
    {records.length > limit && <button type="button" className="qpb-text-action" onClick={() => setLimit(limit + 12)}>再看 {Math.min(12,records.length-limit)} 条<Icon name="chevron-down" size={12}/></button>}
  </section>;
}
