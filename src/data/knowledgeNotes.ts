import { validateMethodCollections, type MethodBoards, type MethodTemplate } from './methodBoards';
import { sameTableSizes, type NoteTableSizes } from './noteTableSizes';
import { isInspirationBoard, type InspirationBoard } from './inspirationCanvas';
import { matchingNoteLines, noteTodosForBody, validNoteTodos, type NoteTodo } from './noteTodos';
import type { OutputAttachment } from './types';

export const KNOWLEDGE_STORAGE_KEY = 'quandeck.personal-knowledge.v1';
export const KNOWLEDGE_FILES = 'personal-knowledge';
export type NoteSelection = { before: string; quote: string; after: string; offset: number };
export interface UnreadKnowledgeSource { label: string; url?: string; reason: string; checkedAt: string }
export interface PublicKnowledgeSource {
  label?: string;
  url: string;
  title: string;
  excerpt: string;
  checkedAt: string;
}
export type NoteMemoryRef = { kind:'passage'; noteId:string; revision:number; start:number; end:number } | {kind:'idea'; nodeId:string; boardId?:string; title:string; detail:string};
export interface NoteQuestionContext { title: string; before: string; after: string }
export interface QuestionMaterials {
  background?: string;
  memoryRefs?: NoteMemoryRef[];
  surrounding?: NoteQuestionContext;
  agentConnectionId?: string;
}

/** A previewable window around the exact selection, including unsaved edits. */
export function questionContext(title: string, body: string, selection: NoteSelection): NoteQuestionContext {
  const end = selection.offset + selection.quote.length;
  return {
    title,
    before: body.slice(Math.max(0, selection.offset - 360), selection.offset).split('\n').slice(-2).join('\n'),
    after: body.slice(end, end + 360).split('\n').slice(0, 2).join('\n'),
  };
}
export interface NoteExpansion extends QuestionMaterials {
  actionPlan?: import("./noteActions").NoteActionPlan;
  workspace?: import('./workspaceQuestion').WorkspaceAnswer;
  additionalReads?: import('./workspaceQuestion').WorkspaceAnswer[];
  questionRequestId?:string;
  parentAnswerId?:string;
  conversationMode?:'new'|'resumed'|'replayed';

  id: string;
  at: string;
  selection: NoteSelection;
  question: string;
  answer: string;
  sourceIds: string[];
  sources?: PublicKnowledgeSource[];
  unreadSources?: UnreadKnowledgeSource[];
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
  tableSizes?: NoteTableSizes;
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  archivedAt?: string;
  attachments: (OutputAttachment & { inline?: boolean })[];
  expansions: NoteExpansion[];
  history: NoteVersion[];
  changes?: NoteChange[];
  todos?: NoteTodo[];
  readReceiptIds?: string[];
  projectQuotes?: FiledNoteQuote[];
}
export interface FiledNoteQuote {
  id: string;
  projectId: string;
  lineIndex: number;
  text: string;
  markdown?: string;
  at: string;
}
export interface KnowledgeDecision {
  evidence: string;
  result: 'accepted' | 'dismissed';
  at: string;
}
export interface AtomAnchor {
  noteId:string; revision:number; source:string; start:number; end:number; origin:string; at?:string; digest?:string;
}
export interface AgentKnowledgeEdge {
  category?: '同源'|'补充'|'矛盾'|'复用'|'创新';
  evidenceKey?:string;
  anchors?: AtomAnchor[];
  consequence?:string;
  check?:string;
  limitation?:string;
  sourceEvidence?: {noteId:string; title:string; quote:string; origin:string}[];

  from: string;
  to: string;
  fromRevision: number;
  toRevision: number;
  label: string;
  explanation: string;
  fromQuote?: string;
  toQuote?: string;
  provider: string;
}
export interface AgentKnowledgeGraph {
  reasoning?: {version:number; attachmentCoverage?: {noteId:string;fileId:string;name:string;status:string;method?:string}[]};
  fingerprint?: string;
  provider: string;
  at: string;
  notes: { id: string; revision: number }[];
  edges: AgentKnowledgeEdge[];
}

export interface KnowledgeLibrary {
  manualGraphLinks?: [string, string][];
  deletedNoteIds?: string[];
  orphanedNoteFiles?: string[];
  agentGraph?: AgentKnowledgeGraph;
  inspirationCanvas?: InspirationBoard;
  inspirationBoards?: MethodBoards;
  methodTemplates?: MethodTemplate[];
  schema: 1;
  notes: KnowledgeNote[];
  decisions: KnowledgeDecision[];
}
export const emptyKnowledge = (): KnowledgeLibrary => ({ schema: 1, notes: [], decisions: [] });
export function parseKnowledge(raw: string | null): KnowledgeLibrary {
  if (raw === null) return emptyKnowledge();
  const value = JSON.parse(raw);
  if (value?.schema !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.decisions)) throw new Error('识别不了笔记数据，已保留原文件');
  if ([value.deletedNoteIds,value.orphanedNoteFiles].some(ids=>ids!==undefined && (!Array.isArray(ids) || ids.some(id=>typeof id!=='string')))) throw new Error('识别不了笔记删除记录，已保留原文件');
  if (value.manualGraphLinks !== undefined && (!Array.isArray(value.manualGraphLinks) ||
      !value.manualGraphLinks.every((pair: unknown) => Array.isArray(pair) && pair.length === 2 &&
        pair.every(id => typeof id === 'string' && id.trim()) && pair[0] !== pair[1]))) {
    throw new Error('识别不了手动关联的笔记，已保留原文件');
  }
  if (value.inspirationCanvas !== undefined && !isInspirationBoard(value.inspirationCanvas)) throw new Error('识别不了灵感画布，已保留原文件');
  validateMethodCollections(value);
  for (const note of value.notes) {
    if (typeof note?.id !== 'string' || typeof note.title !== 'string' || typeof note.body !== 'string' ||
        typeof note.createdAt !== 'string' || typeof note.updatedAt !== 'string' || !Number.isInteger(note.revision) ||
        !Array.isArray(note.attachments) || !Array.isArray(note.expansions) || !Array.isArray(note.history))
      throw new Error('识别不了笔记内容，已保留原文件');
    if (note.readReceiptIds !== undefined && (!Array.isArray(note.readReceiptIds) || !note.readReceiptIds.every((id: unknown) => typeof id === 'string')))
      throw new Error('识别不了笔记中的回执记录，已保留原文件');
    if (note.todos !== undefined && !validNoteTodos(note.todos, note.body)) throw new Error('识别不了笔记待办，已保留原文件');
    if (note.projectQuotes !== undefined && (!Array.isArray(note.projectQuotes) || !note.projectQuotes.every((q: FiledNoteQuote) =>
      q && typeof q.id === 'string' && typeof q.projectId === 'string' && typeof q.text === 'string' &&
      (q.markdown === undefined || typeof q.markdown === 'string') &&
      Number.isSafeInteger(q.lineIndex) && q.lineIndex >= 0 && Number.isFinite(Date.parse(q.at)))))
      throw new Error('识别不了笔记中的项目引用，已保留原文件');
  }
  if (value.agentGraph && !isAgentGraph(value.agentGraph)) delete value.agentGraph;
  return value;
}

