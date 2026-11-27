import { useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { resultExcerpt } from '../../data/resultExcerpt';
import { needsHandoff, boardStates, type BoardCard } from './homeBoardData';
import { briefHandoff, type BriefEvidence, type ProjectBrief } from './projectBriefs';

export const evidenceLabels: Record<BriefEvidence['kind'], string> = {
  note: '笔记', source: '原始想法', task: '任务', progress: '进展', decision: '决定', result: '成果',
};

export function briefDate(at?: string) {
  if (!at) return '';
  const date = new Date(at.length === 10 ? at + 'T12:00:00' : at);
  return Number.isFinite(date.getTime()) ? (date.getMonth() + 1) + '月' + date.getDate() + '日' : '';
}

const stages: {label: string; icon: IconName; empty: string}[] = [
  {label: '起点', icon: 'bulb', empty: '尚无原始记录'},
  {label: '推进', icon: 'merge', empty: '尚无进展或决定'},
  {label: '交付', icon: 'box', empty: '尚无成果'},
];

interface Props {
  brief: ProjectBrief;
  onEvidence: (row: BriefEvidence) => void;
  onTask: (card: BoardCard) => void;
  onLibrary: () => void;
}

export function BriefTaskTrail({brief, onEvidence, onTask, onLibrary}: Props) {
  const [chosen, setChosen] = useState('');
  const [all, setAll] = useState(false);
  const focus = brief.focus ?? brief.cards[0];
  const selected = brief.cards.find(card => card.key === chosen) ?? focus;
  if (!selected) return null;
  const cards = focus ? [focus, ...brief.cards.filter(card => card !== focus)] : brief.cards;
  const visible = all ? cards : cards.slice(0, 4);
  const entries = brief.evidence.filter(row => row.cardKey === selected.key);
  const sources = entries.filter(row => row.kind === 'source' || row.kind === 'note');
  const origin = sources.filter(row => row.noteId).at(-1) ?? sources.at(-1) ?? entries.find(row => row.kind === 'task');
  const events = [origin, entries.find(row => row.kind === 'progress' || row.kind === 'decision'), entries.find(row => row.kind === 'result')];

  return <div className="qpb-lower">
    <section className="qpb-assignments" aria-label="任务分工">
      <div className="qpb-subhead"><h4>任务分工</h4><small>{brief.cards.length} 项</small></div>
      <div className="qpb-task-list">{visible.map(card =>
        <button type="button" key={card.key} aria-pressed={selected.key === card.key}
          aria-label={'查看来龙去脉 ' + card.title} onClick={() => setChosen(card.key)}>
          <i className={'qpb-state-mark ' + card.state} aria-hidden="true"/>
          <span><strong>{card.title}</strong><small>{card.ownerName} · {needsHandoff(card) ? briefHandoff(card).label : boardStates[card.state]}</small></span>
          <Icon name="chevron-right" size={12}/>
        </button>)}</div>
      {cards.length > 4 && <button type="button" className="qpb-text-action" onClick={() => setAll(!all)} aria-expanded={all}>{all ? '收起任务' : '另有 ' + (cards.length - 4) + ' 项任务'}<Icon name="chevron-down" size={13}/></button>}
    </section>
    <section className="qpb-story" aria-label="任务来龙去脉">
      <div className="qpb-subhead"><h4>这件事的来龙去脉</h4><button type="button" onClick={onLibrary}>全部资料<Icon name="chevron-right" size={12}/></button></div>
      <button type="button" className="qpb-story-title" onClick={() => onTask(selected)}>{selected.title}<Icon name="external" size={12}/></button>
      <ol className="qpb-thread">{stages.map((stage, index) => {
        const event = events[index];
        return <li key={stage.label} className={event ? 'has-entry' : 'no-entry'}>
          <div className="qpb-step"><Icon name={stage.icon} size={13}/><span>{stage.label}</span></div>
          {event ? <button type="button" onClick={() => onEvidence(event)} title={event.text}>
            <span>{index === 2 ? event.title : resultExcerpt(event.text, 76) || event.title}</span>
            <small>{briefDate(event.at)}{event.ai ? ' · AI 交回' : ''}<Icon name="arrow-right" size={11}/></small>
          </button> : <small>{stage.empty}</small>}
        </li>;
      })}</ol>
    </section>
  </div>;
}
