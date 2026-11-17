import { pinTaskHandoff, type TaskHandoffPin } from "./taskHandoff";
import type { Snapshot } from "./types";
import { contextSearchTerms, deriveLedger, hashText, type CollaborationArtifact } from "./collaboration";
import type { ExecutionReference } from "./executionProvenance";
import { stableContent } from "./contentHash";

export interface TaskMemoryCard {
  key: string;
  taskId: string;
  workItemId?: string;
  title: string;
  status: string;
  goal: string;
  summary: string;
  summaryIsExcerpt: boolean;
  handoff?: TaskHandoffPin;
  summaryKind: "accepted-result" | "candidate" | "goal";
  artifactId?: string;
  artifactHash?: string;
  reviewId?: string;
  specRevision: number;
  version: number;
  updatedAt: string;
  stale: boolean;
  archived: boolean;
  dependencies: string[];
  executions: ExecutionReference[];
}
export interface TaskMemoryQuery {
  projectId: string;
  query?: string;
  taskKey?: string;
  sourceSessionId?: string;
  tool?: string;
  connectionId?: string;
  limit?: number;
  includeArchived?: boolean;
  cursor?: string;
}
export interface TaskMemoryResponse {
  items: TaskMemoryCard[];
  total: number;
  sourceSequence: number;
  scope: "project";
  query: string;
  nextCursor?: string;
}
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();
const excerpt = (value: string, max = 240) =>
  value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Per-snapshot index: cheap exact-ID lookup, bounded cards, no separate editable truth. */
