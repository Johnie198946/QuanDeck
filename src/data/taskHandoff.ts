import type { Snapshot } from "./types";
import type { CollaborationSubmission, CollaborationTask } from "./collaboration";
import { hashText, stableContent } from "./contentHash";
import { projectSpecArtifactStale, projectSpecPin, type ProjectSpecPin } from "./specLineage";

/** Content proposed by a person or an Agent. None of these fields grants authority. */
export interface HandoffContent {
  summary: string;
  completed: string[];
  decisions: string[];
  remaining: string[];
  nextSteps: string[];
}
/** An immutable receipt produced by the same transaction that registers a submission. */
export interface TaskHandoff {
  schema: 1;
  id: string;
  projectId: string;
  key: string;
  taskId: string;
  workItemId?: string;
  submissionId: string;
  artifactId: string;
  artifactHash: string;
  runId?: string;
  contextPackageId?: string;
  contextHash?: string;
  taskSpecId: string;
  specRevision: number;
  projectSpec?: ProjectSpecPin;
  sourcePins: { artifactId: string; key: string; hash: string; version: number }[];
  createdAt: string;
  sequence: number;
  actor: string;
  contentOrigin: "provided" | "derived";
  content: HandoffContent;
  contentHash: string;
  hash: string;
}
export interface TaskHandoffTransfer {
  id: string;
  projectId: string;
  sourceTaskKey: string;
  targetTaskKey: string;
  sourceHandoffId: string;
  sourceHandoffHash: string;
  sourceArtifactId: string;
  sourceArtifactHash: string;
  sourceReviewId: string;
  at: string;
  idempotencyKey: string;
  fingerprint: string;
}
export interface TaskHandoffView {
  record: TaskHandoff;
  origin: "recorded" | "legacy-derived";
  reviewStatus: "accepted" | "needs_changes" | "unreviewed";
  reviewId?: string;
  current: boolean;
  stale: boolean;
  owner: string;
  claimedBy?: string;
  successors: { key: string; title: string; owner: string; status: string; claimedBy?: string }[];
}
export interface TaskHandoffPin {
  id: string;
  key: string;
  submissionId: string;
  artifactId: string;
  artifactHash: string;
  contentHash: string;
  hash: string;
  origin: TaskHandoffView["origin"];
  reviewStatus: TaskHandoffView["reviewStatus"];
  reviewId?: string;
}
function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "HANDOFF_INVALID" });
}
const fields = ["summary", "completed", "decisions", "remaining", "nextSteps"] as const;
const cleanExcerpt = (value: string, max: number) =>
  value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Fail closed on extra identity/status fields; the model can submit content only. */
export function parseHandoffContent(value: unknown): HandoffContent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("交接内容必须使用固定结构");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key as (typeof fields)[number])))
    invalid("交接只允许总结、完成内容、决定、剩余事项与下一步；身份和验收状态由系统记录");
  if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 2000)
    invalid("交接总结需要 1–2000 字");
  const list = (key: (typeof fields)[number]): string[] => {
    const values = input[key];
    if (
      !Array.isArray(values) ||
      values.length > 30 ||
      values.some((item) => typeof item !== "string" || !item.trim() || item.length > 1500)
    )
      invalid("交接条目必须为至多 30 条、每条至多 1500 字的文字");
    return (values as string[]).map((item) => item.trim());
  };
  return {
    summary: (input.summary as string).trim(),
    completed: list("completed"),
    decisions: list("decisions"),
    remaining: list("remaining"),
    nextSteps: list("nextSteps"),
  };
}

