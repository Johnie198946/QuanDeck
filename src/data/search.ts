import type { Snapshot } from "./types";
import { buildTaskMemoryIndex } from './taskMemory';

/** Versioned search contract shared by the local preview and GET /v1/search. */
export type SearchKind = "task" | "work" | "session" | "journal" | "plan" | "conclusion";
export interface SearchTarget {
  taskId?: string;
  itemId?: string;
  sessionId?: string;
  /** Parent business session and child identity for matching task glyphs. */
  parentSessionId?: string;
  subAgentId?: string;
  planId?: string;
  sectionId?: string;
  blockId?: string;
  conclusionId?: string;
}
export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  snippet: string;
  date: string;
  score: number;
  target: SearchTarget;
}
export interface SearchRequest {
  projectId: string;
  query: string;
  limit?: number;
  kinds?: SearchKind[];
  cursor?: string;
}
export interface SearchResponse {
  items: SearchHit[];
  total: number;
  nextCursor?: string;
  /** Only this scope is indexed; the local provider does not pretend to search other dates. */
  scope: "current_snapshot" | "project_index";
  indexedAt: string;
}
export interface SearchBackend {
  search(request: SearchRequest, options?: { signal?: AbortSignal }): Promise<SearchResponse>;
}
interface SearchDocument extends Omit<SearchHit, "score" | "snippet"> { body: string }

