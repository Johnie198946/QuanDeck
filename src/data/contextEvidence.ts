import { goalDependencySource } from "./goalDelivery";
import { hashText, estimateTokens } from "./collaboration";
import { pinnedLessonSource, runLessonPins } from "./projectMemoryNotes";
import { currentTaskRework } from "./taskHandoff";
import type { Snapshot } from "./types";

export interface ContextEvidenceRequest {
  projectId: string;
  contextPackageId: string;
  artifactId: string;
  hash: string;
  /** UTF-16 offset, identical to context sources.endOffset. */
  offset?: number;
  limit?: number;
}
export interface EvidenceReaderBinding {
  /** Taken from the authenticated run credential, never the request body. */
  runId: string;
  claimEpoch: number;
}
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Pure bounded query. The gateway authenticates/revokes its scoped run credential first. */
export function readContextEvidence(snapshot: Snapshot, request: ContextEvidenceRequest, binding: EvidenceReaderBinding) {
  const c = snapshot.collaboration, run = c?.runs[binding.runId], task = run && c?.tasks[run.key];
  if (request.projectId !== snapshot.project.id || !run || !task ||
      task.activeRunId !== run.id || task.claimEpoch !== binding.claimEpoch ||
      run.claimEpoch !== binding.claimEpoch || run.specRevision !== task.specRevision ||
      !["queued", "running", "waiting_input", "waiting_permission"].includes(run.status) ||
      Date.parse(run.leaseExpiresAt) <= Date.now())
    fail("READ_SCOPE_REVOKED", "证据读取凭据已失效或不属于当前执行");
  const context = c!.contextPackages.find((x) => x.id === request.contextPackageId);
  if (!context || context.id !== run.contextPackageId || context.key !== run.key ||
      context.claimEpoch !== run.claimEpoch || context.specRevision !== run.specRevision)
    fail("CONTEXT_MISMATCH", "只能读取本次执行固定的上下文");
  const source = context.sources.find((x) => x.id === request.artifactId);
  const returned = context.reworkEvidence && context.reworkReview?.artifactId === request.artifactId
    ? context.reworkReview : undefined;
  const artifact = c!.artifacts.find((x) => x.id === request.artifactId);
  const pinnedHash = returned?.artifactHash ?? source?.hash ?? pinnedLessonSource(snapshot, runLessonPins(snapshot, context), request.artifactId)?.hash;
  if (!pinnedHash || !artifact || request.hash !== pinnedHash || artifact.hash !== pinnedHash ||
      hashText(artifact.body) !== pinnedHash)
    fail("SOURCE_NOT_IN_CONTEXT", "资料版本或哈希与固定上下文不一致");
  const fresh = (id: string, path = new Set<string>()): boolean => {
    const a = c!.artifacts.find((x) => x.id === id);
    if (!a || path.has(id) || ["stale", "unknown"].includes(c!.freshness[id]) ||
        (a.expiresAt && Date.parse(a.expiresAt) <= Date.now())) return false;
    return a.sourceIds.every((child) => fresh(child, new Set([...path, id])));
  };
  const owner = c!.tasks[artifact.key];
  const candidate = source?.freshness === "candidate" && (run.purpose === "review" || goalDependencySource(snapshot,run.key,artifact.key,false)?.id===artifact.id);
  const submission = c!.submissions.find((s) => s.id === owner?.latestSubmissionId);
  if (returned) {
    const target = context.discussionTarget;
    const current = currentTaskRework(snapshot, target?.key ?? context.key);
    if (current?.reviewId !== returned.reviewId || current.artifactId !== artifact.id ||
        current.taskKey !== artifact.key || (target && snapshot.ideaPlans?.[target.planId]?.draftVersion !== target.draftVersion))
      fail("SOURCE_STALE", "该交付已被新版替代或返工范围已变化");
  } else if (!owner || !fresh(artifact.id) || (candidate
    ? (run.purpose === "review" ? owner.status !== "in_review" : !["in_review","done"].includes(owner.status)) || submission?.artifactId !== artifact.id || submission.specRevision !== owner.specRevision
    : owner.acceptedArtifactId !== artifact.id || owner.requiresRevalidation))
    fail("SOURCE_STALE", "资料已变更、失效或撤回，请重新装配上下文");
  const offset = request.offset ?? 0, limit = request.limit ?? 2000;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > artifact.body.length ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 4000)
    fail("SCHEMA_INVALID", "分页范围无效；每页最多 4000 字符");
  const endOffset = Math.min(offset + limit, artifact.body.length);
  return {
    projectId: snapshot.project.id, contextPackageId: context.id, artifactId: artifact.id,
    taskKey: artifact.key, version: artifact.version, hash: artifact.hash,
    sourceIds: [...artifact.sourceIds], sourceRefs: structuredClone(artifact.sourceRefs ?? []),
    runId: artifact.runId, observedAt: artifact.observedAt, expiresAt: artifact.expiresAt,
    freshness: returned ? "needs_changes" : candidate ? "candidate" : "current", offset, endOffset,
    totalChars: artifact.body.length, text: artifact.body.slice(offset, endOffset),
    nextOffset: endOffset < artifact.body.length ? endOffset : null,
  };
}


export interface ContextEvidenceRead {
  id: string;
  projectId: string;
  runId: string;
  contextPackageId: string;
  artifactId: string;
  hash: string;
  offset: number;
  length: number;
  fragmentHash: string;
  at: string;
  estimatedTokens: number;
}

/** Must run inside the repository transaction before a page is returned to the Agent. */
export function readAndRecordContextEvidence(snapshot: Snapshot, request: ContextEvidenceRequest, binding: EvidenceReaderBinding) {
  const page = readContextEvidence(snapshot, request, binding);
  const context = snapshot.collaboration!.contextPackages.find(item => item.id === request.contextPackageId)!;
  const estimatedTokens = estimateTokens(JSON.stringify(page));
  (snapshot.contextEvidenceReads ??= []).push({
    id: `evidence-read-${crypto.randomUUID()}`, projectId: snapshot.project.id, runId: binding.runId,
    contextPackageId: context.id, artifactId: page.artifactId, hash: page.hash,
    offset: page.offset, length: page.text.length, fragmentHash: hashText(page.text),
    at: new Date().toISOString(), estimatedTokens,
  });
  return page;
}
