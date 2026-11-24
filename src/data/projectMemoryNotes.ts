import type { Snapshot } from "./types";
import { hashText, stableContent } from "./contentHash";
import { contextSearchTerms, estimateTokens, isCollaborationArtifactFresh, type CollaborationContext } from "./collaboration";

export interface ProjectMemoryNote {
  id: string;
  noteId: string;
  projectId: string;
  revision: number;
  at: string;
  author: string;
  status: "candidate" | "confirmed" | "withdrawn";
  situation: string;
  action: string;
  outcome: string;
  limitation: string;
  source: { taskKey: string; artifactId: string; hash: string; reviewId: string };
  observationId?: string;
  hash: string;
}

export interface MemoryObservation {
  id: string;
  projectId: string;
  text: string;
  at: string;
  author: string;
}
export type MemoryEffect = "helpful" | "adjust" | "inapplicable";
export interface MemoryFeedback {
  id: string;
  projectId: string;
  lessonId: string;
  lessonHash: string;
  artifactId: string;
  artifactHash: string;
  reviewId: string;
  effect: MemoryEffect;
  reason: string;
  at: string;
  author: string;
}
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
const noteKey = (
  n: Pick<ProjectMemoryNote, "source" | "situation" | "action" | "outcome" | "limitation">,
) =>
  JSON.stringify([
    n.source.artifactId,
    n.source.hash,
    ...[n.situation, n.action, n.outcome, n.limitation].map(normalize),
  ]);
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const content = (value: unknown, name: string) =>
  typeof value === "string" && value.trim() && value.length <= 1000
    ? value.trim()
    : fail("MEMORY_NOTE_INVALID", name + "需要 1–1000 字");

/** Human reflection is a business fact. It never changes a task, normative Spec or permission. */
export function recordProjectMemoryNote(
  snapshot: Snapshot,
  payload: Record<string, unknown>,
  author: string,
): ProjectMemoryNote {
  const c = snapshot.collaboration!;
  const previous = payload.noteId
    ? [...(c.memoryNotes ?? [])].reverse().find((item) => item.noteId === payload.noteId)
    : undefined;
  if (payload.noteId && !previous) fail("NOT_FOUND", "经验记录不存在");
  if (previous && payload.expectedRevision !== previous.revision)
    fail("VERSION_CONFLICT", "经验记录已更新，请刷新后修改");
  if (!previous && payload.expectedRevision !== undefined)
    fail("VERSION_CONFLICT", "新经验不能携带历史版本");
  if (
    typeof payload.status !== "string" ||
    !["candidate", "confirmed", "withdrawn"].includes(payload.status)
  )
    fail("MEMORY_NOTE_INVALID", "经验状态无效");
  const status = payload.status as ProjectMemoryNote["status"];
  if (status === "withdrawn" && !previous) fail("MEMORY_NOTE_INVALID", "只能撤回已有经验");
  const artifactId = status === "withdrawn" ? previous!.source.artifactId : payload.artifactId;
  const artifact = c.artifacts.find((item) => item.id === artifactId);
  const task = artifact ? c.tasks[artifact.key] : undefined;
  const submission = artifact
    ? c.submissions.find((item) => item.artifactId === artifact.id)
    : undefined;
  const review = submission
    ? [...c.reviews].reverse().find((item) => item.submissionId === submission.id)
    : undefined;
  if (
    status !== "withdrawn" &&
    (!artifact ||
      !task ||
      task.archived ||
      task.acceptedArtifactId !== artifact.id ||
      task.requiresRevalidation ||
      !isCollaborationArtifactFresh(snapshot, artifact.id) ||
      review?.verdict !== "accepted")
  )
    fail("MEMORY_SOURCE_CHANGED", "请选择当前有效且已验收的成果作为经验依据");
  if (
    status !== "withdrawn" &&
    (payload.artifactHash !== artifact!.hash || hashText(artifact!.body) !== artifact!.hash)
  )
    fail("MEMORY_SOURCE_CHANGED", "经验来源版本已变化，请重新查看来源");
  const observationId = payload.observationId ?? previous?.observationId;
  if (
    observationId !== undefined &&
    (typeof observationId !== "string" ||
      !c.memoryObservations?.some(
        (o) => o.projectId === snapshot.project.id && o.id === observationId,
      ))
  )
    fail("NOT_FOUND", "待核观察不存在");
  const revision = (previous?.revision ?? 0) + 1;
  const noteId = previous?.noteId ?? "memory-note:" + crypto.randomUUID();
  const note = {
    id: noteId + ":v" + revision,
    noteId,
    projectId: snapshot.project.id,
    revision,
    at: new Date().toISOString(),
    author,
    status,
    ...(typeof observationId === "string" ? { observationId } : {}),
    situation:
      status === "withdrawn" ? previous!.situation : content(payload.situation, "适用情境"),
    action: status === "withdrawn" ? previous!.action : content(payload.action, "做法"),
    outcome: status === "withdrawn" ? previous!.outcome : content(payload.outcome, "结果"),
    limitation:
      status === "withdrawn" ? previous!.limitation : content(payload.limitation, "限制与下次调整"),
    source:
      status === "withdrawn"
        ? previous!.source
        : {
            taskKey: artifact!.key,
            artifactId: artifact!.id,
            hash: artifact!.hash,
            reviewId: review!.id,
          },
  };
  if (status !== "withdrawn") {
    const duplicate = projectMemoryNotes(snapshot).find(
      (n) => n.noteId !== previous?.noteId && noteKey(n) === noteKey(note),
    );
    if (duplicate) {
      if (!previous && duplicate.status === status && duplicate.observationId === observationId) {
        return c.memoryNotes!.find((n) => n.id === duplicate.id)!;
      }
      fail(
        "MEMORY_DUPLICATE",
        duplicate.status === "withdrawn"
          ? "相同经验已撤回。请核对新证据或修改适用范围。"
          : "相同经验已经存在，请修订原记录。",
      );
    }
  }
  const record = { ...note, hash: hashText(stableContent(note)) };
  (c.memoryNotes ??= []).push(record);
  return record;
}