const compact = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
/** Bounded substring Damerau-Levenshtein, O(text × query), including transposed characters. */
function approximateSubstring(text: string, query: string, maxEdits: number): number | null {
  let previous = Array.from({ length: query.length + 1 }, (_, index) => index);
  let beforePrevious = previous;
  for (let i = 0; i < text.length; i++) {
    const current = [0]; // A match may start at any text position.
    for (let j = 1; j <= query.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + Number(text[i] !== query[j - 1]));
      if (i > 0 && j > 1 && text[i] === query[j - 2] && text[i - 1] === query[j - 1]) current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
    }
    if (current[query.length] <= maxEdits) return current[query.length];
    beforePrevious = previous;
    previous = current;
  }
  return null;
}
function scoreField(raw: string, query: string, fuzzy: boolean) {
  const text = compact(raw);
  if (!query || !text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 94;
  if (text.includes(query)) return 88;
  if (!fuzzy || query.length < 3 || query.length > 48) return 0;
  // Tight subsequences allow e.g. “读书搜索” to match “读书笔记全文搜索”.
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== query[0]) continue;
    let matched = 1;
    for (let i = start + 1; i < Math.min(text.length, start + query.length * 3); i++) {
      if (text[i] === query[matched]) matched++;
      if (matched === query.length) return 66 - (i - start + 1 - query.length);
    }
  }
  // One typo from length 3; two from length 9. Full body is searched without truncating paragraphs.
  const distance = approximateSubstring(text, query, query.length >= 9 ? 2 : 1);
  if (distance !== null) return 58 - distance * 8;
  return 0;
}
function snippet(body: string, query: string) {
  const flat = body.replace(/\s+/g, " ").trim();
  const term = query.trim().split(/\s+/)[0].toLowerCase();
  const lower = flat.toLowerCase();
  let index = lower.indexOf(term);
  // A typo can miss the literal query; show the longest unchanged part near the match.
  for (let length = Math.min(term.length - 1, 48); index < 0 && length >= 2; length--) {
    for (let offset = 0; offset + length <= term.length && index < 0; offset++) index = lower.indexOf(term.slice(offset, offset + length));
  }
  const start = Math.max(0, index - 24);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 110)}${flat.length > start + 110 ? "…" : ""}`;
}
function documents(s: Snapshot): SearchDocument[] {
  const docs: SearchDocument[] = [];
  const memory = new Map(buildTaskMemoryIndex(s).cards.map(card=>[card.key,card]));
  const artifactBodies = new Map((s.collaboration?.artifacts??[]).map(artifact=>[artifact.id,artifact.body]));
  const memoryText = (key:string) => {const card=memory.get(key);return card?[card.key,card.goal,card.summary,card.artifactId?artifactBodies.get(card.artifactId):'',...card.executions.flatMap(e=>[e.agentId,e.tool,e.connectionId,e.sourceSessionId,e.sessionId,e.runId,e.runtimeRunId])].filter(Boolean).join('\n'):'';};
  const date = s.date;
  const add = (document: Omit<SearchDocument, "date">) => docs.push({ ...document, date });
  for (const task of Object.values(s.tasks)) add({ id: `task:${task.id}`, kind: "task", title: task.title, body: [task.title,memoryText(task.id)].join('\n'), target: { taskId: task.id } });
  add({ id: `journal:${s.date}`, kind: "journal", title: s.journal.title, body: s.journal.summary, target: {} });
  for (const block of s.journal.blocks) if (block.kind === "text") add({ id: `journal:${block.id}`, kind: "journal", title: block.text.slice(0, 48), body: block.text, target: { blockId: block.id } });
  for (const session of Object.values(s.sessions)) {
    if (session.taskId && s.deletedTasks?.[session.taskId] || session.runtime?.workItemId && s.deletedWorkItems?.[`${session.taskId}::${session.runtime.workItemId}`]) continue;
    add({ id: `session:${session.id}`, kind: "session", title: session.title, body: [session.step?.label, session.waitingQuestion, ...session.rounds.map(r => r.reply)].filter(Boolean).join("\n"), target: { sessionId: session.id, taskId: session.taskId ?? undefined } });
    for (const sub of session.subAgents) add({ id: `session:${session.id}:${sub.id}`, kind: "session", title: sub.title, body: sub.title, target: { sessionId: sub.sessionRef, parentSessionId: session.id, subAgentId: sub.id, taskId: session.taskId ?? undefined } });
  }
  for (const orch of Object.values(s.orchestrations ?? {}).filter(orch => !s.deletedTasks?.[orch.taskId])) for (const item of Object.values(orch.items)) {
    const rounds = item.attemptIds.flatMap(id => orch.attempts[id]?.rounds ?? []);
    add({ id: `work:${orch.taskId}:${item.id}`, kind: "work", title: item.title, body: [item.expected, item.statusReason, item.waiting?.question, memoryText(`${orch.taskId}::${item.id}`), ...rounds.map(r => r.reply)].filter(Boolean).join("\n"), target: { taskId: orch.taskId, itemId: item.id } });
  }
  for (const plan of Object.values(s.ideaPlans ?? {})) {
    if (s.deletedTasks?.[plan.taskId] || plan.itemId && s.deletedWorkItems?.[`${plan.taskId}::${plan.itemId}`]) continue;
    for (const section of plan.draft.sections) add({ id: `plan:${plan.id}:${section.id}`, kind: "plan", title: `${plan.title} · ${section.title}`, body: section.lines.map(l => l.text).join("\n"), target: { taskId: plan.taskId, itemId: plan.itemId ?? undefined, planId: plan.id, sectionId: section.id } });
    for (const conclusion of plan.discussion?.conclusions ?? []) add({ id: `conclusion:${plan.id}:${conclusion.id}`, kind: "conclusion", title: `${plan.title} · 讨论结论`, body: [conclusion.summary, ...conclusion.confirmed, ...conclusion.open].join("\n"), target: { taskId: plan.taskId, itemId: plan.itemId ?? undefined, planId: plan.id, conclusionId: conclusion.id, sectionId: conclusion.scopeId === "root" ? undefined : conclusion.scopeId } });
  }
  return docs;
}
export function searchSnapshot(snapshot: Snapshot, request: SearchRequest): SearchResponse {
  const response: SearchResponse = { items: [], total: 0, scope: "current_snapshot", indexedAt: snapshot.lastSync };
  if (request.projectId !== snapshot.project.id) return response;
  const terms = request.query.trim().slice(0, 200).split(/\s+/).map(compact).filter(Boolean);
  if (!terms.length) return response;
  const matches: SearchHit[] = [];
  for (const document of documents(snapshot)) {
    if (request.kinds?.length && !request.kinds.includes(document.kind)) continue;
    const scores = terms.map(term => Math.max(scoreField(document.title, term, true), scoreField(document.body, term, true) * .75));
    if (scores.some(score => !score)) continue;
    const { body, ...hit } = document;
    matches.push({ ...hit, score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), snippet: snippet(body || hit.title, request.query) });
  }
  const kindRank: Record<SearchKind, number> = { task: 0, work: 1, plan: 2, conclusion: 3, journal: 4, session: 5 };
  matches.sort((a, b) => b.score - a.score || kindRank[a.kind] - kindRank[b.kind] || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(50, request.limit ?? 12));
  const offset = /^\d+$/.test(request.cursor ?? "") ? Number(request.cursor) : 0;
  return { ...response, items: matches.slice(offset, offset + limit), total: matches.length, ...(offset + limit < matches.length ? { nextCursor: String(offset + limit) } : {}) };
}
export function createLocalSearchBackend(getSnapshot: () => Snapshot): SearchBackend {
  return { async search(request, options) {
    options?.signal?.throwIfAborted();
    const result = searchSnapshot(getSnapshot(), request);
    options?.signal?.throwIfAborted();
    return result;
  } };
}
export function createHttpSearchBackend(baseUrl: string): SearchBackend {
  return { async search(request, options) {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/v1/search`, typeof location === "undefined" ? "http://localhost" : location.origin);
    url.searchParams.set("projectId", request.projectId);
    url.searchParams.set("q", request.query);
    url.searchParams.set("limit", String(request.limit ?? 12));
    if (request.cursor) url.searchParams.set("cursor", request.cursor);
    if (request.kinds?.length) url.searchParams.set("kinds", request.kinds.join(","));
    const response = await fetch(url, { signal: options?.signal, credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`搜索暂不可用（${response.status}）`);
    const body: unknown = await response.json();
    if (!isSearchResponse(body)) throw new Error("搜索响应格式不正确");
    return body;
  } };
}
function isSearchResponse(value: unknown): value is SearchResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as SearchResponse;
  const kinds = ["task", "work", "session", "journal", "plan", "conclusion"];
  return Number.isFinite(data.total) && data.total >= 0 && typeof data.indexedAt === "string" && ["current_snapshot", "project_index"].includes(data.scope) && Array.isArray(data.items) && data.items.every(hit => hit && typeof hit.id === "string" && kinds.includes(hit.kind) && typeof hit.title === "string" && typeof hit.snippet === "string" && typeof hit.date === "string" && Number.isFinite(hit.score) && hit.target && typeof hit.target === "object" && Object.values(hit.target).every(v => typeof v === "string" || v === undefined));
}
/** Only the latest request can update the popup, including when an old backend ignores AbortSignal. */
export class SearchRequestGate {
  private revision = 0;
  private controller?: AbortController;
  cancel() { this.revision++; this.controller?.abort(); }
  async run(backend: SearchBackend, request: SearchRequest): Promise<SearchResponse | null> {
    this.cancel();
    const revision = this.revision;
    this.controller = new AbortController();
    try {
      const response = await backend.search(request, { signal: this.controller.signal });
      return revision === this.revision ? response : null;
    } catch (error) {
      if (revision !== this.revision || this.controller.signal.aborted) return null;
      throw error;
    }
  }
}
