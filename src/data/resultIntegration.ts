import type { CommandResult, Snapshot } from "./types";
import { hashText, isCollaborationArtifactFresh } from "./collaboration";
import { buildExecutionIndex } from "./executionProvenance";

export interface IntegrationSection {
  id: string;
  title: string;
  body: string;
  sourceIds: string[];
  schedule?: { date: string; start?: string; end?: string; resource?: string };
  facts?: { key: string; value: string }[];
}
export interface IntegrationSourcePin {
  artifactId: string;
  artifactHash: string;
  taskKey: string;
  taskId: string;
  taskTitle: string;
  title: string;
  specRevision: number;
  reviewId: string;
  conditionsHash: string;
  runId?: string;
  runtimeRunId?: string;
  sessionId?: string;
  sourceSessionId?: string;
  connectionId?: string;
  tool?: string;
}
export interface IntegrationSource extends IntegrationSourcePin {
  body: string;
  eligible: boolean;
  reasons: string[];
}
export interface IntegrationContent {
  title: string;
  sourcePins: IntegrationSourcePin[];
  sections: IntegrationSection[];
}
export interface IntegrationRevision extends IntegrationContent {
  id: string;
  draftId: string;
  revision: number;
  at: string;
  baseVersionId?: string;
  reason: string;
}
export interface IntegrationVersion extends IntegrationContent {
  purpose?: "project_spec";
  id: string;
  bundleId: string;
  version: number;
  parentVersionId?: string;
  revisionId: string;
  at: string;
  reviewNote: string;
  hash: string;
}
export interface IntegrationBundle {
  purpose?: "project_spec";
  id: string;
  title: string;
  version: number;
  publishedVersionId?: string;
  createdAt: string;
}
export interface IntegrationDraft {
  id: string;
  bundleId: string;
  revision: number;
  revisionId: string;
  baseVersionId?: string;
  status: "draft" | "published";
  publishedVersionId?: string;
}
export interface IntegrationEvent {
  id: string;
  sequence: number;
  at: string;
  type: string;
  draftId: string;
  bundleId: string;
  detail: string;
}
export interface IntegrationState {
  reviews?: import("./integrationReview").IntegrationAIReview[];
  reviewJobs?: Record<string, import("./integrationReview").IntegrationAIJob>;
  schema: 1;
  sequence: number;
  bundles: Record<string, IntegrationBundle>;
  drafts: Record<string, IntegrationDraft>;
  revisions: IntegrationRevision[];
  versions: IntegrationVersion[];
  events: IntegrationEvent[];
  receipts: Record<string, { fingerprint: string; result: IntegrationResult }>;
}
export interface IntegrationIssue {
  id: string;
  code: string;
  severity: "blocking" | "warning";
  message: string;
  sectionIds: string[];
  sourceIds: string[];
}
export interface IntegrationDiff {
  added: string[];
  removed: string[];
  changed: string[];
  reordered: boolean;
  titleChanged: boolean;
}
export type IntegrationChoice = "ours" | "theirs" | IntegrationSection | null;
export interface IntegrationMergeConflict {
  key: string;
  kind: "section" | "title" | "order" | "sources";
  label: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}
export interface IntegrationInspection {
  draft: IntegrationDraft;
  revision: IntegrationRevision;
  bundle: IntegrationBundle;
  currentVersion?: IntegrationVersion;
  issues: IntegrationIssue[];
  canPublish: boolean;
  coveredSources: number;
  totalSources: number;
  diff: IntegrationDiff;
  mergeConflicts: IntegrationMergeConflict[];
  semanticReviewRequired: true;
}
export interface IntegrationCommand {
  projectId: string;
  idempotencyKey: string;
  type: "create" | "save" | "rebase" | "publish";
  draftId?: string;
  expectedRevision?: number;
  payload: {
    purpose?: "project_spec";
    bundleId?: string;
    baseVersionId?: string;
    title?: string;
    sourceIds?: string[];
    sections?: IntegrationSection[];
    /** Source removals are deliberate and audited, never implied by a missing section. */
    excludeReasons?: Record<string, string>;
    /** rebase conflict keys are section:<id>, title, order, sources. */
    choices?: Record<string, IntegrationChoice>;
    expectedBundleVersion?: number;
    reviewed?: boolean;
    reviewNote?: string;
  };
}
export interface IntegrationResult extends CommandResult {
  code?: string;
  resourceId?: string;
  draftId?: string;
  bundleId?: string;
  revision?: number;
  versionId?: string;
  replayed?: boolean;
  issues?: IntegrationIssue[];
  conflicts?: IntegrationMergeConflict[];
}
type WithIntegration = Snapshot & { integration?: IntegrationState };

