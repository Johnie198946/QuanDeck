import { useMemo, type ReactNode } from 'react';
import { recommendKnowledge } from '../../data/knowledgeIndex';
import { Icon } from '../ui/Icon';
import type { BriefEvidence, ProjectBrief } from './projectBriefs';
import './related-drafts.css';

interface Props {
  brief: ProjectBrief;
  allEvidence: BriefEvidence[];
  onOpen: (source: BriefEvidence) => void;
  filingButton: (source: BriefEvidence) => ReactNode;
}

export function RelatedDrafts({ brief, allEvidence, onOpen, filingButton }: Props) {
  const suggestions = useMemo(() => {
    // Compare the actual paragraph with confirmed project material. A notebook title
    // can cover many unrelated subjects and must not pull all its lines into the project.
    const drafts = allEvidence.filter(row => row.kind === 'note' && !row.projectId &&
      !!row.noteId && row.lineIndex !== undefined && row.text.trim());
    const byId = new Map(drafts.map(row => [row.id, row]));
    const candidates = drafts.map(row => ({ id: row.id, kind: 'note' as const, title: '', text: row.text }));
    const projectText = [brief.name, brief.goal, ...brief.cards.slice(0, 24).map(card => card.title),
      ...brief.evidence.filter(row => row.kind === 'source' || row.kind === 'decision' || row.kind === 'result')
        .slice(0, 12).map(row => row.text.slice(0, 240))].filter(Boolean).join('\n');
    return recommendKnowledge(candidates, projectText).slice(0, 3).map(match => {
      const terms = match.matchedTerms.filter(term => !match.matchedTerms.some(other => other !== term && other.includes(term)));
      return { row: byId.get(match.id)!, terms: terms.slice(0, 3) };
    });
  }, [brief, allEvidence]);
  if (!suggestions.length) return null;
  return <aside className="qpb-related" aria-label="可能有关的草稿">
    <h4><Icon name="link" size={14}/>可能有关的草稿</h4>
    <ul>{suggestions.map(({row, terms}) => <li key={row.id}>
      <button type="button" className="qpb-related-quote" onClick={() => onOpen(row)}>
        <strong>{row.text}</strong><small>《{row.title}》 · 同时提到{terms.map(term => '「' + term + '」').join('、')}</small>
      </button>{filingButton(row)}
    </li>)}</ul>
  </aside>;
}