export function projectMemoryNotes(snapshot: Snapshot) {
  const latest = new Map<string, ProjectMemoryNote>();
  const records = snapshot.collaboration?.memoryNotes ?? [];
  for (const note of records)
    if (note.projectId === snapshot.project.id) latest.set(note.noteId, note);
  // Fold aliases written by older versions. A withdrawal suppresses every identical copy.
  const unique = new Map<string, ProjectMemoryNote>();
  for (const note of latest.values()) {
    const key = noteKey(note),
      prior = unique.get(key);
    if (
      !prior ||
      note.status === "withdrawn" ||
      (prior.status === "candidate" && note.status === "confirmed")
    )
      unique.set(key, note);
  }
  return [...unique.values()].map((note) => {
    const { hash, ...body } = note;
    const c = snapshot.collaboration,
      artifact = c?.artifacts.find((item) => item.id === note.source.artifactId);
    const task = c?.tasks[note.source.taskKey];
    const review = c?.reviews.find((item) => item.id === note.source.reviewId);
    const submission = review && c?.submissions.find((item) => item.id === review.submissionId);
    const stale =
      hashText(stableContent(body)) !== hash ||
      !artifact ||
      artifact.key !== note.source.taskKey ||
      artifact.hash !== note.source.hash ||
      hashText(artifact.body) !== note.source.hash ||
      !task ||
      task.archived ||
      task.acceptedArtifactId !== artifact.id ||
      task.requiresRevalidation ||
      review?.verdict !== "accepted" ||
      submission?.artifactId !== artifact.id ||
      !isCollaborationArtifactFresh(snapshot, artifact.id);
    return { ...note, stale: !!stale };
  });
}

export function recordMemoryObservation(
  snapshot: Snapshot,
  payload: Record<string, unknown>,
  author: string,
) {
  const c = snapshot.collaboration!,
    text = content(payload.text, "观察");
  const notes = (c.memoryObservations ??= []);
  const existing = notes.find(
    (o) => o.projectId === snapshot.project.id && normalize(o.text) === normalize(text),
  );
  if (existing) return existing;
  const observation = {
    id: "observation:" + crypto.randomUUID(),
    projectId: snapshot.project.id,
    text,
    at: new Date().toISOString(),
    author,
  };
  notes.push(observation);
  return observation;
}