export function buildTaskMemoryIndex(snapshot: Snapshot) {
  const rows = deriveLedger(snapshot),
    c = snapshot.collaboration;
  const byId = new Map<string, Set<string>>();
  let terms: Map<string, Set<string>> | undefined;
  const bodies = new Map<string, string>();
  const put = (map: Map<string, Set<string>>, term: string, key: string) => {
    const set = map.get(term) ?? new Set<string>();
    set.add(key);
    map.set(term, set);
  };
  const artifacts = new Map((c?.artifacts ?? []).map((a) => [a.id, a]));
  const submissionArtifacts = new Map((c?.submissions ?? []).map((s) => [s.id, s.artifactId]));
  const artifactReviews = new Map<string, string>();
  for (const review of c?.reviews ?? []) {
    const id = submissionArtifacts.get(review.submissionId);
    if (id && review.verdict === "accepted") artifactReviews.set(id, review.id);
  }
  const cards = rows.map((row) => {
    const accepted = row.acceptedArtifactId ? artifacts.get(row.acceptedArtifactId) : undefined;
    const artifact = accepted ?? row.latestArtifact;
    const reviewId = accepted ? artifactReviews.get(accepted.id) : undefined;
    const card: TaskMemoryCard = {
      key: row.key,
      taskId: row.taskId,
      workItemId: row.workItemId,
      title: row.title,
      status: row.status,
      goal: excerpt(row.spec.goal),
      summary: excerpt(row.handoff?.record.content.summary ?? artifact?.body ?? row.spec.goal),
      summaryIsExcerpt: true,
      handoff: row.handoff ? pinTaskHandoff(row.handoff) : undefined,
      summaryKind: accepted ? "accepted-result" : artifact ? "candidate" : "goal",
      artifactId: artifact?.id,
      artifactHash: artifact?.hash,
      reviewId,
      specRevision: row.specRevision,
      version: row.version,
      updatedAt: artifact?.createdAt ?? row.spec.at,
      stale: !!row.handoff?.stale || !!row.requiresRevalidation || row.freshness === "stale",
      archived: !!row.archived,
      dependencies: [...row.dependencies],
      executions: row.executions,
    };
    for (const id of [
      card.key,
      card.taskId,
      card.workItemId,
      card.artifactId,
      card.handoff?.id,
      ...card.executions.flatMap((e) => [e.sessionId, e.sourceSessionId, e.runId, e.runtimeRunId]),
    ])
      if (id) put(byId, normalize(id), card.key);
    // Index accepted/candidate body once; query responses never copy that full body into context.
    bodies.set(card.key, [card.title, row.spec.goal, artifact?.body ?? ""].join(" "));
    return card;
  });
  const now = Date.now();
  const validUntil = (c?.artifacts ?? []).reduce((expiry, a) => {
    const at = Date.parse(a.expiresAt ?? "");
    return at > now ? Math.min(expiry, at) : expiry;
  }, now + 5000);
  // Paging tracks the business index, not transport events or usage/heartbeat counters.
  // Include full searchable source content: an edit beyond the card excerpt is still a change.
  const identity = hashText(stableContent({
    projectId: snapshot.project.id,
    cards: [...cards].sort((a, b) => a.key.localeCompare(b.key)).map(card => ({
      ...card,
      sourceContentHash: hashText(bodies.get(card.key) ?? ""),
    })),
  }));
  return {
    cards,
    byId,
    identity,
    sourceSnapshot: snapshot,
    projectId: snapshot.project.id,
    sourceSequence: c?.sequence ?? 0,
    validUntil,
    get termsBuilt() {
      return terms !== undefined;
    },
    get terms() {
      if (!terms) {
        terms = new Map();
        for (const [key, body] of bodies)
          for (const term of new Set(contextSearchTerms(body))) put(terms, term, key);
      }
      return terms;
    },
  };
}
/** Stable UI/paging invalidation key; raw execution events are intentionally excluded. */
export function taskMemoryIndexIdentity(snapshot: Snapshot): string {
  return buildTaskMemoryIndex(snapshot).identity;
}
export function queryTaskMemory(
  snapshot: Snapshot,
  query: TaskMemoryQuery,
  cached?: ReturnType<typeof buildTaskMemoryIndex>,
): TaskMemoryResponse {
  const text = (query.query ?? "").trim().slice(0, 500),
    empty: TaskMemoryResponse = {
      items: [],
      total: 0,
      sourceSequence: snapshot.collaboration?.sequence ?? 0,
      scope: "project",
      query: text,
    };
  if (query.projectId !== snapshot.project.id) return empty;
  const index =
      cached?.sourceSnapshot === snapshot && cached.validUntil > Date.now() &&
      cached.sourceSequence === (snapshot.collaboration?.sequence ?? 0)
        ? cached
        : buildTaskMemoryIndex(snapshot),
    exact = index.byId.get(normalize(query.taskKey ?? query.sourceSessionId ?? text));
  const scores = new Map<string, number>();
  for (const key of exact ?? []) scores.set(key, 10000);
  if (!exact && text)
    for (const term of contextSearchTerms(text))
      for (const key of index.terms.get(term) ?? []) scores.set(key, (scores.get(key) ?? 0) + 1);
  let cards = index.cards.filter(
    (card) =>
      (query.includeArchived || !card.archived) &&
      (!query.taskKey || card.key === query.taskKey) &&
      (!query.sourceSessionId ||
        card.executions.some(
          (e) =>
            e.sourceSessionId === query.sourceSessionId &&
            (!query.tool || e.tool === query.tool) &&
            (!query.connectionId || e.connectionId === query.connectionId),
        )) &&
      (!text || scores.has(card.key)),
  );
  cards.sort(
    (a, b) =>
      (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.key.localeCompare(b.key),
  );
  const limit = Number.isSafeInteger(query.limit) ? Math.max(1, Math.min(50, query.limit!)) : 12;
  const fingerprint = hashText(stableContent({ ...query, cursor: undefined, limit: undefined }));
  let offset = 0;
  if (query.cursor) {
    let cursor: { identity: string; fingerprint: string; offset: number } | null;
    try { cursor = JSON.parse(decodeURIComponent(query.cursor)); }
    catch { throw Object.assign(new Error("检索游标无效"), { code: "INVALID_CURSOR" }); }
    if (!cursor || cursor.identity !== index.identity || cursor.fingerprint !== fingerprint ||
        !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)
      throw Object.assign(new Error("检索范围或版本已变化，请重新查询"), { code: "STALE_CURSOR" });
    offset = cursor.offset;
  }
  const items = structuredClone(cards.slice(offset, offset + limit));
  const next = offset + items.length;
  return { ...empty, total: cards.length, items,
    nextCursor: next < cards.length ? encodeURIComponent(JSON.stringify({ identity: index.identity, fingerprint, offset: next })) : undefined };

}
export function getTaskMemory(snapshot: Snapshot, key: string): TaskMemoryCard | undefined {
  return buildTaskMemoryIndex(snapshot).cards.find((card) => card.key === key);
}
export function readTaskEvidence(
  snapshot: Snapshot,
  key: string,
  artifactId: string,
): CollaborationArtifact | undefined {
  const artifact = snapshot.collaboration?.artifacts.find(
    (item) => item.id === artifactId && item.key === key,
  );
  return artifact ? structuredClone(artifact) : undefined;
}