const uid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
function failure(code: string, message: string, extra: Partial<IntegrationResult> = {}): never {
  throw Object.assign(new Error(message), { code, ...extra });
}
function object(
  value: unknown,
  fields: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    failure("INVALID_SCHEMA", `${label}字段无效`);
}
function text(value: unknown, label: string, max = 20000, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()))
    failure("INVALID_SCHEMA", `${label}不能为空或超出长度限制`);
  return value.trim();
}
function ids(value: unknown, label: string, max = 100): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((v) => typeof v !== "string" || !v || v.length > 200) ||
    new Set(value).size !== value.length
  )
    failure("INVALID_SCHEMA", `${label}需要不重复的有效 ID`);
  return [...value];
}
export function ensureIntegration(snapshot: Snapshot): IntegrationState {
  const s = snapshot as WithIntegration;
  return (s.integration ??= {
    schema: 1,
    sequence: 0,
    bundles: {},
    drafts: {},
    revisions: [],
    versions: [],
    events: [],
    receipts: {},
  });
}
function conditionsHash(snapshot: Snapshot, taskKey: string) {
  const c = snapshot.collaboration,
    task = c?.tasks[taskKey];
  const latest = new Map<string, NonNullable<typeof c>["decisions"][number]>();
  for (const decision of c?.decisions ?? [])
    if (!decision.taskKey || decision.taskKey === taskKey || decision.taskKey === task?.taskId) {
      if ((latest.get(decision.decisionId)?.revision ?? 0) < decision.revision)
        latest.set(decision.decisionId, decision);
    }
  const decisions = [...latest.values()]
    .filter((d) => d.authority === "confirmed")
    .sort((a, b) => a.id.localeCompare(b.id));
  const spec = c?.specs.find((s) => s.key === taskKey && s.revision === task?.specRevision);
  return hashText(
    stable({
      decisions,
      spec,
      timeZone: snapshot.project.timeZone,
      dependencies: task?.dependencies.map((key) => ({
        key,
        artifactId: c?.tasks[key]?.acceptedArtifactId,
      })),
    }),
  );
}
export function listIntegrationSources(snapshot: Snapshot): IntegrationSource[] {
  const c = snapshot.collaboration;
  if (!c) return [];
  const executions = buildExecutionIndex(snapshot);
  return c.artifacts.map((artifact) => {
    const task = c.tasks[artifact.key];
    const submissions = c.submissions.filter(
      (s) => s.artifactId === artifact.id && s.key === artifact.key,
    );
    const review = c.reviews
      .filter((r) => r.verdict === "accepted" && submissions.some((s) => s.id === r.submissionId))
      .at(-1);
    const submission = submissions.find((s) => s.id === review?.submissionId);
    const execution = artifact.runId
      ? (executions.get(artifact.key) ?? []).find((e) => e.runId === artifact.runId)
      : undefined;
    const reasons = [
      ...(!review || !submission ? ["尚未人工验收"] : []),
      ...(!task ||
      task.status !== "done" ||
      task.archived ||
      task.legacyCompletion ||
      task.requiresRevalidation
        ? ["任务尚未完成有效验收"]
        : []),
      ...(task?.acceptedArtifactId !== artifact.id ? ["已被其他成果版本替代"] : []),
      ...(submission && submission.specRevision !== task?.specRevision ? ["任务要求已变化"] : []),
      ...(!isCollaborationArtifactFresh(snapshot, artifact.id) ? ["来源已失效或过期"] : []),
    ];
    return {
      artifactId: artifact.id,
      artifactHash: artifact.hash,
      title: artifact.title,
      body: artifact.body,
      taskKey: artifact.key,
      taskId: task?.taskId ?? artifact.key.split("::")[0],
      taskTitle: task?.title ?? artifact.title,
      specRevision: submission?.specRevision ?? 0,
      reviewId: review?.id ?? "",
      conditionsHash: conditionsHash(snapshot, artifact.key),
      ...(artifact.runId ? { runId: artifact.runId } : {}),
      ...(execution
        ? {
            sessionId: execution.sessionId,
            sourceSessionId: execution.sourceSessionId,
            connectionId: execution.connectionId,
            tool: execution.tool,
            runtimeRunId: execution.runtimeRunId,
          }
        : {}),
      eligible: reasons.length === 0,
      reasons,
    };
  });
}
const pin = ({
  body: _body,
  eligible: _eligible,
  reasons: _reasons,
  ...source
}: IntegrationSource): IntegrationSourcePin => source;
function sourcePins(snapshot: Snapshot, sourceIds: string[]) {
  const candidates = new Map(listIntegrationSources(snapshot).map((s) => [s.artifactId, s]));
  return sourceIds.map((id) => {
    const source = candidates.get(id);
    if (!source?.eligible)
      failure(
        "SOURCE_UNAVAILABLE",
        source ? `${source.title}：${source.reasons.join("；")}` : "来源不存在或不属于本项目",
      );
    return pin(source);
  });
}
function sections(value: unknown, sourceIds: string[]): IntegrationSection[] {
  if (!Array.isArray(value) || !value.length || value.length > 200)
    failure("INVALID_SCHEMA", "完整成果需要 1 至 200 个章节");
  const all = new Set<string>();
  let size = 0;
  return value.map((raw) => {
    object(raw, ["id", "title", "body", "sourceIds", "schedule", "facts"], "章节");
    const id = text(raw.id, "章节 ID", 200);
    if (all.has(id)) failure("INVALID_SCHEMA", "章节 ID 不能重复");
    all.add(id);
    const title = text(raw.title, "章节标题", 300),
      body = text(raw.body, "章节正文", 100000, true);
    size += body.length;
    if (size > 500000) failure("INVALID_SCHEMA", "成果正文超过总长度限制");
    const references = ids(raw.sourceIds, "章节来源");
    if (references.some((id) => !sourceIds.includes(id)))
      failure("INVALID_SOURCE", "章节引用了本次未选择的来源");
    const result: IntegrationSection = { id, title, body, sourceIds: references };
    if (raw.schedule !== undefined) {
      object(raw.schedule, ["date", "start", "end", "resource"], "时间安排");
      const date = text(raw.schedule.date, "日期", 10);
      const parsed = Date.parse(date + "T00:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(parsed) ||
        new Date(parsed).toISOString().slice(0, 10) !== date
      )
        failure("INVALID_SCHEMA", "日期格式或日期值无效");
      const schedule: NonNullable<IntegrationSection["schedule"]> = { date };
      if (raw.schedule.start !== undefined || raw.schedule.end !== undefined) {
        const start = text(raw.schedule.start, "开始时间", 5),
          end = text(raw.schedule.end, "结束时间", 5);
        if (![start, end].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || end <= start)
          failure("INVALID_SCHEMA", "起止时间需成对且结束晚于开始；跨日安排请分成两段");
        Object.assign(schedule, { start, end });
      }
      if (raw.schedule.resource !== undefined)
        schedule.resource = text(raw.schedule.resource, "时间占用对象", 100);
      result.schedule = schedule;
    }
    if (raw.facts !== undefined) {
      if (!Array.isArray(raw.facts) || raw.facts.length > 100)
        failure("INVALID_SCHEMA", "事实字段格式无效");
      const keys = new Set<string>();
      result.facts = raw.facts.map((f) => {
        object(f, ["key", "value"], "事实");
        const key = text(f.key, "事实名称", 200),
          value = text(f.value, "事实值", 2000);
        if (keys.has(norm(key))) failure("INVALID_SCHEMA", "同一章节不能重复声明相同事实");
        keys.add(norm(key));
        return { key, value };
      });
    }
    return result;
  });
}
export function integrationDiff(
  base: IntegrationContent | undefined,
  changed: IntegrationContent,
): IntegrationDiff {
  const before = new Map((base?.sections ?? []).map((s) => [s.id, s])),
    after = new Map(changed.sections.map((s) => [s.id, s]));
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter(
      (id) => before.has(id) && !equal(before.get(id), after.get(id)),
    ),
    reordered:
      !!base &&
      !equal(
        base.sections.map((s) => s.id).filter((id) => after.has(id)),
        changed.sections.map((s) => s.id).filter((id) => before.has(id)),
      ),
    titleChanged: !!base && base.title !== changed.title,
  };
}
interface MergePreview {
  content: IntegrationContent;
  conflicts: IntegrationMergeConflict[];
}
function mergeContent(
  base: IntegrationContent | undefined,
  ours: IntegrationContent,
  theirs: IntegrationContent | undefined,
  choices: Record<string, IntegrationChoice> = {},
): MergePreview {
  const conflicts: IntegrationMergeConflict[] = [];
  const choose = <T>(
    key: string,
    kind: IntegrationMergeConflict["kind"],
    label: string,
    b: T,
    o: T,
    t: T,
  ): T => {
    if (equal(o, t)) return o;
    if (equal(o, b)) return t;
    if (equal(t, b)) return o;
    const resolution = own(choices, key);
    if (resolution === "ours") return o;
    if (resolution === "theirs") return t;
    if (
      kind === "section" &&
      (resolution === null || (typeof resolution === "object" && resolution !== undefined))
    )
      return resolution as T;
    conflicts.push({ key, kind, label, base: b, ours: o, theirs: t });
    return o;
  };
  const b = new Map((base?.sections ?? []).map((s) => [s.id, s])),
    o = new Map(ours.sections.map((s) => [s.id, s])),
    t = new Map((theirs?.sections ?? []).map((s) => [s.id, s]));
  const merged = new Map<string, IntegrationSection>();
  for (const id of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
    const s = choose(
      `section:${id}`,
      "section",
      o.get(id)?.title ?? t.get(id)?.title ?? b.get(id)!.title,
      b.get(id) ?? null,
      o.get(id) ?? null,
      t.get(id) ?? null,
    );
    if (s) {
      if (s.id !== id) failure("INVALID_SCHEMA", "手工合并不得改变冲突章节 ID");
      merged.set(id, s);
    }
  }
  // Order is its own merge field; an independent reorder must not be erased by a body edit.
  const survivingBase = (base?.sections ?? []).map((s) => s.id).filter((id) => merged.has(id));
  const relative = (items: IntegrationSection[]) =>
    items.map((s) => s.id).filter((id) => survivingBase.includes(id));
  const order = choose(
    "order",
    "order",
    "章节顺序",
    survivingBase,
    relative(ours.sections),
    relative(theirs?.sections ?? []),
  );
  const ordered = [...order];
  // New blocks retain placement relative to their neighbouring blocks, with current published
  // additions before draft-only additions at the same anchor. No new block is discarded.
  for (const items of [theirs?.sections ?? [], ours.sections])
    for (let i = 0; i < items.length; i++) {
      const id = items[i].id;
      if (!merged.has(id) || ordered.includes(id)) continue;
      const next = items.slice(i + 1).find((s) => ordered.includes(s.id));
      if (next) ordered.splice(ordered.indexOf(next.id), 0, id);
      else ordered.push(id);
    }
  const sources = new Map<string, IntegrationSourcePin>();
  const bp = new Map((base?.sourcePins ?? []).map((s) => [s.artifactId, s])),
    op = new Map(ours.sourcePins.map((s) => [s.artifactId, s])),
    tp = new Map((theirs?.sourcePins ?? []).map((s) => [s.artifactId, s]));
  let sourceConflict = false;
  for (const id of new Set([...bp.keys(), ...op.keys(), ...tp.keys()])) {
    const before = bp.get(id) ?? null,
      left = op.get(id) ?? null,
      right = tp.get(id) ?? null;
    let value =
      equal(left, right) || equal(right, before) ? left : equal(left, before) ? right : undefined;
    if (value === undefined) {
      sourceConflict = true;
      value = left;
    }
    if (value) sources.set(id, value);
  }
  let sourcePins = [...sources.values()];
  if (sourceConflict)
    sourcePins = choose(
      "sources",
      "sources",
      "来源绑定",
      base?.sourcePins ?? [],
      ours.sourcePins,
      theirs?.sourcePins ?? [],
    );
  return {
    content: {
      title: choose(
        "title",
        "title",
        "成果标题",
        base?.title ?? "",
        ours.title,
        theirs?.title ?? "",
      ),
      sections: ordered.map((id) => merged.get(id)!),
      sourcePins,
    },
    conflicts,
  };
}
function inspectContent(snapshot: Snapshot, content: IntegrationContent): IntegrationIssue[] {
  const issues: IntegrationIssue[] = [],
    live = new Map(listIntegrationSources(snapshot).map((s) => [s.artifactId, s]));
  const add = (
    code: string,
    message: string,
    sectionIds: string[] = [],
    sourceIds: string[] = [],
    severity: IntegrationIssue["severity"] = "blocking",
  ) =>
    issues.push({
      id: `${code}:${hashText(stable({ sectionIds, sourceIds, message })).slice(0, 16)}`,
      code,
      severity,
      message,
      sectionIds,
      sourceIds,
    });
  for (const p of content.sourcePins) {
    const source = live.get(p.artifactId);
    if (!source?.eligible || !equal(pin(source), p))
      add(
        "STALE_SOURCE",
        `${p.title}：来源、要求或确认条件已变化，请更新来源基线`,
        [],
        [p.artifactId],
      );
    if (!content.sections.some((s) => s.sourceIds.includes(p.artifactId)))
      add(
        "UNCOVERED_SOURCE",
        `${p.title}：没有纳入章节；请引用，或明确排除并记录理由`,
        [],
        [p.artifactId],
      );
  }
  if (!content.sourcePins.length) add("NO_SOURCE", "至少选择一份已验收来源");
  const facts = new Map<string, { value: string; section: IntegrationSection }[]>();
  for (const section of content.sections) {
    for (const sourceId of section.sourceIds)
      if (!content.sourcePins.some((p) => p.artifactId === sourceId))
        add("MISSING_SOURCE", `${section.title}引用了未绑定来源`, [section.id], [sourceId]);
    if (!section.body.trim()) add("EMPTY_SECTION", `${section.title}尚无正文`, [section.id]);
    if (!section.sourceIds.length)
      add("MANUAL_SECTION", `${section.title}为人工补充，请核对内容`, [section.id], [], "warning");
    if (section.schedule?.start && !section.schedule.resource)
      add(
        "UNSCOPED_TIME",
        `${section.title}未指定时间占用对象，无法判断与其他安排是否冲突`,
        [section.id],
        [],
        "warning",
      );
    for (const fact of section.facts ?? []) {
      const group = facts.get(norm(fact.key)) ?? [];
      group.push({ value: fact.value, section });
      facts.set(norm(fact.key), group);
    }
  }
  for (const [key, entries] of facts)
    if (new Set(entries.map((e) => norm(e.value))).size > 1)
      add(
        "FACT_CONFLICT",
        `“${key}”存在不一致的值`,
        entries.map((e) => e.section.id),
        [...new Set(entries.flatMap((e) => e.section.sourceIds))],
      );
  for (let i = 0; i < content.sections.length; i++)
    for (let j = i + 1; j < content.sections.length; j++) {
      const a = content.sections[i],
        b = content.sections[j],
        x = a.schedule,
        y = b.schedule;
      if (
        x?.start &&
        x.end &&
        y?.start &&
        y.end &&
        x.resource &&
        y.resource &&
        x.date === y.date &&
        norm(x.resource) === norm(y.resource) &&
        x.start < y.end &&
        y.start < x.end
      )
        add(
          "TIME_OVERLAP",
          `${a.title}与${b.title}占用同一时段`,
          [a.id, b.id],
          [...new Set([...a.sourceIds, ...b.sourceIds])],
        );
    }
  add(
    "SEMANTIC_REVIEW",
    "结构校验不替代语义复核：请检查跨任务约束、交通衔接、预算和遗漏",
    [],
    [],
    "warning",
  );
  return issues;
}
export function inspectIntegration(snapshot: Snapshot, draftId: string): IntegrationInspection {
  const s = (snapshot as WithIntegration).integration,
    draft = s && own(s.drafts, draftId);
  if (!s || !draft) failure("NOT_FOUND", "整合草案不存在");
  const bundle = own(s.bundles, draft.bundleId)!;
  const revision = s.revisions.find((r) => r.id === draft.revisionId)!;
  const currentVersion = s.versions.find((v) => v.id === bundle.publishedVersionId);
  const base = s.versions.find((v) => v.id === draft.baseVersionId);
  const issues = inspectContent(snapshot, revision),
    preview = mergeContent(base, revision, currentVersion);
  if (draft.baseVersionId !== bundle.publishedVersionId)
    issues.push({
      id: "STALE_BASE",
      code: "STALE_BASE",
      severity: "blocking",
      message: "已有新发布版本，请先重基线；不会覆盖已发布成果",
      sectionIds: [],
      sourceIds: [],
    });
  return {
    draft,
    revision,
    bundle,
    currentVersion,
    issues,
    canPublish: draft.status === "draft" && issues.every((i) => i.severity !== "blocking"),
    coveredSources: revision.sourcePins.filter((p) =>
      revision.sections.some((s) => s.sourceIds.includes(p.artifactId)),
    ).length,
    totalSources: revision.sourcePins.length,
    diff: integrationDiff(base, revision),
    mergeConflicts: preview.conflicts,
    semanticReviewRequired: true,
  };
}
export function inspectIntegrationVersion(
  snapshot: Snapshot,
  versionId: string,
): { version: IntegrationVersion; issues: IntegrationIssue[] } | undefined {
  const version = (snapshot as WithIntegration).integration?.versions.find(
    (v) => v.id === versionId,
  );
  return version ? { version, issues: inspectContent(snapshot, version) } : undefined;
}
function appendRevision(
  state: IntegrationState,
  draft: IntegrationDraft,
  content: IntegrationContent,
  reason: string,
) {
  const revision: IntegrationRevision = {
    ...structuredClone(content),
    id: uid("integration-revision"),
    draftId: draft.id,
    revision: draft.revision + 1,
    at: now(),
    baseVersionId: draft.baseVersionId,
    reason,
  };
  state.revisions.push(revision);
  draft.revision = revision.revision;
  draft.revisionId = revision.id;
  return revision;
}
function recordEvent(
  state: IntegrationState,
  draft: IntegrationDraft,
  type: string,
  detail: string,
) {
  state.events.push({
    id: uid("integration-event"),
    sequence: ++state.sequence,
    at: now(),
    type,
    draftId: draft.id,
    bundleId: draft.bundleId,
    detail,
  });
}
export function applyIntegration(
  snapshot: Snapshot,
  command: IntegrationCommand,
  actor: "human" | "agent" = "human",
): IntegrationResult {
  let fingerprint: string;
  try {
    object(
      command,
      ["projectId", "idempotencyKey", "type", "draftId", "expectedRevision", "payload"],
      "整合命令",
    );
    if (actor !== "human") failure("HUMAN_REQUIRED", "整合变更与发布必须由用户确认");
    if (command.projectId !== snapshot.project.id)
      failure("PROJECT_MISMATCH", "整合操作属于其他项目");
    text(command.idempotencyKey, "幂等 ID", 200);
    fingerprint = hashText(stable(command));
    const previous = (snapshot as WithIntegration).integration?.receipts;
    const receipt = previous && own(previous, command.idempotencyKey);
    if (receipt)
      return receipt.fingerprint === fingerprint
        ? { ...structuredClone(receipt.result), replayed: true }
        : { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "同一操作 ID 不能提交不同内容" };
    if (!["create", "save", "rebase", "publish"].includes(command.type))
      failure("INVALID_SCHEMA", "未知整合命令");
    object(
      command.payload,
      [
        "bundleId",
        "purpose",
        "baseVersionId",
        "title",
        "sourceIds",
        "sections",
        "excludeReasons",
        "choices",
        "expectedBundleVersion",
        "reviewed",
        "reviewNote",
      ],
      "整合内容",
    );
    const p = command.payload;
    if (p.purpose !== undefined && (p.purpose !== "project_spec" || command.type !== "create")) failure("INVALID_SCHEMA", "规范用途只在创建时明确指定");
    // All mutations are private until the complete command validates successfully.
    const state: IntegrationState = structuredClone(
      (snapshot as WithIntegration).integration ?? {
        schema: 1,
        sequence: 0,
        bundles: {},
        drafts: {},
        revisions: [],
        versions: [],
        events: [],
        receipts: {},
      },
    );
    const view = { ...snapshot, integration: state };
    let draft: IntegrationDraft, bundle: IntegrationBundle, result: IntegrationResult;
    if (command.type === "create") {
      if (p.bundleId) {
        const found = own(state.bundles, p.bundleId);
        if (!found) failure("NOT_FOUND", "完整成果不存在");
        bundle = found;
        if (p.purpose && bundle.purpose !== p.purpose) failure("INVALID_SCHEMA", "不能将普通成果改为项目规范");
      } else {
        if (p.purpose === "project_spec" && Object.values(state.bundles).some(b => b.purpose === "project_spec")) failure("SPEC_EXISTS", "项目已有规范，请在同一规范中创建修订");
        bundle = {
          ...(p.purpose ? { purpose: p.purpose } : {}),
          id: uid("integration"),
          title: text(p.title, "成果标题", 300),
          version: 0,
          createdAt: now(),
        };
        state.bundles[bundle.id] = bundle;
      }
      const baseVersionId = p.baseVersionId ?? bundle.publishedVersionId;
      const base = state.versions.find((v) => v.id === baseVersionId && v.bundleId === bundle.id);
      if (baseVersionId && !base) failure("INVALID_BASE", "基线版本不存在或属于其他成果");
      if (!base && p.sourceIds === undefined) failure("INVALID_SCHEMA", "请选择本次整合来源");
      const selected =
        p.sourceIds === undefined
          ? base!.sourcePins.map((p) => p.artifactId)
          : ids(p.sourceIds, "来源");
      if (!selected.length) failure("NO_SOURCE", "至少选择一份已验收来源");
      const excluded = bundle.purpose === "project_spec" ? base?.sourcePins.filter(pin => !selected.includes(pin.artifactId)) ?? [] : [];
      for (const pin of excluded) {
        if (!p.excludeReasons || !Object.prototype.hasOwnProperty.call(p.excludeReasons, pin.artifactId) || !text(p.excludeReasons[pin.artifactId], "排除来源的理由", 2000))
          failure("EXCLUSION_REASON_REQUIRED", "修订规范移除旧来源需要说明理由");
      }
      const pins =
        base && p.sourceIds === undefined
          ? structuredClone(base.sourcePins)
          : sourcePins(snapshot, selected);
      const sources = listIntegrationSources(snapshot);
      const initial =
        p.sections ??
        base?.sections ??
        pins.map((p) => ({
          id: uid("section"),
          title: p.title,
          body: sources.find((s) => s.artifactId === p.artifactId)!.body,
          sourceIds: [p.artifactId],
        }));
      draft = {
        id: uid("integration-draft"),
        bundleId: bundle.id,
        revision: 0,
        revisionId: "",
        baseVersionId,
        status: "draft",
      };
      state.drafts[draft.id] = draft;
      appendRevision(
        state,
        draft,
        {
          title:
            p.title === undefined ? (base?.title ?? bundle.title) : text(p.title, "成果标题", 300),
          sourcePins: pins,
          sections: sections(initial, selected),
        },
        "用户创建整合草案",
      );
      recordEvent(
        state,
        draft,
        "created",
        excluded.length ? stable({ baseVersionId, excluded: excluded.map(pin => ({ artifactId: pin.artifactId, reason: p.excludeReasons![pin.artifactId] })) }) : base ? `从版本 ${base.version} 创建草案` : `选择 ${pins.length} 份已验收成果`,
      );
      result = {
        ok: true,
        resourceId: draft.id,
        draftId: draft.id,
        bundleId: bundle.id,
        revision: draft.revision,
        message: "整合草案已创建",
      };
    } else {
      const found = command.draftId && own(state.drafts, command.draftId);
      if (!found) failure("NOT_FOUND", "整合草案不存在");
      draft = found;
      bundle = own(state.bundles, draft.bundleId)!;
      if (draft.status !== "draft") failure("DRAFT_CLOSED", "已发布草案不可改写，请从版本新建草案");
      if (
        !Number.isSafeInteger(command.expectedRevision) ||
        command.expectedRevision !== draft.revision
      )
        failure("REVISION_CONFLICT", "草案已被其他窗口更新，请重新读取后保存");
      const current = state.revisions.find((r) => r.id === draft.revisionId)!;
      if (command.type === "save") {
        const selected = ids(p.sourceIds, "来源");
        if (!selected.length) failure("NO_SOURCE", "至少保留一份已验收来源");
        const removed = current.sourcePins.filter((pin) => !selected.includes(pin.artifactId));
        for (const source of removed)
          if (
            !p.excludeReasons ||
            !Object.prototype.hasOwnProperty.call(p.excludeReasons, source.artifactId) ||
            !text(p.excludeReasons[source.artifactId], "排除来源的理由", 2000)
          )
            failure("EXCLUSION_REASON_REQUIRED", "排除已选来源需要说明理由");
        const freshPins = sourcePins(snapshot, selected);
        const nextPins = freshPins.map(
          (pin) => current.sourcePins.find((old) => old.artifactId === pin.artifactId) ?? pin,
        );
        appendRevision(
          state,
          draft,
          {
            title: text(p.title, "成果标题", 300),
            sourcePins: nextPins,
            sections: sections(p.sections, selected),
          },
          "用户编辑整合草案",
        );
        recordEvent(
          state,
          draft,
          "saved",
          removed.length
            ? stable({
                excluded: removed.map((s) => ({
                  artifactId: s.artifactId,
                  reason: p.excludeReasons![s.artifactId],
                })),
              })
            : "用户保存内容与来源",
        );
        result = {
          ok: true,
          draftId: draft.id,
          bundleId: bundle.id,
          revision: draft.revision,
          message: "草案已保存",
        };
      } else if (command.type === "rebase") {
        const base = state.versions.find((v) => v.id === draft.baseVersionId),
          published = state.versions.find((v) => v.id === bundle.publishedVersionId);
        if (p.expectedBundleVersion !== bundle.version)
          failure("BASE_CONFLICT", "发布基线再次变化，请重新核对");
        if (p.choices !== undefined) {
          if (!p.choices || typeof p.choices !== "object" || Array.isArray(p.choices))
            failure("INVALID_SCHEMA", "冲突处理选择无效");
          const validKeys = mergeContent(base, current, published).conflicts.map((c) => c.key);
          if (Object.keys(p.choices).some((k) => !validKeys.includes(k)))
            failure("INVALID_SCHEMA", "冲突已变化，请重新核对处理选择");
        }
        const merged = mergeContent(base, current, published, p.choices);
        if (merged.conflicts.length)
          failure("MERGE_CONFLICT", "同一内容存在并行修改，请逐项处理", {
            conflicts: merged.conflicts,
          });
        merged.content.sourcePins = sourcePins(
          snapshot,
          merged.content.sourcePins.map((p) => p.artifactId),
        );
        merged.content.sections = sections(
          merged.content.sections,
          merged.content.sourcePins.map((p) => p.artifactId),
        );
        draft.baseVersionId = bundle.publishedVersionId;
        appendRevision(state, draft, merged.content, "用户重基线并重新绑定当前有效来源与条件");
        recordEvent(
          state,
          draft,
          "rebased",
          stable({ baseVersionId: draft.baseVersionId ?? null, choices: p.choices ?? {} }),
        );
        result = {
          ok: true,
          draftId: draft.id,
          bundleId: bundle.id,
          revision: draft.revision,
          message: "基线已更新，请重新审阅",
        };
      } else {
        if (p.reviewed !== true)
          failure("HUMAN_REVIEW_REQUIRED", "请确认已核对整份成果、来源与交叉影响");
        if (p.expectedBundleVersion !== bundle.version)
          failure("BASE_CONFLICT", "已有其他窗口发布新版本，请先重基线");
        const inspection = inspectIntegration(view, draft.id);
        if (!inspection.canPublish)
          failure("INTEGRATION_BLOCKED", "请先处理来源、基线或结构冲突", {
            issues: inspection.issues,
          });
        const content = {
          title: current.title,
          sourcePins: structuredClone(current.sourcePins),
          sections: structuredClone(current.sections),
        };
        const version: IntegrationVersion = {
          ...content,
          ...(bundle.purpose ? { purpose: bundle.purpose } : {}),
          id: uid("integration-version"),
          bundleId: bundle.id,
          version: bundle.version + 1,
          parentVersionId: bundle.publishedVersionId,
          revisionId: current.id,
          at: now(),
          reviewNote:
            p.reviewNote === undefined
              ? "用户确认整份成果已人工复核"
              : text(p.reviewNote, "复核说明", 5000),
          hash: hashText(stable(content)),
        };
        state.versions.push(version);
        bundle.version = version.version;
        bundle.publishedVersionId = version.id;
        bundle.title = version.title;
        draft.status = "published";
        draft.publishedVersionId = version.id;
        recordEvent(
          state,
          draft,
          "published",
          `人工确认发布 v${version.version}；${version.reviewNote}`,
        );
        result = {
          ok: true,
          resourceId: version.id,
          versionId: version.id,
          draftId: draft.id,
          bundleId: bundle.id,
          revision: draft.revision,
          message: `完整成果 v${version.version} 已发布`,
        };
      }
    }
    Object.defineProperty(state.receipts, command.idempotencyKey, {
      value: { fingerprint, result: structuredClone(result) },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    (snapshot as WithIntegration).integration = state;
    return result;
  } catch (error) {
    const e = error as Error & Partial<IntegrationResult>;
    return {
      ok: false,
      code: e.code ?? "INTEGRATION_ERROR",
      message: e.message ?? "整合操作失败",
      ...(e.issues ? { issues: e.issues } : {}),
      ...(e.conflicts ? { conflicts: e.conflicts } : {}),
    };
  }
}
export function integrationMarkdown(snapshot: Snapshot, versionId: string): string {
  const inspected = inspectIntegrationVersion(snapshot, versionId);
  if (!inspected) return "";
  const { version, issues } = inspected;
  const sourceLines = version.sourcePins.map(
    (p, i) =>
      `- [${i + 1}] ${p.taskTitle} · ${p.title}\n  - task: ${p.taskKey}; artifact: ${p.artifactId}; hash: ${p.artifactHash}; review: ${p.reviewId}${p.sourceSessionId ? `; source session: ${p.tool}/${p.connectionId}/${p.sourceSessionId}` : p.runId ? "; 源会话未记录，不推测会话 ID" : "; 人工来源，无 AI 会话"}`,
  );
  return [
    `# ${version.title}`,
    "",
    `版本 ${version.version} · ${version.at}`,
    "",
    ...(issues.some((i) => i.severity === "blocking")
      ? ["> 当前来源或条件已变化，此版本保留历史，不代表最新已验证结论。", ""]
      : []),
    ...version.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...(section.schedule
        ? [
            `${section.schedule.date}${section.schedule.start ? ` ${section.schedule.start}–${section.schedule.end}` : ""}${section.schedule.resource ? ` · ${section.schedule.resource}` : ""}`,
            "",
          ]
        : []),
      section.body,
      "",
      ...(section.facts?.length ? section.facts.map((f) => `- ${f.key}：${f.value}`) : []),
      ...(section.sourceIds.length
        ? [
            `来源：${section.sourceIds.map((id) => `[${version.sourcePins.findIndex((p) => p.artifactId === id) + 1}]`).join("、")}`,
            "",
          ]
        : ["人工补充", ""]),
    ]),
    "## 来源与复核",
    "",
    ...sourceLines,
    "",
    version.reviewNote,
    "",
    "结构校验不保证任意自然语言结论兼容；发布者已人工复核。",
    "",
  ].join("\n");
}
