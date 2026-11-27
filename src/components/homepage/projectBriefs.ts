import { isGeneratedDiscussionSummaryDecision } from '../../data/discussionAuthority';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { searchKnowledge } from '../../data/knowledgeIndex';
import { todoLineText } from '../../data/noteTodos';
import { resultExcerpt } from '../../data/resultExcerpt';
import { dayBounds } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import { boardStates, type BoardCard } from './homeBoardData';

export const PERSONAL_BRIEF_ID = '@personal-todos';
export interface BriefEvidence {
  id: string;
  kind: 'note' | 'source' | 'task' | 'progress' | 'result' | 'decision';
  title: string;
  text: string;
  /** Searchable original Markdown, including a link URL when its visible label differs. */
  searchText?: string;
  at: string;
  projectId?: string;
  projectName?: string;
  cardKey?: string;
  noteId?: string;
  todoId?: string;
  lineIndex?: number;
  taskId?: string;
  itemId?: string;
  resultId?: string;
  decisionId?: string;
  filingId?: string;
  ai?: boolean;
}
export interface ProjectBrief {
  id: string;
  name: string;
  goal?: string;
  cards: BoardCard[];
  focus?: BoardCard;
  focusTarget?: BriefEvidence;
  nextAction: string;
  actionLabel: string;
  why: string;
  summary: string;
  evidence: BriefEvidence[];
  waitingOnMe: number;
  counts: Record<BoardCard['state'], number>;
}

interface BriefHandoff { kind: 'me' | 'agent' | 'other' | 'done'; label: string; needsMe: boolean }

/** A warning about an executor is not itself a request for the user to take over. */
export function briefHandoff(card: BoardCard): BriefHandoff {
  if (card.state === 'done') return { kind: 'done', label: '已完成', needsMe: false };
  const attention = card.attention;
  const assignedAI = card.owners.includes('agent'), mine = card.owners.includes('me');
  if (attention) {
    const requests = { permission: '等我授权', question: '等我回复', review: '等我验收', decision: '等我确认' };
    if (attention.kind in requests) return { kind: 'me', label: requests[attention.kind as keyof typeof requests], needsMe: true };
    if (card.attentionOwner === 'agent' || !card.attentionOwner && assignedAI && !mine) {
      const label = attention.kind === 'stalled' ? 'AI 进展待核对' : attention.kind === 'overdue' ? 'AI 任务已逾期'
        : attention.label === '待修改' ? '等 AI 修改' : 'AI 执行受阻';
      return { kind: 'agent', label, needsMe: false };
    }
  }
  if (card.state === 'attention' && card.reason && ['待验收', '待确认', '待授权', '待回复', '需复核'].includes(card.reason))
    return { kind: 'me', label: card.reason, needsMe: true };
  if (mine) return { kind: 'me', label: card.state === 'attention' ? '我需跟进' : '我来做', needsMe: false };
  if (assignedAI) return { kind: 'agent', label: 'AI 在办', needsMe: false };
  return { kind: 'other', label: '待分派', needsMe: false };
}

const key = (...parts: (string | number)[]) => JSON.stringify(parts);
const timestamp = (at: string) => Date.parse(at) || 0;
const latestFirst = (a: BriefEvidence, b: BriefEvidence) => timestamp(b.at) - timestamp(a.at) || a.id.localeCompare(b.id);

function taskEvidence(card: BoardCard): BriefEvidence {
  return { id: key('task', card.key), kind: 'task', title: card.title,
    text: [card.ownerName, boardStates[card.state], card.reason].filter(Boolean).join(' · '), at: card.at,
    projectId: card.projectId, projectName: card.project, cardKey: card.key, taskId: card.taskId, noteId: card.noteId, todoId: card.todoId };
}

function cardEvidence(card: BoardCard): BriefEvidence[] {
  const task = taskEvidence(card);
  const evidence: BriefEvidence[] = [task];
  for (const [i, source] of card.sources.entries()) evidence.push({ ...task, id: key('source', card.key, source.id ?? i),
    kind: 'source', title: source.title, text: source.text, at: source.at, noteId: source.noteId, todoId: source.todoId, lineIndex: source.lineIndex });
  for (const entry of card.progress) evidence.push({ ...task, id: key('progress', card.key, entry.id),
    kind: 'progress', text: entry.text, at: entry.at });
  for (const result of card.results) evidence.push({ ...task, id: key('result', card.key, result.id), kind: 'result',
    title: result.title, text: result.text, at: result.at, ai: result.ai, itemId: result.itemId, resultId: result.id });
  // Subtask names and exact IDs are searchable even before a result has been submitted.
  for (const step of card.steps) evidence.push({ ...task, id: key('step', card.key, step.id), kind: 'task', title: step.title,
    text: [card.title, step.owner, step.state].filter(Boolean).join(' · '), itemId: step.id, at: '' });
  return evidence;
}