// Evidence must be the accepted downstream deliverable. Show only revisions actually
// present in its execution packet (or, for a manual handoff, a packet fixed before submission).
function feedbackEvidence(snapshot: Snapshot, artifactId: string) {
  const c = snapshot.collaboration,
    artifact = c?.artifacts.find((a) => a.id === artifactId);
  const task = artifact && c?.tasks[artifact.key];
  const sub = c?.submissions.find(
    (s) => s.artifactId === artifactId && s.id === task?.latestSubmissionId,
  );
  const review =
    sub && c?.reviews.find((r) => r.submissionId === sub.id && r.verdict === "accepted");
  if (
    !c ||
    !artifact ||
    !task ||
    task.archived ||
    task.status !== "done" ||
    task.requiresRevalidation ||
    task.acceptedArtifactId !== artifact.id ||
    !sub ||
    !review ||
    !isCollaborationArtifactFresh(snapshot, artifactId) ||
    hashText(artifact.body) !== artifact.hash
  )
    return undefined;
  const pack = sub.runId
    ? c.contextPackages.find(
        (p) =>
          c.runs[sub.runId!]?.contextPackageId === p.id &&
          p.runId === sub.runId &&
          p.key === task.key,
      )
    : c.contextPackages.find(
        (p) =>
          p.id === sub.reflectionContextId &&
          !p.runId &&
          p.key === task.key &&
          p.specRevision === sub.specRevision,
      );
  if (!pack || pack.specRevision !== sub.specRevision) return undefined;
  return { artifact, review, pack, task, pins: runLessonPins(snapshot, pack, sub.at) };
}

export function feedbackOptions(snapshot: Snapshot, artifactId: string) {
  const evidence = feedbackEvidence(snapshot, artifactId);
  if (!evidence?.pins.length) return [];
  const { artifact, review, task, pins } = evidence;
  return projectMemoryNotes(snapshot)
    .filter(
      (n) =>
        n.status === "confirmed" &&
        !n.stale &&
        n.source.taskKey !== task.key &&
        pins.some((pin) => pin.id === n.id && pin.hash === n.hash),
    )
    .map((note) => ({ note, artifact, review }));
}

export function recordMemoryFeedback(
  snapshot: Snapshot,
  payload: Record<string, unknown>,
  author: string,
) {
  const c = snapshot.collaboration!;
  const chosen = feedbackOptions(snapshot, String(payload.artifactId)).find(
    (o) => o.note.id === payload.lessonId && o.artifact.hash === payload.artifactHash,
  );
  if (!chosen)
    throw Object.assign(new Error("本次已验收交付没有固定该版本的经验依据"), {
      code: "MEMORY_SOURCE_CHANGED",
    });
  const effect = payload.effect;
  if (effect !== "helpful" && effect !== "adjust" && effect !== "inapplicable")
    fail("MEMORY_NOTE_INVALID", "请选择采用效果");
  const reason = content(payload.reason, "采用反馈");
  const prior = c.memoryFeedback?.find(
    (f) => f.lessonId === chosen.note.id && f.reviewId === chosen.review.id,
  );
  if (prior) {
    if (prior.effect === effect && prior.reason === reason) return prior;
    fail("VERSION_CONFLICT", "本次验收已记录采用反馈");
  }
  const item: MemoryFeedback = {
    id: "experience-feedback:" + crypto.randomUUID(),
    projectId: snapshot.project.id,
    lessonId: chosen.note.id,
    lessonHash: chosen.note.hash,
    artifactId: chosen.artifact.id,
    artifactHash: chosen.artifact.hash,
    reviewId: chosen.review.id,
    effect: effect as MemoryEffect,
    reason,
    at: new Date().toISOString(),
    author,
  };
  (c.memoryFeedback ??= []).push(item);
  return item;
}

