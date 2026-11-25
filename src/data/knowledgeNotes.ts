import type { OutputAttachment } from './types';

export const KNOWLEDGE_STORAGE_KEY = 'quandeck.personal-knowledge.v1';
export const KNOWLEDGE_FILES = 'personal-knowledge';
export type NoteSelection = { before: string; quote: string; after: string; offset: number };
export interface PublicKnowledgeSource {
  url: string;
  title: string;
  excerpt: string;
  checkedAt: string;
}
export interface NoteExpansion {
  id: string;
  at: string;
  selection: NoteSelection;
  question: string;
  answer: string;
  sourceIds: string[];
  sources?: PublicKnowledgeSource[];
}
export interface NoteVersion {
  revision: number;
  title: string;
  body: string;
  at: string;
}
export interface NoteChange {
  at: string;
  field: '标题' | '正文' | '附件';
  before: string;
  after: string;
}
export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  archivedAt?: string;
  attachments: OutputAttachment[];
  expansions: NoteExpansion[];
  history: NoteVersion[];
  changes?: NoteChange[];
}
export interface KnowledgeDecision {
  evidence: string;
  result: 'accepted' | 'dismissed';
  at: string;
}
export interface KnowledgeLibrary {
  schema: 1;
  notes: KnowledgeNote[];
  decisions: KnowledgeDecision[];
}
export const emptyKnowledge = (): KnowledgeLibrary => ({ schema: 1, notes: [], decisions: [] });
export function parseKnowledge(raw: string | null): KnowledgeLibrary {
  if (raw === null) return emptyKnowledge();
  const value = JSON.parse(raw);
  if (value?.schema !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.decisions)) throw new Error('识别不了笔记数据，已保留原文件');
  for (const note of value.notes) {
    if (typeof note?.id !== 'string' || typeof note.title !== 'string' || typeof note.body !== 'string' ||
        typeof note.createdAt !== 'string' || typeof note.updatedAt !== 'string' || !Number.isInteger(note.revision) ||
        !Array.isArray(note.attachments) || !Array.isArray(note.expansions) || !Array.isArray(note.history))
      throw new Error('识别不了笔记内容，已保留原文件');
  }
  return value;
}

export function makeSelection(body: string, start: number, end: number): NoteSelection {
  return { before: body.slice(Math.max(0, start - 28), start), quote: body.slice(start, end), after: body.slice(end, end + 28), offset: start };
}

export function locateSelection(body: string, selection: NoteSelection): number | undefined {
  const { before, quote, after } = selection;
  if (!quote) return;
  const original = before + quote + after;
  const contextual = body.indexOf(original);
  if (contextual >= 0 && body.indexOf(original, contextual + 1) === -1) return contextual + before.length;
  const exact = body.indexOf(quote);
  if (exact >= 0 && body.indexOf(quote, exact + 1) === -1) return exact;
}

function textDelta(before: string, after: string) {
  const left = Array.from(before), right = Array.from(after);
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end + start < left.length && end + start < right.length && left[left.length - end - 1] === right[right.length - end - 1]) end++;
  return { before: left.slice(start, left.length - end).join(''), after: right.slice(start, right.length - end).join('') };
}

function changesBetween(previous: Pick<KnowledgeNote, 'title' | 'body'>, current: Pick<KnowledgeNote, 'title' | 'body'>, at: string) {
  const changes: NoteChange[] = [];
  if (previous.title !== current.title) changes.push({ at, field: '标题', before: previous.title, after: current.title });
  if (previous.body !== current.body) changes.push(...bodyDeltas(previous.body, current.body).map(delta => ({ at, field: '正文' as const, ...delta })));
  return changes;
}

function bodyDeltas(before: string, after: string) {
  const left = before ? before.split('\n') : [];
  const right = after ? after.split('\n') : [];
  if (!left.length || !right.length || (left.length + 1) * (right.length + 1) > 90_000) return [textDelta(before, after)];
  // Find unchanged lines shared by both versions, then compare each gap by character.
  const width = right.length + 1, scores = new Uint16Array((left.length + 1) * width);
  for (let a = left.length - 1; a >= 0; a--) {
    for (let b = right.length - 1; b >= 0; b--) {
      scores[a * width + b] = left[a] === right[b]
        ? 1 + scores[(a + 1) * width + b + 1]
        : Math.max(scores[(a + 1) * width + b], scores[a * width + b + 1]);
    }
  }
  const result: ReturnType<typeof textDelta>[] = [];
  let a = 0, b = 0, fromA = 0, fromB = 0;
  const append = () => {
    const prior = left.slice(fromA, a).join('\n'), next = right.slice(fromB, b).join('\n');
    if (prior !== next) result.push(textDelta(prior, next));
  };
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      append();
      fromA = ++a;
      fromB = ++b;
    } else if (scores[(a + 1) * width + b] >= scores[a * width + b + 1]) a++;
    else b++;
  }
  a = left.length;
  b = right.length;
  append();
  // Whitespace-only edits can leave identical blocks after line splitting.
  return result.length ? result : [textDelta(before, after)];
}

export function noteChanges(note: KnowledgeNote): NoteChange[] {
  if (Array.isArray(note.changes)) return note.changes;
  return note.history.flatMap((version, index) => {
    const next = note.history[index + 1];
    return next ? changesBetween(version, next, next.at) : changesBetween(version, note, note.updatedAt);
  });
}

export function noteDisplayTitle(title: string, body: string) {
  return title.trim() || body.trim().split('\n')[0]?.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim().slice(0, 40) || '未命名';
}

export function updateNote(note: KnowledgeNote, draft: { title: string; body: string; attachments?: OutputAttachment[] }, now: string): KnowledgeNote {
  const title = noteDisplayTitle(draft.title, draft.body);
  const attachments = draft.attachments ?? note.attachments;
  if (title === note.title && draft.body === note.body && attachments.length === note.attachments.length &&
      attachments.every((file, index) => file.id === note.attachments[index].id)) return note;
  return {
    ...note, title, body: draft.body, attachments, updatedAt: now, revision: note.revision + 1,
    changes: [
      ...noteChanges(note),
      ...changesBetween(note, { title, body: draft.body }, now),
      ...attachments.filter(file => !note.attachments.some(item => item.id === file.id)).map(file => ({ at: now, field: '附件' as const, before: '', after: file.name })),
      ...note.attachments.filter(file => !attachments.some(item => item.id === file.id)).map(file => ({ at: now, field: '附件' as const, before: file.name, after: '' })),
    ],
  };
}

export function noteLinks(body: string): string[] {
  const urls = new Set<string>();
  for (const match of body.matchAll(/https?:\/\/[^\s<>()\[\]"'，。；！、]+/gu)) {
    try {
      const url = new URL(match[0].replace(/[.,;!?]+$/, ''));
      if (url.username || url.password) continue;
      urls.add(url.href);
    } catch { /* Invalid text stays in the original note. */ }
  }
  return [...urls];
}