function decisionEvidence(snapshot: Snapshot, cards: BoardCard[]): BriefEvidence[] {
  const c = snapshot.collaboration;
  if (!c) return [];
  const projectId = snapshot.project.id, projectName = snapshot.project.name;
  const taskCards = new Map(cards.map(card => [card.taskId, card.key]));
  const scope = (taskKey?: string) => {
    const task = taskKey && c.tasks[taskKey];
    return task ? { taskId: task.taskId, itemId: task.workItemId, cardKey: taskCards.get(task.taskId) } : {};
  };
  const evidence: BriefEvidence[] = [];
  // A withdrawn or superseded instruction cannot become a current project decision again.
  const current = new Map(c.decisions.map(row => [row.decisionId, row]));
  for (const decision of current.values()) {
    if (decision.authority !== 'confirmed' || isGeneratedDiscussionSummaryDecision(snapshot, decision)) continue;
    evidence.push({ id: key('decision', projectId, decision.id), kind: 'decision', title: '已确认的决定', text: decision.text,
      at: decision.at, decisionId: decision.id, projectId, projectName, ...scope(decision.taskKey) });
  }
  for (const review of c.reviews) {
    const task = c.tasks[review.key];
    evidence.push({ id: key('review', projectId, review.id), kind: 'decision', title: review.verdict === 'accepted' ? '已通过验收' : '已退回修改',
      text: [task?.title, review.note].filter(Boolean).join(' · '), at: review.at, projectId, projectName, ...scope(review.key) });
  }
  return evidence;
}

/** Match a current paragraph only by its complete quoted text. Duplicate text at an unknown location is ambiguous. */
function noteEvidence(notes: KnowledgeNote[], projectNames: Map<string, string>, entries: BriefEvidence[]) {
  const byNote = new Map<string, BriefEvidence[]>();
  for (const entry of entries) if (entry.kind === 'source' && entry.noteId) {
    const linked = byNote.get(entry.noteId) ?? [];
    linked.push(entry);
    byNote.set(entry.noteId, linked);
  }
  const all: BriefEvidence[] = [];
  for (const note of notes) {
    const title = note.title || '未命名笔记';
    const markdown = note.body.split('\n');
    const lines = markdown.map(todoLineText);
    const uniqueLine = new Map<string, number>();
    lines.forEach((line, i) => uniqueLine.set(line, uniqueLine.has(line) ? -1 : i));
    const resolve = (quote: string, hint?: number, original?: string) => {
      if (original !== undefined) {
        if (hint !== undefined && markdown[hint] === original) return hint;
        const index = markdown.indexOf(original);
        return index >= 0 && markdown.indexOf(original, index + 1) < 0 ? index : undefined;
      }
      if (hint !== undefined && lines[hint] === quote) return hint;
      const index = uniqueLine.get(quote);
      return index !== undefined && index >= 0 ? index : undefined;
    };
    const represented = new Set<number>();
    for (const entry of byNote.get(note.id) ?? []) {
      entry.lineIndex = resolve(entry.text, entry.lineIndex);
      if (entry.lineIndex !== undefined) {
        represented.add(entry.lineIndex);
        entry.searchText = markdown[entry.lineIndex];
      }
    }
    for (const filing of note.projectQuotes ?? []) {
      const projectName = projectNames.get(filing.projectId);
      if (projectName === undefined) continue;
      const lineIndex = resolve(filing.text, filing.lineIndex, filing.markdown);
      if (lineIndex !== undefined) represented.add(lineIndex);
      all.push({ id: key('filed', note.id, filing.id), kind: 'note', noteId: note.id, title, text: filing.text, at: filing.at,
        projectId: filing.projectId, projectName, lineIndex, filingId: filing.id, searchText: filing.markdown });
    }
    lines.forEach((text, lineIndex) => {
      if (!text || represented.has(lineIndex)) return;
      all.push({ id: key('note', note.id, note.revision, lineIndex), kind: 'note', noteId: note.id, title, text,
        searchText: markdown[lineIndex] === text ? undefined : markdown[lineIndex], at: note.updatedAt, lineIndex });
    });
    if (!lines.some(Boolean)) all.push({ id: key('note', note.id), kind: 'note', noteId: note.id, title, text: '', at: note.updatedAt });
    for (const answer of note.expansions) all.push({ id: key('answer', note.id, answer.id), kind: 'result', noteId: note.id,
      ai: true, title: answer.question, text: answer.answer, at: answer.at });
    for (const file of note.attachments) all.push({ id: key('attachment', note.id, file.id), kind: 'note', noteId: note.id,
      title, text: file.name, at: note.updatedAt });
  }
  return all;
}