/** Backend-only construction: all provenance comes from the validated canonical records. */
export function createTaskHandoff(
  snapshot: Snapshot,
  submission: CollaborationSubmission,
  proposedContent?: unknown,
  legacy = false,
): TaskHandoff {
  const c = snapshot.collaboration;
  const task = c?.tasks[submission.key];
  const artifact = c?.artifacts.find(
    (item) => item.id === submission.artifactId && item.key === submission.key,
  );
  const spec = c?.specs.find(
    (item) => item.key === submission.key && item.revision === submission.specRevision,
  );
  if (!c || !task || !artifact || !spec || artifact.hash !== hashText(artifact.body))
    invalid("交接的任务、要求版本或成果校验不匹配");
  const run = submission.runId ? c.runs[submission.runId] : undefined;
  const context = run
    ? c.contextPackages.find((item) => item.id === run.contextPackageId)
    : undefined;
  if (
    !legacy &&
    submission.runId &&
    (!run ||
      run.key !== task.key ||
      artifact.runId !== run.id ||
      !context ||
      context.key !== task.key ||
      context.runId !== run.id ||
      context.specRevision !== submission.specRevision ||
      hashText(context.prompt) !== context.hash)
  )
    invalid("交接未绑定有效的执行与固定上下文");
  const checkpoint = run
    ? [...c.checkpoints]
        .reverse()
        .find((item) => item.runId === run.id && item.key === task.key && item.at <= submission.at)
    : undefined;
  const content =
    proposedContent === undefined
      ? {
          summary: cleanExcerpt(artifact.body, 2000) || artifact.title,
          completed: [...(checkpoint?.completed ?? [])],
          decisions: [],
          remaining: [...submission.unresolved],
          nextSteps: [...submission.nextSteps],
        }
      : parseHandoffContent(proposedContent);
  // A supplied narrative cannot suppress blockers/next steps registered by the submission.
  for (const item of submission.unresolved)
    if (!content.remaining.includes(item)) content.remaining.push(item);
  for (const item of submission.nextSteps)
    if (!content.nextSteps.includes(item)) content.nextSteps.push(item);
  const sourcePins = artifact.sourceIds.map((artifactId) => {
    const source = c.artifacts.find((item) => item.id === artifactId);
    if (!source || source.hash !== hashText(source.body))
      invalid("交接引用的来源不存在或内容已变化");
    return { artifactId, key: source.key, hash: source.hash, version: source.version };
  });
  const facts = {
    schema: 1 as const,
    id: (legacy ? "legacy-handoff:" : "handoff:") + submission.id,
    projectId: snapshot.project.id,
    key: task.key,
    taskId: task.taskId,
    workItemId: task.workItemId,
    submissionId: submission.id,
    artifactId: artifact.id,
    artifactHash: artifact.hash,
    runId: submission.runId,
    contextPackageId: context?.id,
    contextHash: context?.hash,
    taskSpecId: spec.id,
    specRevision: submission.specRevision,
    projectSpec: context?.projectSpec ?? (!legacy && !run ? projectSpecPin(snapshot) : undefined),
    sourcePins,
    createdAt: submission.at,
    sequence:
      c.events.find((item) => item.type === "result_submitted" && item.detail === submission.id)
        ?.sequence ?? (legacy ? 0 : c.sequence + 1),
    actor: submission.actor,
    contentOrigin: proposedContent === undefined ? ("derived" as const) : ("provided" as const),
    content,
    contentHash: hashText(stableContent(content)),
  };
  return { ...facts, hash: hashText(stableContent(facts)) };
}

function fresh(snapshot: Snapshot, artifactId: string, path = new Set<string>()): boolean {
  const c = snapshot.collaboration,
    artifact = c?.artifacts.find((item) => item.id === artifactId);
  if (
    !c ||
    !artifact ||
    path.has(artifactId) ||
    ["stale", "unknown"].includes(c.freshness[artifactId]) ||
    (artifact.expiresAt && Date.parse(artifact.expiresAt) <= Date.now()) ||
    artifact.hash !== hashText(artifact.body) ||
    projectSpecArtifactStale(snapshot, artifactId)
  )
    return false;
  const next = new Set(path).add(artifactId);
  return artifact.sourceIds.every((source) => fresh(snapshot, source, next));
}
const claimedBy = (snapshot: Snapshot, task: CollaborationTask) => {
  const run = task.activeRunId ? snapshot.collaboration?.runs[task.activeRunId] : undefined;
  return run &&
    !["succeeded", "failed", "cancelled", "lost"].includes(run.status) &&
    run.claimEpoch === task.claimEpoch &&
    run.specRevision === task.specRevision
    ? run.executor
    : undefined;
};