function searchTerms(text: string) {
  const normalized = normalize(text);
  const terms = new Set(contextSearchTerms(normalized));
  // Narrow vocabulary bridges; a match indicates relevance, never acceptance or a rule.
  for (const [tag, forms] of vocabulary)
    if (forms.some((word) => normalized.includes(word))) terms.add(tag);
  return terms;
}
const vocabulary: [string, string[]][] = [
  ["@offline", ["无网", "断网", "离线", "脱机", "没有网络", "offline"]],
  ["@checkin", ["签到", "检票", "验票", "check-in"]],
  ["@review", ["验收", "acceptance review"]],
  ["@handover", ["交接", "接手", "handover", "handoff"]],
];
/** Reuse an outcome only while its accepted deliverable and its original lesson pin still agree. */
export function currentLessonFeedback(snapshot: Snapshot) {
  const byLesson = new Map<string, { feedback: MemoryFeedback; goal: string }[]>();
  const evidenceByArtifact = new Map<string, ReturnType<typeof feedbackEvidence>>();
  const seen = new Set<string>();
  for (const feedback of snapshot.collaboration?.memoryFeedback ?? []) {
    if (feedback.projectId !== snapshot.project.id) continue;
    if (!evidenceByArtifact.has(feedback.artifactId)) {
      evidenceByArtifact.set(feedback.artifactId, feedbackEvidence(snapshot, feedback.artifactId));
    }
    const source = evidenceByArtifact.get(feedback.artifactId);
    if (!source || source.artifact.hash !== feedback.artifactHash || source.review.id !== feedback.reviewId ||
        !source.pins.some(pin => pin.id === feedback.lessonId && pin.hash === feedback.lessonHash)) continue;
    const key = JSON.stringify([feedback.reviewId, feedback.lessonId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = byLesson.get(feedback.lessonId) ?? [];
    rows.push({ feedback, goal: source.pack.goal });
    byLesson.set(feedback.lessonId, rows);
  }
  return byLesson;
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const term of left) if (right.has(term)) count++;
  return count;
}

/** Compare the recorded task goal rather than generalising votes to the whole project. */
function similarGoal(a: Set<string>, b: Set<string>) {
  const common = overlap(a, b);
  return common >= 3 && common / (a.size + b.size - common) >= 0.6;
}

export function queryProjectLessons(snapshot: Snapshot, taskKey: string, topic?: string, sourceIds?: string[], requiredKeys?: ReadonlySet<string>) {
  const c = snapshot.collaboration, task = c?.tasks[taskKey];
  if (!c || !task) return [];
  const spec = c.specs.find(item => item.key === taskKey && item.revision === task.specRevision);
  const goal = normalize(spec?.goal ?? "");
  const terms = searchTerms(topic || (task.title + " " + goal)), goalTerms = searchTerms(goal);
  const evidence = currentLessonFeedback(snapshot);
  const matchingGoals = new Map<string, boolean>();
  const notes = projectMemoryNotes(snapshot).filter(note => note.status === "confirmed" && !note.stale);
  const sourceCounts = new Map<string, number>();
  for (const note of notes) sourceCounts.set(note.source.taskKey, (sourceCounts.get(note.source.taskKey) ?? 0) + 1);
  const candidates = notes.filter(note => !sourceIds || sourceIds.includes(note.source.artifactId)).map(note => {
      const sameContext = (evidence.get(note.id) ?? []).filter(({ feedback, goal: recorded }) => {
        if (feedback.lessonHash !== note.hash) return false;
        if (!matchingGoals.has(recorded)) {
          matchingGoals.set(recorded, !!goal && (goal === normalize(recorded) || similarGoal(goalTerms, searchTerms(recorded))));
        }
        return matchingGoals.get(recorded);
      }).map(row => row.feedback);
      const helpful = sameContext.filter(f => f.effect === "helpful").length;
      const misses = sameContext.filter(f => f.effect === "inapplicable").length;
      const adjustments = sameContext.length - helpful - misses;
      const caution = sameContext.filter(f => f.effect !== "helpful").at(-1);
      const words = searchTerms(note.situation + " " + note.action);
      const relevance = overlap(terms, words);
      return {
        note: { ...note, ...(caution ? { counterexample: { reviewId: caution.reviewId, effect: caution.effect, reason: caution.reason.slice(0, 200) } } : {}) },
        helpful, misses, adjustments, relevance, direct: Number(task.dependencies.includes(note.source.taskKey) || requiredKeys?.has(note.source.taskKey)),
      };
    })
    // Independent adverse outcomes suppress a recommendation in that situation only.
    .filter(row => !(row.misses >= 2 && row.misses > row.helpful))
    // A single handoff tip can serve as a fallback. Multiple tips on a dependency need
    // some evidence distinguishing which one applies; the required handoff travels separately.
    .filter(row => row.relevance || (!topic && (row.helpful || (row.direct && sourceCounts.get(row.note.source.taskKey) === 1))));
  return candidates.sort((a, b) =>
    Math.sign(b.helpful - b.misses - b.adjustments) - Math.sign(a.helpful - a.misses - a.adjustments) ||
    b.relevance - a.relevance || b.direct - a.direct ||
    a.note.situation.localeCompare(b.note.situation) || a.note.id.localeCompare(b.note.id),
  ).slice(0, 3).map(row => row.note);
}

/** Render only lessons that fit, keeping the transmitted text and its pins together. */
export function assembleLessonExcerpt(snapshot: Snapshot, key: string, topic: string | undefined, tokenBudget: number, sourceIds?: string[], requiredKeys?: ReadonlySet<string>) {
  let text = "";
  const pins: NonNullable<CollaborationContext["memoryLessons"]> = [];
  for (const note of queryProjectLessons(snapshot, key, topic, sourceIds, requiredKeys)) {
    const { id, revision, source, situation, action, outcome, limitation, counterexample } = note;
    const section = '\n\n相关项目经验（仅供参考，可按 source.artifactId 和 source.hash 分页核对原始依据）：\n' +
      JSON.stringify({id, revision, source, situation, action, outcome, limitation, counterexample});
    if (estimateTokens(text + section) > tokenBudget) continue;
    text += section;
    pins.push({id, hash:note.hash, revision, sourceArtifactId:source.artifactId});
  }
  return {text, pins};
}

/** Live evidence may be read while a send is in flight. Historical feedback
 * requires a confirmed receipt by the time its candidate was submitted. */
export function runLessonPins(snapshot: Snapshot, context: CollaborationContext, deliveredBy?: string) {
  const original = context.memoryLessons ?? [];
  const run = context.runId && snapshot.collaboration?.runs[context.runId];
  const session = run && run.sessionId && snapshot.sessions[run.sessionId];
  if (!run || !session || run.key !== context.key || run.contextPackageId !== context.id) return original;
  const rt = session.runtime;
  if (rt?.projectId !== snapshot.project.id || rt.collaboration?.contextPackageId !== context.id ||
      rt.collaboration.runId !== run.id) return original;
  return original.concat(Object.values(rt.controlDeliveries ?? {}).flatMap(delivery => {
    const confirmed = delivery.status === 'sent' && (!deliveredBy ||
      !!delivery.sentAt && Date.parse(delivery.sentAt) <= Date.parse(deliveredBy));
    return confirmed || (!deliveredBy && delivery.status === 'sending') ? delivery.memoryLessons ?? [] : [];
  }));
}

/** Only an exact, still-effective lesson pin permits opening its accepted source.
 * Historical packets without a source pin retain their original read scope. */
export function pinnedLessonSource(snapshot: Snapshot, pins: CollaborationContext["memoryLessons"], artifactId: string) {
  if (!pins?.some(pin => pin.sourceArtifactId === artifactId)) return undefined;
  return projectMemoryNotes(snapshot).find(note =>
    note.status === "confirmed" && !note.stale && note.source.artifactId === artifactId &&
    pins.some(pin => pin.sourceArtifactId === artifactId && pin.id === note.id && pin.hash === note.hash && pin.revision === note.revision)
  )?.source;
}
