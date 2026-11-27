import { boardStates, homeBoardCards, type BoardCard } from '../components/homepage/homeBoardData';
import { decisionEvidence } from '../components/homepage/projectBriefs';
import { taskKey } from './collaboration';
import { hashText } from './contentHash';
import type { KnowledgeNote } from './knowledgeNotes';
import { legacyNoteSources } from './noteTaskSource';
import { resultExcerpt } from './resultExcerpt';
import type { Snapshot } from './types';

export interface TaskBriefFact { id: string; label: string; text: string; at?: string }
export interface TaskBriefResult {
  provider: string;
  points: { section: 'origin' | 'current' | 'next'; text: string; source: string; quote: string }[];
}

function localDate(value: string) {
  if (!value.includes('T') || !Number.isFinite(Date.parse(value))) return value;
  return new Date(value).toLocaleString('sv-SE', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}

// Both sides build this from the selected card. No other note body or project is sent to the Agent.
export function taskBriefInput(card: BoardCard, notes: KnowledgeNote[], snapshot?: Snapshot) {
  const rows: TaskBriefFact[] = [];
  const add = (label: string, value?: string, at?: string) => {
    const text = value?.trim().slice(0, 750);
    if (!text || rows.some(row => row.label === label && row.text === text && row.at === at)) return;
    rows.push({id:'s' + (rows.length + 1), label, text, ...(at && { at: localDate(at) })});
  };
  add('任务', card.title);
  add('状态', [boardStates[card.state], card.ownerName, card.reason, card.due && '截止 ' + localDate(card.due)].filter(Boolean).join(' · '));
  // Keep the beginning even when there are many later additions.
  for (const row of [card.sources[0], ...card.sources.slice(-3)]) {
    if (row) add('来源 · ' + row.title, row.text, row.at);
  }
  if (card.taskId && snapshot?.collaboration) {
    const ledger = snapshot.collaboration;
    const key = taskKey(card.taskId), revision = ledger.tasks[key]?.specRevision;
    const spec = ledger.specs.find(row => row.key === key && row.revision === revision);
    if (spec) {
      add('任务目标', spec.goal, spec.at);
      add('验收要求', spec.criteria.join('；'), spec.at);
    }
    const decisions = decisionEvidence(snapshot, [card]).filter(row => row.taskId === card.taskId);
    for (const row of decisions.sort((a,b) => b.at.localeCompare(a.at)).slice(0,3)) add(row.title, row.text, row.at);
  }
  for (const entry of (card.schedule ?? []).slice(0,4)) {
    if ('noteId' in entry) {
      const todos = notes.find(note => note.id === entry.noteId)?.todos ?? [];
      const todo = todos.find(item => item.id === entry.todoId);
      const linked = todo?.follows && todos.find(item => item.id === todo.follows!.parentId);
      if (linked && todo?.follows) {
        add('原待办', linked.text);
        const origin = (todo.follows.legacy ? linked.followup?.progress : linked.progress)?.find(row => row.id === todo.follows!.progressId);
        if (origin) add('跟进缘由', origin.text, origin.at);
      }
      for (const child of todos.filter(item => item.follows?.parentId === entry.todoId).slice(-2)) {
        add(child.completedAt ? '已完成的跟进' : '待跟进', child.text, child.dueAt);
      }
      if (todo?.outcome && !entry.followup) {
        add('收到的材料', [todo.outcome.url, ...todo.outcome.files?.map(file => file.name) ?? []].filter(Boolean).join(' · '), todo.outcome.at);
      }
    } else if (snapshot) {
      const plan = snapshot.plans.find(row => row.id === entry.planId);
      if (plan?.follows) {
        const parent = snapshot.plans.find(row => row.id === plan.follows!.parentId);
        add('原日程', parent?.title);
        const origin = parent?.progress?.find(row => row.id === plan.follows!.progressId);
        if (origin) add('跟进缘由', origin.text, origin.at);
      }
      if (plan?.outcomeText) add('日程成果', plan.outcomeText, plan.completedAt);
    }
  }
  for (const row of card.progress.slice(-5)) add('进展', row.text, row.at);
  for (const row of card.results.slice(0,3)) add('成果 · ' + row.status, row.title + ' ' + resultExcerpt(row.text,480), row.at);
  if (card.noteResult) add('记录结果', card.noteResult.text, card.noteResult.at);
  for (const step of card.steps.slice(0,5)) add('子任务 · ' + step.state, step.title);
  return {rows, revision:hashText(JSON.stringify([1,card.key,rows]))};
}

export function savedTaskBriefInput(key: string, snapshot: Snapshot | undefined, notes: KnowledgeNote[]) {
  const projects = snapshot ? [snapshot] : [];
  const card = homeBoardCards(projects, notes, legacyNoteSources(projects,notes), Date.now()).find(row => row.key === key);
  return card && taskBriefInput(card, notes, snapshot);
}