/** Read-only ledger projection. Old data is visibly derived, never rewritten as historical fact. */
export function deriveTaskHandoffs(
  snapshot: Snapshot,
  taskKeys?: readonly string[],
): TaskHandoffView[] {
  const c = snapshot.collaboration;
  if (!c) return [];
  const keys = taskKeys ? new Set(taskKeys) : undefined;
  return c.submissions
    .filter((item) => !keys || keys.has(item.key))
    .flatMap((submission) => {
      const task = c.tasks[submission.key];
      if (!task) return [];
      const stored = c.handoffs?.find((item) => item.submissionId === submission.id);
      let record: TaskHandoff;
      try {
        record = stored ?? createTaskHandoff(snapshot, submission, undefined, true);
      } catch {
        return [];
      }
      const { hash, ...facts } = record;
      const artifact = c.artifacts.find((item) => item.id === submission.artifactId);
      const integrity =
        record.schema === 1 &&
        record.projectId === snapshot.project.id &&
        record.key === task.key &&
        record.taskId === task.taskId &&
        record.workItemId === task.workItemId &&
        record.submissionId === submission.id &&
        record.artifactId === submission.artifactId &&
        record.artifactHash === artifact?.hash &&
        record.runId === submission.runId &&
        record.specRevision === submission.specRevision &&
        record.createdAt === submission.at &&
        record.contentHash === hashText(stableContent(record.content)) &&
        hash === hashText(stableContent(facts));
      const review = [...c.reviews].reverse().find((item) => item.submissionId === submission.id);
      return [
        {
          record,
          origin: stored ? ("recorded" as const) : ("legacy-derived" as const),
          reviewStatus: review?.verdict ?? ("unreviewed" as const),
          reviewId: review?.id,
          current:
            task.latestSubmissionId === submission.id ||
            task.acceptedArtifactId === record.artifactId,
          stale:
            !integrity ||
            !!task.requiresRevalidation ||
            task.specRevision !== record.specRevision ||
            !fresh(snapshot, record.artifactId),
          owner: task.owner,
          claimedBy: claimedBy(snapshot, task),
          successors: Object.values(c.tasks)
            .filter((item) => !item.archived && item.dependencies.includes(task.key))
            .map((item) => ({
              key: item.key,
              title: item.title,
              owner: item.owner,
              status: item.status,
              claimedBy: claimedBy(snapshot, item),
            })),
        },
      ];
    })
    .map((item) => structuredClone(item));
}
export function getTaskHandoff(
  snapshot: Snapshot,
  key: string,
  artifactId?: string,
): TaskHandoffView | undefined {
  const c = snapshot.collaboration,
    task = c?.tasks[key];
  const selected =
    artifactId ??
    task?.acceptedArtifactId ??
    c?.submissions.find((item) => item.id === task?.latestSubmissionId)?.artifactId;
  return deriveTaskHandoffs(snapshot, [key]).find((item) => item.record.artifactId === selected);
}
export function pinTaskHandoff(view: TaskHandoffView): TaskHandoffPin {
  const record = view.record;
  return {
    id: record.id,
    key: record.key,
    submissionId: record.submissionId,
    artifactId: record.artifactId,
    artifactHash: record.artifactHash,
    contentHash: record.contentHash,
    hash: record.hash,
    origin: view.origin,
    reviewStatus: view.reviewStatus,
    reviewId: view.reviewId,
  };
}

/** Stable sections used by both the ledger and blackboard; never model-authored Markdown. */
export function renderTaskHandoff(view: TaskHandoffView): string {
  const r = view.record,
    content = r.content;
  const list = (items: string[]) =>
    items.length ? items.map((item) => "- " + item).join("\n") : "无记录";
  const verdict = { accepted: "已验收", needs_changes: "待修改", unreviewed: "候选，尚未验收" }[
    view.reviewStatus
  ];
  return [
    `### 任务总结与交接 · ${r.key}`,
    `交接记录：${r.id} · 格式 v${r.schema} · ${view.origin === "legacy-derived" ? "历史记录派生（未补写历史）" : r.contentOrigin === "derived" ? "后端根据交付生成" : "提供内容经后端登记"}`,
    `交付状态：${verdict}${view.stale ? " · 来源失效，需复核" : ""} · ${view.current ? "当前交付" : "历史交付"}`,
    `负责人：${view.owner} · 当前接手：${view.claimedBy ?? "无活跃执行"}`,
    `#### 总结\n${content.summary}`,
    `#### 已做内容（交付者记录，验收状态见上）\n${list(content.completed)}`,
    `#### 工作决定（不替代已确认的项目约束）\n${list(content.decisions)}`,
    `#### 剩余事项\n${list(content.remaining)}`,
    `#### 下一步\n${list(content.nextSteps)}`,
    `#### 来源与版本\n提交：${r.submissionId}\n成果：${r.artifactId} · SHA-256 ${r.artifactHash}\n执行：${r.runId ?? "人工登记"}\n上下文：${r.contextPackageId ?? "无 Agent 上下文"}\n任务要求：${r.taskSpecId} · v${r.specRevision}\n项目规范：${r.projectSpec ? r.projectSpec.versionId + " · " + r.projectSpec.hash : "未固定已发布规范"}\n依赖来源：${r.sourcePins.map((item) => item.artifactId + " · " + item.hash).join("；") || "无"}\n交接内容 SHA-256：${r.contentHash}`,
    `#### 后续接手\n${view.successors.length ? view.successors.map((item) => `- ${item.title}（${item.key}）· ${item.status} · ${item.claimedBy ?? "负责人：" + item.owner}`).join("\n") : "尚无后继任务"}`,
  ].join("\n\n");
}