function dueTime(card: BoardCard, zone: string) {
  if (!card.due) return Infinity;
  if (/^\d{4}-\d{2}-\d{2}$/.test(card.due)) {
    // A date without a clock remains due throughout its local calendar day.
    return dayBounds(card.due, zone)[1] - 1;
  }
  return Date.parse(card.due) || Infinity;
}

function focusRank(card: BoardCard, due: number, now: number) {
  if (card.state === 'done') return 7;
  const handoff = briefHandoff(card);
  if (handoff.needsMe) return 0;
  if (handoff.kind === 'me') {
    if (due < now) return 1;
    return card.state === 'pending' ? 3 : 2;
  }
  return card.state === 'pending' ? 5 : 4;
}

function orderedCards(cards: BoardCard[], now: number, zone: string) {
  const ranking = cards.map(card => {
    const due = dueTime(card, zone);
    return { card, due, rank: focusRank(card, due, now) };
  });
  ranking.sort((a, b) => a.rank - b.rank || (a.rank === 7 ? 0 : a.due - b.due) ||
    timestamp(b.card.at) - timestamp(a.card.at) || a.card.key.localeCompare(b.card.key));
  return ranking.map(item => item.card);
}

function nextMove(focus: BoardCard | undefined, now: number, zone: string) {
  if (!focus) return { nextAction: '还没有待推进的任务', why: '', actionLabel: '打开项目' };
  const { title, attention } = focus;
  const handoff = briefHandoff(focus);
  if (attention && handoff.kind === 'agent') {
    return { nextAction: handoff.label + ' · ' + (attention.title || title), why: attention.detail, actionLabel: '看进展' };
  }
  if (attention) {
    const names = { permission: '处理授权', question: '回复', review: '核对成果', decision: '确认方案', blocked: '查看卡点', overdue: '跟进逾期任务', stalled: '核对进度' };
    return { nextAction: names[attention.kind] + ' · ' + attention.title, why: attention.detail, actionLabel: attention.action };
  }
  if (focus.state === 'done') return { nextAction: '已完成「' + title + '」', why: '目前没有待推进的任务。', actionLabel: '回看任务' };
  if (focus.state === 'attention') return { nextAction: '处理「' + title + '」', why: focus.reason ?? '这项任务需要处理。', actionLabel: '查看任务' };
  if (focus.owners.includes('me') && dueTime(focus, zone) < now)
    return { nextAction: '跟进「' + title + '」', why: '已过截止时间，仍待完成。', actionLabel: '查看任务' };
  if (focus.state === 'running' && !focus.owners.includes('me') && focus.owners.includes('agent'))
    return { nextAction: focus.ownerName + ' 正在做「' + title + '」', why: '等执行者交回结果。', actionLabel: '查看进展' };
  if (focus.state === 'running') return { nextAction: '继续「' + title + '」', why: focus.ownerName + '正在推进。', actionLabel: '查看进展' };
  if (focus.owners.includes('unassigned')) return { nextAction: '安排「' + title + '」', why: '还没有负责人。', actionLabel: '查看任务' };
  return { nextAction: '待开始「' + title + '」', why: '负责人 · ' + focus.ownerName, actionLabel: '查看任务' };
}

function currentSummary(evidence: BriefEvidence[]) {
  const change = evidence.find(row => row.kind === 'progress' || row.kind === 'result' || row.kind === 'decision');
  if (!change) return '';
  const prefix = change.kind === 'progress' ? '最新进展' : change.kind === 'decision' ? change.title : change.ai ? 'AI 已交回' : '已收到成果';
  return prefix + ' · ' + (resultExcerpt(change.text, 72) || change.title);
}

