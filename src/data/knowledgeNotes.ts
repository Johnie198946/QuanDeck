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

export function updateNote(note: KnowledgeNote, draft: { title: string; body: string }, now: string): KnowledgeNote {
  const title = draft.title.trim() || draft.body.trim().split('\n')[0]?.slice(0, 40) || '未命名';
  if (title === note.title && draft.body === note.body) return note;
  return {
    ...note, title, body: draft.body, updatedAt: now, revision: note.revision + 1,
    history: [...note.history, { revision: note.revision, title: note.title, body: note.body, at: note.updatedAt }],
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