function isAgentGraph(graph: AgentKnowledgeGraph) {
  return typeof graph.provider === 'string' && typeof graph.at === 'string' &&
    Array.isArray(graph.notes) && graph.notes.every(n => typeof n?.id === 'string' && Number.isSafeInteger(n.revision)) &&
    Array.isArray(graph.edges) && graph.edges.every(e => e && [e.from, e.to, e.label, e.explanation, e.provider]
      .every(text => typeof text === 'string' && text.trim()) && Number.isSafeInteger(e.fromRevision) && Number.isSafeInteger(e.toRevision) &&
      (e.anchors ? Array.isArray(e.anchors) && e.anchors.length>=2 && e.anchors.every(a=>typeof a?.noteId==='string' &&
        typeof a.source==='string' && Number.isSafeInteger(a.revision) && Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end) &&
        a.start>=0 && a.end>a.start) : !!e.fromQuote && !!e.toQuote));
}

export function knowledgeAnchorText(note: KnowledgeNote, anchor: AtomAnchor) {
  if (note.revision !== anchor.revision) return;
  let source: string | undefined;
  if (anchor.source === 'body' || anchor.source === 'title') source = note[anchor.source];
  else if (anchor.source.startsWith('attachment:')) {
    const file=note.attachments.find(f=>'attachment:'+f.id===anchor.source);
    if (file && anchor.digest) return file.name+' · 第 '+(anchor.start+1)+'–'+anchor.end+' 字';
  } else if (anchor.source.startsWith('question:')) source=note.expansions.find(e=>'question:'+e.id===anchor.source)?.question;
  else if (anchor.source.startsWith('background:')) source=note.expansions.find(e=>'background:'+e.id===anchor.source)?.background;
  else if (anchor.source.startsWith('expansion:')) source = note.expansions.find(e => 'expansion:'+e.id === anchor.source)?.answer;
  else for (const expansion of note.expansions) {
    const index = expansion.sources?.findIndex((_,i) => 'citation:'+expansion.id+':'+i===anchor.source) ?? -1;
    if (index>=0) { source=expansion.sources![index].excerpt; break; }
  }
  return source && anchor.end<=source.length ? source.slice(anchor.start,anchor.end) : undefined;
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
  const result: ReturnType<typeof textDelta>[] = [];
  let fromA = 0, fromB = 0;
  for (const [a,b] of [...matchingNoteLines(left, right), [left.length, right.length]]) {
    const prior = left.slice(fromA, a).join('\n'), next = right.slice(fromB, b).join('\n');
    if (prior !== next) result.push(textDelta(prior, next));
    fromA = a + 1;
    fromB = b + 1;
  }
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

export function updateNote(note: KnowledgeNote, draft: { title: string; body: string; attachments?: OutputAttachment[]; tableSizes?: NoteTableSizes }, now: string): KnowledgeNote {
  const title = noteDisplayTitle(draft.title, draft.body);
  const attachments = draft.attachments ?? note.attachments;
  const tableSizes = draft.tableSizes ?? note.tableSizes;
  if (title === note.title && draft.body === note.body && attachments.length === note.attachments.length &&
      attachments.every((file, index) => file.id === note.attachments[index].id)) {
    // Display dimensions do not invalidate citations to this text revision.
    return sameTableSizes(tableSizes, note.tableSizes) ? note : { ...note, tableSizes, updatedAt: now };
  }
  return {
    ...note, ...(tableSizes && (Object.keys(tableSizes).length || note.tableSizes) && { tableSizes }), title, body: draft.body, attachments, updatedAt: now, revision: note.revision + 1,
    ...(note.todos?.length ? { todos: noteTodosForBody(note, draft.body, new Date(now)) } : {}),
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

// The desktop checks query parameters and the resolved destination before fetching.
export function publicNoteLinks(body: string): string[] {
  const links = new Set<string>();
  for (const value of noteLinks(body)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.href.length > 2048) continue;
    if (!url.hostname.includes('.') || url.hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
        /(?:^|\.)(?:local|localhost|internal|lan|test|invalid|onion)\.?$/i.test(url.hostname)) continue;
    url.hash = '';
    links.add(url.href);
  }
  return [...links];
}