export function buildProjectBriefs(projects: Snapshot[], cards: BoardCard[], notes: KnowledgeNote[], now: number) {
  const active = projects.filter(project => project.project.id && !project.project.deletedAt);
  const projectNames = new Map(active.map(snapshot => [snapshot.project.id, snapshot.project.name]));
  const cardsByProject = new Map<string, BoardCard[]>();
  const evidence: BriefEvidence[] = [];
  for (const card of cards) {
    if (card.projectId && !projectNames.has(card.projectId)) continue;
    const id = card.projectId ?? PERSONAL_BRIEF_ID;
    const group = cardsByProject.get(id) ?? [];
    group.push(card);
    cardsByProject.set(id, group);
    for (const entry of cardEvidence(card)) evidence.push(entry);
  }
  for (const snapshot of active) {
    for (const entry of decisionEvidence(snapshot, cardsByProject.get(snapshot.project.id) ?? [])) evidence.push(entry);
  }
  for (const entry of noteEvidence(notes, projectNames, evidence)) evidence.push(entry);
  evidence.sort(latestFirst);
  const evidenceByProject = new Map<string, BriefEvidence[]>();
  for (const entry of evidence) {
    const id = entry.projectId ?? (entry.cardKey ? PERSONAL_BRIEF_ID : undefined);
    if (!id) continue;
    const group = evidenceByProject.get(id) ?? [];
    group.push(entry);
    evidenceByProject.set(id, group);
  }
  const groups = active.map(({ project }) => ({ id: project.id, name: project.name, goal: project.description, zone: project.timeZone ?? 'Asia/Shanghai' }));
  if (cardsByProject.has(PERSONAL_BRIEF_ID)) groups.push({ id: PERSONAL_BRIEF_ID, name: '个人待办', goal: undefined, zone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const ordered = groups.map(({ id, name, goal, zone }) => {
    const cards = orderedCards(cardsByProject.get(id) ?? [], now, zone);
    const rows = evidenceByProject.get(id) ?? [];
    const counts = { pending: 0, running: 0, attention: 0, done: 0 };
    for (const card of cards) counts[card.state]++;
    const focus = cards[0];
    const review = focus?.attention?.kind === 'review' ? focus.results.find(result => result.currentSubmission &&
      result.itemId === focus.attention?.itemId && (result.status === '待核对' || result.status === '需重新核对')) : undefined;
    const reviewTarget = review && rows.find(row => row.cardKey === focus.key && row.resultId === review.id);
    const focusTarget = reviewTarget ?? (focus ? { ...taskEvidence(focus), itemId: focus.attention?.itemId } : undefined);
    const action = reviewTarget ? { nextAction: '核对「' + reviewTarget.title + '」', why: reviewTarget.ai ? 'AI 已交回这一版，等你确认。' : '这一版已交回，等你确认。', actionLabel: '看成果' }
      : nextMove(focus, now, zone);
    const waitingOnMe = cards.filter(card => briefHandoff(card).needsMe).length;
    const brief: ProjectBrief = { id, name, goal, cards, focus, focusTarget, ...action, summary: currentSummary(rows), evidence: rows, counts, waitingOnMe };
    return { brief, rank: focus ? focusRank(focus, dueTime(focus, zone), now) : 8, latest: timestamp(rows[0]?.at ?? '') };
  });
  ordered.sort((a, b) => a.rank - b.rank || b.latest - a.latest || a.brief.id.localeCompare(b.brief.id));
  const briefs = ordered.map(item => item.brief);
  return { briefs, evidence };
}

const kindLabels: Record<BriefEvidence['kind'], string> = {
  note: '笔记 想法 灵感', source: '来源 原文 想法', task: '任务 待办', progress: '进展 进度', result: '成果 交付 结果', decision: '结论 决定 验收',
};

export function searchBriefEvidence(evidence: BriefEvidence[], query: string, projectId?: string) {
  const scoped = projectId === undefined ? evidence : evidence.filter(row => projectId === PERSONAL_BRIEF_ID ?
    !row.projectId && !!row.cardKey : row.projectId === projectId);
  if (!query.trim()) return scoped;
  const index = scoped.map(row => ({ original: row, title: row.title, at: row.at,
    text: [row.text, row.searchText, row.projectName, kindLabels[row.kind], row.ai && 'AI', row.at.slice(0, 10)].filter(Boolean).join('\n') }));
  return searchKnowledge(index, query, index.length).map(hit => hit.original);
}
