import type { CommandResult, Snapshot, Task } from "./types";
import {
  applyCollaboration,
  deriveBlackboard,
  deriveLedger,
  ensureCollaboration,
  hashText,
  estimateTokens,
  projectActiveCalls,
  isCollaborationArtifactFresh,
  contextSearchTerms,
  taskKey,
} from "./collaboration";
import { dateInZone } from "./timeline";

export interface TaskDue {
  precision: "date" | "time" | "period";
  date: string;
  time?: string;
  period?: "morning" | "afternoon" | "evening" | "night";
  rawText: string;
}
export interface IntakeRecord {
  id: string;
  projectId: string;
  source: "user_input";
  text: string;
  blockId: string;
  createdAt: string;
  referenceDate: string;
  timeZone: string;
}
export interface IntelligenceTaskDraft {
  title: string;
  goal?: string;
  criteria?: string[];
  due?: TaskDue;
}
export interface ClassificationResult {
  source: "user_input";
  intent: "task" | "note" | "ambiguous" | "duplicate";
  decision: "auto_create" | "keep_note" | "suggest_manual" | "duplicate";
  reason: string;
  task?: IntelligenceTaskDraft;
  existingTaskId?: string;
}
export interface ClassificationRecord {
  id: string;
  inputId: string;
  jobId: string;
  result: ClassificationResult;
  at: string;
  agentId: string;
  meta?: Record<string, unknown>;
  createdTaskId?: string;
}
export interface SummaryItem {
  text: string;
  taskKey?: string;
  factRefs: string[];
}
export interface SummaryAction {
  actionId: string;
  title: string;
  goal: string;
  criteria: string[];
  reason: string;
  factRefs: string[];
  due?: TaskDue;
  existingTaskId?: string;
}
export interface ProjectSummaryResult {
  overview: string;
  completed: SummaryItem[];
  current: SummaryItem[];
  issues: SummaryItem[];
  nextActions: SummaryAction[];
}
export interface SummaryLedgerEntry {
  key: string;
  title: string;
  owner: string;
  status: string;
  version: number;
  specRevision: number;
  goal: string;
  criteria: string[];
  acceptedArtifactId?: string;
  legacyCompletion?: boolean;
  requiresRevalidation?: boolean;
}
export interface SummaryInput {
  projectId: string;
  projectName: string;
  sourceSeq: number;
  sourceEventIds: string[];
  ledger: SummaryLedgerEntry[];
  factRefs: string[];
  facts: { id: string; kind: string; text: string }[];
  blackboard: { running: string[]; review: string[]; blocked: string[]; ready: string[] };
  rejectedActions: { actionId: string; title: string }[];
  referenceDate: string;
  timeZone: string;
  coverage?: {
    mode: "full" | "incremental" | "partial";
    taskTotal: number;
    taskIncluded: number;
    artifactTotal: number;
    artifactIncluded: number;
    eventTotal: number;
    eventIncluded: number;
    tokenBudget: number | null;
    estimatedTokens: number;
    omittedTasks: number;
    omittedArtifacts: number;
    omittedEvents: number;
  };
  projectCounts?: Record<string, number>;
  previousSummary?: {
    id: string;
    version: number;
    sourceSeq: number;
    overview: string;
    hash: string;
    truncated: boolean;
  };
  blockedReason?: string;
}
export interface ClassificationInput {
  projectId: string;
  intake: IntakeRecord;
  existingTasks: { id: string; title: string; status: string }[];
  factRefs: string[];
  coverage?: {
    taskTotal: number;
    taskIncluded: number;
    omittedTasks: number;
    tokenBudget: number | null;
    estimatedTokens: number;
  };
}
export interface TaskTitleInput {
  projectId: string; taskId: string; title: string; titleRevision: number; taskVersion: number; goal: string;
}
export const TASK_TITLE_LIMIT = 40;
export function conciseTaskTitle(value: unknown): string {
  const title = text(value, "任务标题", TASK_TITLE_LIMIT * 2);
  if (Array.from(title).length > TASK_TITLE_LIMIT || /[\r\n]/.test(title)) fail("TITLE_TOO_LONG", "请将标题归纳为不超过 40 字的一句话，原始内容已保留");
  return title;
}
export interface IntelligenceJob {
  id: string;
  kind: "classify" | "summary" | "title";
  status: "queued" | "running" | "succeeded" | "failed";
  inputId?: string;
  agentId?: string;
  input: ClassificationInput | SummaryInput | TaskTitleInput;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  resultId?: string;
  reservedTokens?: number;
  actualTokens?: number | null;
  usageFinal?: boolean;
  meta?: Record<string, unknown>;
}
export interface ProjectSummaryVersion extends ProjectSummaryResult {
  id: string;
  version: number;
  jobId: string;
  sourceSeq: number;
  sourceEventIds: string[];
  ledger: SummaryLedgerEntry[];
  factRefs: string[];
  generatedAt: string;
  agentId: string;
  meta?: Record<string, unknown>;
  hash: string;
  coverage?: SummaryInput["coverage"];
  previousSummaryId?: string;
}
export interface TaskSuggestion {
  id: string;
  projectId: string;
  sourceType: "project_summary";
  title: string;
  description: string;
  goal: string;
  criteria: string[];
  due?: TaskDue;
  factRefs: string[];
  sourceSummaryId: string;
  sourceSummaryVersion: number;
  sourceActionId: string;
  sourceSeq: number;
  status: "pending" | "accepted" | "rejected" | "superseded";
  linkedTaskId?: string;
  createdAt: string;
  resolvedAt?: string;
}
export interface SuggestionEvent {
  id: string;
  suggestionId: string;
  type: "proposed" | "accepted" | "rejected" | "superseded" | "duplicate";
  at: string;
  sourceSummaryId: string;
  sourceActionId: string;
  title: string;
  reason: string;
  taskId?: string;
  proposal?: TaskSuggestion;
}
export interface IntelligenceState {
  schema: 1;
  intakes: IntakeRecord[];
  classifications: ClassificationRecord[];
  summaryVersions: ProjectSummaryVersion[];
  suggestionEvents: SuggestionEvent[];
  intakeStates: Record<
    string,
    {
      status: "queued" | "running" | "classified" | "failed";
      jobId: string;
      classificationId?: string;
      taskId?: string;
      error?: string;
    }
  >;
  jobs: Record<string, IntelligenceJob>;
  suggestions: Record<string, TaskSuggestion>;
  latestSummaryId?: string;
  summaryState: {
    status: "idle" | "queued" | "running" | "ready" | "stale" | "failed";
    dirty: boolean;
    sourceSeq: number;
    jobId?: string;
    error?: string;
    blockedSourceSeq?: number;
  };
}
export interface IntelligenceResult extends CommandResult {
  inputId?: string;
  jobId?: string;
  blockId?: string;
  taskId?: string;
  summaryId?: string;
  stale?: boolean;
  replayed?: boolean;
  code?: string;
  job?: IntelligenceJob;
}
const id = (prefix: string) => prefix + "-" + crypto.randomUUID(),
  now = () => new Date().toISOString();
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function text(value: unknown, name: string, max = 20000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail("SCHEMA_INVALID", name + "无效");
  return value.trim();
}
function strings(value: unknown, name: string, max = 100): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    !value.every((v) => typeof v === "string" && v.trim() && v.length <= 3000)
  )
    fail("SCHEMA_INVALID", name + "无效");
  return value.map((v) => v.trim());
}
function object(value: unknown, allowed: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("SCHEMA_INVALID", name + "无效");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((k) => !allowed.includes(k)))
    fail("SCHEMA_INVALID", name + "包含未知字段");
  return result;
}
function atomic(
  snapshot: Snapshot,
  action: (s: Snapshot) => IntelligenceResult,
): IntelligenceResult {
  const draft = structuredClone(snapshot);
  try {
    const result = action(draft);
    Object.assign(snapshot, draft);
    return result;
  } catch (error) {
    return {
      ok: false,
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "VALIDATION_FAILED",
      message: error instanceof Error ? error.message : "智能整理未完成",
    };
  }
}
export function ensureIntelligence(s: Snapshot): IntelligenceState {
  return (s.intelligence ??= {
    schema: 1,
    intakes: [],
    classifications: [],
    summaryVersions: [],
    suggestionEvents: [],
    intakeStates: {},
    jobs: {},
    suggestions: {},
    summaryState: { status: "idle", dirty: false, sourceSeq: 0 },
  });
}
const ignoredEvents = new Set([
  "run_status",
  "checkpoint_saved",
  "context_built",
  "task_hidden_from_journal",
  "intelligence_job_receipt",
]);
export function intelligenceSourceSeq(s: Snapshot): number {
  return (
    [...(s.collaboration?.events ?? [])].reverse().find((event) => !ignoredEvents.has(event.type))
      ?.sequence ?? 0
  );
}
export function normalizeTaskTitle(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function duplicateTask(s: Snapshot, title: string) {
  const normalized = normalizeTaskTitle(title);
  return Object.values(s.tasks).find((task) => normalizeTaskTitle(task.title) === normalized);
}
function event(s: Snapshot, type: string, taskId: string | undefined, detail: string) {
  const c = ensureCollaboration(s);
  c.events.push({
    id: id("event"),
    sequence: ++c.sequence,
    type,
    taskKey: taskId,
    actor: "service",
    at: now(),
    detail,
  });
}
function metaCopy(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const encoded = JSON.stringify(meta);
  if (encoded.length > 50000) fail("SCHEMA_INVALID", "来源凭据过长");
  return JSON.parse(encoded) as Record<string, unknown>;
}
function calendarDate(value: unknown): string {
  const date = text(value, "日期", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
  )
    fail("DUE_INVALID", "日期无效");
  return date;
}
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** A due date needs a literal date/relative date cue; a clock needs an explicit clock in the input. */
export function validateTaskDue(
  value: unknown,
  source: string,
  referenceDate: string,
): TaskDue | undefined {
  if (value === undefined || value === null) return undefined;
  const p = object(value, ["precision", "date", "time", "period", "rawText"], "到期信息");
  const rawText = text(p.rawText, "原始时间表达", 300);
  if (!source.includes(rawText)) fail("DUE_INVALID", "时间表达不在原始输入中");
  const date = calendarDate(p.date),
    explicit =
      /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(rawText) ??
      /(\d{4})年(\d{1,2})月(\d{1,2})[日号]/.exec(rawText);
  let derived: string | undefined;
  if (explicit)
    derived = `${explicit[1]}-${explicit[2].padStart(2, "0")}-${explicit[3].padStart(2, "0")}`;
  else if (/大后天/.test(rawText)) derived = addDays(referenceDate, 3);
  else if (/后天/.test(rawText)) derived = addDays(referenceDate, 2);
  else if (/明天|明日|tomorrow/i.test(rawText)) derived = addDays(referenceDate, 1);
  else if (/今天|今日|today/i.test(rawText)) derived = referenceDate;
  else {
    const md = /(\d{1,2})月(\d{1,2})[日号]/.exec(rawText);
    if (md)
      derived =
        referenceDate.slice(0, 4) + "-" + md[1].padStart(2, "0") + "-" + md[2].padStart(2, "0");
    const weekday = /(下周|本周|这周|周|星期)([一二三四五六日天])/.exec(rawText);
    if (weekday) {
      const day = "日一二三四五六".indexOf(weekday[2] === "天" ? "日" : weekday[2]),
        today = new Date(referenceDate + "T00:00:00Z").getUTCDay();
      let delta = (day - today + 7) % 7;
      if (weekday[1] === "下周") delta = ((day + 6) % 7) - ((today + 6) % 7) + 7;
      derived = addDays(referenceDate, delta);
    }
  }
  if (!derived || derived !== date) fail("DUE_INVALID", "日期必须由原文的明确日期表达确定");
  if (!["date", "time", "period"].includes(String(p.precision)))
    fail("DUE_INVALID", "时间精度无效");
  if (p.precision === "date") {
    if (p.time !== undefined || p.period !== undefined) fail("DUE_INVALID", "日期精度不能附加时刻");
    return { precision: "date", date, rawText };
  }
  if (p.precision === "period") {
    const periods = {
      morning: /上午|早上|早晨|morning/i,
      afternoon: /下午|afternoon/i,
      evening: /傍晚|晚间|晚上|evening/i,
      night: /夜间|夜晚|深夜|night/i,
    };
    if (
      typeof p.period !== "string" ||
      !(p.period in periods) ||
      !periods[p.period as keyof typeof periods].test(rawText) ||
      p.time !== undefined
    )
      fail("DUE_INVALID", "时段必须来自原文，不能补充具体时刻");
    return { precision: "period", date, period: p.period as TaskDue["period"], rawText };
  }
  const clock =
    /(\d{1,2})[:：](\d{2})/.exec(rawText) ?? /(\d{1,2})[点时](?:(\d{1,2})分?)?/.exec(rawText);
  if (!clock) fail("DUE_INVALID", "原文没有具体时刻，不可补造时间");
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  if (/下午|晚上|傍晚|夜间|\bpm\b/i.test(rawText) && hour < 12) hour += 12;
  const parsed = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  if (hour > 23 || minute > 59 || p.time !== parsed || p.period !== undefined)
    fail("DUE_INVALID", "具体时刻与原文不一致");
  return { precision: "time", date, time: parsed, rawText };
}
export function submitIntakeIn(s: Snapshot, raw: string): IntelligenceResult {
  return atomic(s, (d) => {
    text(raw, "原始输入", 20000);
    const value = raw,
      i = ensureIntelligence(d),
      inputId = id("input"),
      blockId = id("block"),
      zone = d.project.timeZone ?? "Asia/Shanghai";
    const input: IntakeRecord = {
      id: inputId,
      projectId: d.project.id,
      source: "user_input",
      text: value,
      blockId,
      createdAt: now(),
      referenceDate: dateInZone(Date.now(), zone),
      timeZone: zone,
    };
    d.journal.blocks.unshift({ id: blockId, kind: "text", text: value });
    i.intakes.push(input);
    const job = createClassifyJob(d, input);
    return { ok: true, inputId, blockId, jobId: job.id };
  });
}
function createClassifyJob(s: Snapshot, input: IntakeRecord) {
  const i = ensureIntelligence(s),
    c = ensureCollaboration(s),
    job: IntelligenceJob = {
      id: id("intelligence-job"),
      kind: "classify",
      status: "queued",
      inputId: input.id,
      createdAt: now(),
      input: {
        projectId: s.project.id,
        intake: structuredClone(input),
        existingTasks: Object.values(s.tasks).map((task) => ({
          id: task.id,
          title: task.title,
          status: c.tasks[task.id]?.status ?? "ready",
        })),
        factRefs: [],
      },
    };
  const classification = job.input as ClassificationInput,
    all = classification.existingTasks,
    tokens = contextSearchTerms(input.text);
  const rank = (title: string) => {
    const normalized = normalizeTaskTitle(title);
    return (
      Number(normalized === normalizeTaskTitle(input.text)) * 1000 +
      tokens.filter((term) => normalized.includes(term) || term.includes(normalized)).length
    );
  };
  all.sort((a, b) => rank(b.title) - rank(a.title) || a.id.localeCompare(b.id));
  classification.existingTasks = [];
  for (const task of all) {
    classification.existingTasks.push(task);

  }
  classification.coverage = {
    taskTotal: all.length,
    taskIncluded: classification.existingTasks.length,
    omittedTasks: all.length - classification.existingTasks.length,
    tokenBudget: null,
    estimatedTokens: estimateTokens(JSON.stringify(classification)),
  };
  i.jobs[job.id] = job;
  i.intakeStates[input.id] = { status: "queued", jobId: job.id };
  return job;
}
export function retryIntakeIn(s: Snapshot, inputId: string): IntelligenceResult {
  return atomic(s, (d) => {
    const i = ensureIntelligence(d),
      input = i.intakes.find((item) => item.id === inputId),
      state = i.intakeStates[inputId];
    if (!input || !state) fail("NOT_FOUND", "原始输入不存在");
    if (state.status === "classified")
      return { ok: true, inputId, taskId: state.taskId, replayed: true };
    if (["queued", "running"].includes(state.status))
      return { ok: true, inputId, jobId: state.jobId, replayed: true };
    const job = createClassifyJob(d, input);
    return { ok: true, inputId, jobId: job.id };
  });
}
export function buildSummaryInput(s: Snapshot): SummaryInput {
  const i = ensureIntelligence(s),
    rows = deriveLedger(s),
    c = ensureCollaboration(s),
    sourceSeq = intelligenceSourceSeq(s);
  const previous = i.summaryVersions.find((v) => v.id === i.latestSummaryId),
    allEvents = c.events.filter((e) => e.sequence <= sourceSeq && !ignoredEvents.has(e.type)),
    events = allEvents.filter((e) => e.sequence > (previous?.sourceSeq ?? 0));
  const changed = new Set(events.map((e) => e.taskKey).filter(Boolean)),
    zone = s.project.timeZone ?? "Asia/Shanghai";
  const result: SummaryInput = {
    projectId: s.project.id,
    projectName: s.project.name,
    sourceSeq,
    sourceEventIds: [],
    ledger: [],
    factRefs: [],
    facts: [],
    blackboard: { running: [], review: [], blocked: [], ready: [] },
    rejectedActions: [],
    referenceDate: dateInZone(Date.now(), zone),
    timeZone: zone,
    projectCounts: { total: rows.length },
  };
  for (const row of rows)
    result.projectCounts![row.status] = (result.projectCounts![row.status] ?? 0) + 1;
  if (previous)
    result.previousSummary = {
      id: previous.id,
      version: previous.version,
      sourceSeq: previous.sourceSeq,
      overview: previous.overview.slice(0, 1500),
      hash: previous.hash,
      truncated: previous.overview.length > 1500,
    };
  const appendFact = (fact: SummaryInput["facts"][number]) => {
    if (!result.factRefs.includes(fact.id)) {
      result.facts.push(fact);
      result.factRefs.push(fact.id);
    }
  };
  const decisions = new Map<string, (typeof c.decisions)[number]>();
  for (const decision of c.decisions) decisions.set(decision.decisionId, decision);
  const constraints = [...decisions.values()].filter((d) => d.authority === "confirmed");
  for (const decision of constraints.filter((d) => !d.taskKey))
    appendFact({ id: decision.id, kind: "confirmed-user-condition", text: decision.kind + "；" + decision.text });
  const ordered = [...rows].sort(
    (a, b) =>
      Number(changed.has(b.key)) - Number(changed.has(a.key)) ||
      Number(!["done", "cancelled"].includes(b.status)) -
        Number(!["done", "cancelled"].includes(a.status)) ||
      a.key.localeCompare(b.key),
  );
  for (const row of ordered) {
    const entry: SummaryLedgerEntry = {
      key: row.key,
      title: row.title,
      owner: row.owner,
      status: row.status,
      version: row.version,
      specRevision: row.specRevision,
      goal: row.spec.goal,
      criteria: [...row.spec.criteria],
      acceptedArtifactId: row.acceptedArtifactId,
      legacyCompletion: row.legacyCompletion,
      requiresRevalidation: row.requiresRevalidation,
    };
    result.ledger.push(entry);
    appendFact({
      id: row.key,
      kind: "task",
      text:
        row.title +
        "；" +
        row.status +
        (s.tasks[row.taskId]?.due ? "；期限原文：" + s.tasks[row.taskId].due!.rawText : ""),
    });
    for (const decision of constraints.filter((d) => d.taskKey === row.key || d.taskKey === row.taskId))
      appendFact({ id: decision.id, kind: "confirmed-user-condition", text: decision.kind + "；" + decision.text });
  }
  const selected = new Set(result.ledger.map((row) => row.key));
  for (const artifact of [...c.artifacts].reverse().filter((a) => selected.has(a.key)))
    appendFact({ id: artifact.id, kind: "artifact-excerpt",
      text: artifact.title + "；hash=" + artifact.hash + "；" + (c.freshness[artifact.id] ?? "current") + "；节选：" + artifact.body.slice(0, 900) });
  for (const review of [...c.reviews].reverse().filter((r) => selected.has(r.key)))
    appendFact({ id: review.id, kind: "review", text: review.key + "；" + review.verdict + "；" + review.note.slice(0, 900) });
  for (const event of [...events].reverse()) {
    result.sourceEventIds.push(event.id);
    appendFact({ id: event.id, kind: "event", text: event.type + "；" + event.detail.slice(0, 700) });
  }
  for (const suggestion of Object.values(i.suggestions).filter((x) => x.status === "rejected"))
    result.rejectedActions.push({ actionId: suggestion.sourceActionId, title: suggestion.title });
  result.blackboard = {
    running: result.ledger.filter((r) => r.status === "running").map((r) => r.key),
    review: result.ledger.filter((r) => r.status === "in_review").map((r) => r.key),
    blocked: result.ledger
      .filter((r) => r.status === "blocked" || r.requiresRevalidation)
      .map((r) => r.key),
    ready: result.ledger.filter((r) => r.status === "ready").map((r) => r.key),
  };
  const includedArtifacts = result.facts.filter((f) => f.kind === "artifact-excerpt").length;
  result.coverage = {
    mode:
      result.ledger.length === rows.length && includedArtifacts === c.artifacts.length
        ? "full"
        : previous
          ? "incremental"
          : "partial",
    taskTotal: rows.length,
    taskIncluded: result.ledger.length,
    artifactTotal: c.artifacts.length,
    artifactIncluded: includedArtifacts,
    eventTotal: events.length,
    eventIncluded: result.sourceEventIds.length,
    omittedTasks: rows.length - result.ledger.length,
    omittedArtifacts: c.artifacts.length - includedArtifacts,
    omittedEvents: events.length - result.sourceEventIds.length,
    tokenBudget: null,
    estimatedTokens: estimateTokens(JSON.stringify(result)),
  };
  return result;
}
export function requestTaskTitleIn(s: Snapshot, taskId: string): IntelligenceResult {
  return atomic(s, d => {
    const task = d.tasks[taskId];
    if (!task) fail("NOT_FOUND", "任务不存在");
    const i = ensureIntelligence(d), c = ensureCollaboration(d), current = c.tasks[taskId];
    const input: TaskTitleInput = { projectId: d.project.id, taskId, title: task.title, titleRevision: task.titleRevision ?? 0, taskVersion: current.version, goal: c.specs.filter(spec => spec.key === taskId).at(-1)?.goal ?? task.originalTitle ?? task.title };
    const existing = Object.values(i.jobs).find(job => job.kind === "title" && ["queued", "running"].includes(job.status) && (job.input as TaskTitleInput).taskId === taskId);
    if (existing) return { ok: true, taskId, jobId: existing.id, replayed: true };
    const job: IntelligenceJob = { id: id("title-job"), kind: "title", status: "queued", input, createdAt: now() };
    i.jobs[job.id] = job;
    return { ok: true, taskId, jobId: job.id };
  });
}
export function finishTaskTitleJob(s: Snapshot, jobId: string, value: unknown, meta?: Record<string, unknown>): IntelligenceResult {
  return atomic(s, d => {
    const { job, replayed } = getRunning(d, jobId, "title"), input = job.input as TaskTitleInput;
    if (replayed) return { ok: true, taskId: input.taskId, replayed: true };
    const result = object(value, ["title"], "标题归纳结果"), title = conciseTaskTitle(result.title);
    const task = d.tasks[input.taskId], c = ensureCollaboration(d), current = c.tasks[input.taskId];
    job.status = "succeeded"; job.finishedAt = now();
    settleJobUsage(d, job, meta);
    if (!task || task.title !== input.title || (task.titleRevision ?? 0) !== input.titleRevision || current?.version !== input.taskVersion) {
      job.error = "标题或任务已更新，未覆盖你的修改";
      return { ok: true, taskId: input.taskId, stale: true };
    }
    task.originalTitle ??= input.title;
    task.title = title; task.titleRevision = input.titleRevision + 1;
    current.title = title; current.version++;
    event(d, "task_title_summarized", task.id, JSON.stringify({ previousTitle: input.title, title, jobId }));
    return { ok: true, taskId: task.id };
  });
}
export function requestSummaryIn(s: Snapshot): IntelligenceResult {
  return atomic(s, (d) => {
    const i = ensureIntelligence(d),
      existing = Object.values(i.jobs).find(
        (j) => j.kind === "summary" && ["queued", "running"].includes(j.status),
      );
    if (existing) return { ok: true, jobId: existing.id, replayed: true };
    const input = buildSummaryInput(d),
      latest = i.summaryVersions.find((v) => v.id === i.latestSummaryId);
    if (latest?.sourceSeq === input.sourceSeq)
      return { ok: true, summaryId: latest.id, replayed: true };
    const job: IntelligenceJob = {
      id: id("intelligence-job"),
      kind: "summary",
      status: "queued",
      input,
      createdAt: now(),
    };
    i.jobs[job.id] = job;
    i.summaryState = { status: "queued", dirty: true, sourceSeq: input.sourceSeq, jobId: job.id };
    return { ok: true, jobId: job.id };
  });
}
export function beginIntelligenceJob(
  s: Snapshot,
  jobId: string,
  agentId: string,
): IntelligenceResult {
  return atomic(s, (d) => {
    const i = ensureIntelligence(d),
      job = i.jobs[jobId];
    if (!job) fail("NOT_FOUND", "后台整理任务不存在");
    if (job.status === "running")
      return { ok: true, jobId, job: structuredClone(job), replayed: true };
    if (job.status !== "queued") fail("JOB_CLOSED", "后台整理任务已结束");
    if (!d.agents.some((a) => a.id === agentId)) fail("NO_AGENT", "请先添加 Agent");
    const policy = ensureCollaboration(d).policy;
    if (projectActiveCalls(d) >= policy.maxParallel) fail("PARALLEL_LIMIT", "达到项目共享并发上限");
    const attempts = Object.values(i.jobs).filter(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.startedAt &&
        candidate.kind === job.kind &&
        (job.inputId
          ? candidate.inputId === job.inputId
          : job.kind === "title"
            ? (candidate.input as TaskTitleInput).taskId === (job.input as TaskTitleInput).taskId && (candidate.input as TaskTitleInput).titleRevision === (job.input as TaskTitleInput).titleRevision
            : (candidate.input as SummaryInput).sourceSeq === (job.input as SummaryInput).sourceSeq),
    );
    if (attempts.length >= policy.maxAttempts)
      fail("ATTEMPT_LIMIT", "智能整理达到该输入版本的重试上限");
    job.reservedTokens = 0;
    job.actualTokens = null;
    job.usageFinal = false;
    job.status = "running";
    job.agentId = agentId;
    job.startedAt = now();
    if (job.inputId) i.intakeStates[job.inputId].status = "running";
    else if (job.kind === "summary")
      i.summaryState = {
        status: "running",
        dirty: true,
        sourceSeq: (job.input as SummaryInput).sourceSeq,
        jobId,
      };
    return { ok: true, jobId, job: structuredClone(job) };
  });
}
function getRunning(s: Snapshot, jobId: string, kind: IntelligenceJob["kind"]) {
  const i = ensureIntelligence(s),
    job = i.jobs[jobId];
  if (!job || job.kind !== kind) fail("NOT_FOUND", "后台任务不存在");
  if (job.status === "succeeded") return { i, job, replayed: true };
  if (job.status !== "running") fail("JOB_CLOSED", "后台任务未运行或已取消");
  if (job.inputId && i.intakeStates[job.inputId]?.jobId !== jobId)
    fail("STALE_JOB", "输入已有新的识别请求");
  return { i, job, replayed: false };
}
function createManagedTask(
  s: Snapshot,
  draft: IntelligenceTaskDraft,
  origin: NonNullable<Task["createdFrom"]>,
  key: string,
): string {
  const result = applyCollaboration(
    s,
    {
      projectId: s.project.id,
      idempotencyKey: key,
      type: "create_task",
      payload: {
        title: draft.title,
        goal:
          origin.type === "input"
            ? (s.intelligence?.intakes.find((input) => input.id === origin.id)?.text ??
              draft.goal ??
              draft.title)
            : (draft.goal ?? draft.title),
        criteria: draft.criteria?.length ? draft.criteria : ["用户核对交付内容符合需求"],
        owner: "me",
      },
    },
    {
      kind: "human",
      name: origin.type === "input" ? "user_input_intake" : "user_confirmed_suggestion",
    },
  );
  if (!result.ok || !result.resourceId)
    fail(result.code ?? "CREATE_FAILED", result.message ?? "任务未创建");
  const task = s.tasks[result.resourceId];
  task.createdFrom = origin;
  if (origin.type === "input") {
    const original = s.intelligence?.intakes.find((input) => input.id === origin.id)?.text;
    if (original && original !== task.title) task.originalTitle = original;
  }
  if (draft.due) task.due = structuredClone(draft.due);
  return task.id;
}
export function finishIntakeJob(
  s: Snapshot,
  jobId: string,
  value: unknown,
  meta?: Record<string, unknown>,
): IntelligenceResult {
  return atomic(s, (d) => {
    const { i, job, replayed } = getRunning(d, jobId, "classify");
    if (replayed) {
      const state = i.intakeStates[job.inputId!];
      return { ok: true, inputId: job.inputId, taskId: state.taskId, replayed: true };
    }
    const input = (job.input as ClassificationInput).intake,
      p = object(
        value,
        ["source", "intent", "decision", "reason", "task", "existingTaskId"],
        "分拣结果",
      );
    if (
      p.source !== "user_input" ||
      !["task", "note", "ambiguous", "duplicate"].includes(String(p.intent))
    )
      fail("SCHEMA_INVALID", "分拣来源或意图无效");
    const required = {
      task: "auto_create",
      note: "keep_note",
      ambiguous: "suggest_manual",
      duplicate: "duplicate",
    };
    if (p.decision !== required[p.intent as keyof typeof required])
      fail("SCHEMA_INVALID", "意图与创建权限不匹配");
    const result: ClassificationResult = {
      source: "user_input",
      intent: p.intent as ClassificationResult["intent"],
      decision: p.decision as ClassificationResult["decision"],
      reason: text(p.reason, "分拣说明", 3000),
    };
    if (p.task !== undefined) {
      const t = object(p.task, ["title", "goal", "criteria", "due"], "分拣待办");
      result.task = {
        title: conciseTaskTitle(t.title),
        goal: t.goal === undefined ? undefined : text(t.goal, "目标"),
        criteria: t.criteria === undefined ? undefined : strings(t.criteria, "验收条件"),
        due: validateTaskDue(t.due, input.text, input.referenceDate),
      };
    }
    if (result.intent === "task" && !result.task) fail("SCHEMA_INVALID", "明确待办缺少标题");
    if (result.intent === "duplicate") {
      const existing = d.tasks[text(p.existingTaskId, "已存在任务 ID", 200)];
      if (!existing) fail("DUPLICATE_INVALID", "重复判断必须引用同项目中存在的任务");
      result.existingTaskId = existing.id;
    } else if (p.existingTaskId !== undefined)
      fail("SCHEMA_INVALID", "只有重复判断可以关联现有任务");
    let taskId: string | undefined;
    const liveBlock = d.journal.blocks.find((block) => block.id === input.blockId);
    if (liveBlock?.kind === "task" && d.tasks[liveBlock.taskId]) {
      result.intent = "duplicate";
      result.decision = "duplicate";
      result.existingTaskId = liveBlock.taskId;
      result.reason = "用户已从原文手动创建任务，保留人工内容，不再自动创建";
      delete result.task;
      taskId = liveBlock.taskId;
    } else if (!liveBlock || liveBlock.kind !== "text" || liveBlock.text !== input.text) {
      result.intent = "ambiguous";
      result.decision = "suggest_manual";
      result.reason = "原始记录已被编辑或移除，本次异步识别已过期；保留原文供追溯，不自动创建";
      delete result.task;
      delete result.existingTaskId;
    }
    if (result.intent === "task") {
      const duplicate = duplicateTask(d, result.task!.title);
      if (duplicate) {
        result.intent = "duplicate";
        result.decision = "duplicate";
        result.existingTaskId = duplicate.id;
        result.reason = "已存在完全相同的规范化标题；保留原文并关联，未合并任务";
      } else
        taskId = createManagedTask(
          d,
          result.task!,
          { type: "input", id: input.id },
          "intake-create:" + input.id,
        );
    }
    // applyCollaboration replaces the draft atomically; reacquire its intelligence projection.
    const state = ensureIntelligence(d),
      current = state.jobs[jobId],
      record: ClassificationRecord = {
        id: id("classification"),
        inputId: input.id,
        jobId,
        result,
        at: now(),
        agentId: job.agentId!,
        meta: metaCopy(meta),
        createdTaskId: result.intent === "task" ? taskId : undefined,
      };
    state.classifications.push(record);
    state.intakeStates[input.id] = {
      status: "classified",
      jobId,
      classificationId: record.id,
      taskId,
    };
    current.status = "succeeded";
    current.finishedAt = now();
    current.resultId = record.id;
    settleJobUsage(d, current, meta);
    return { ok: true, inputId: input.id, taskId };
  });
}
function validateSummary(value: unknown, input: SummaryInput): ProjectSummaryResult {
  const p = object(
      value,
      ["overview", "completed", "current", "issues", "nextActions"],
      "项目总结",
    ),
    refs = new Set(input.factRefs),
    sourceText = input.facts.map((f) => f.text).join("\n");
  const facts = (v: unknown) => {
    const ids = strings(v, "事实引用");
    if (ids.some((ref) => !refs.has(ref)))
      fail("FACT_REFERENCE_INVALID", "总结引用不属于固定输入版本");
    return ids;
  };
  const section = (v: unknown, completed = false): SummaryItem[] => {
    if (!Array.isArray(v) || v.length > 100) fail("SCHEMA_INVALID", "总结条目格式无效");
    return v.map((entry) => {
      const item = object(entry, ["text", "taskKey", "factRefs"], "总结条目"),
        task =
          item.taskKey === undefined ? undefined : input.ledger.find((t) => t.key === item.taskKey);
      if (item.taskKey !== undefined && !task) fail("FACT_REFERENCE_INVALID", "总结引用未知任务");
      if (completed && (!task || task.status !== "done" || task.requiresRevalidation))
        fail("FACT_REFERENCE_INVALID", "总结不能将未验收或失效任务描述为已完成");
      return {
        text: text(item.text, "总结条目", 5000),
        taskKey: task?.key,
        factRefs: facts(item.factRefs),
      };
    });
  };
  if (!Array.isArray(p.nextActions) || p.nextActions.length > 30)
    fail("SCHEMA_INVALID", "下一步行动数量无效");
  const nextActions: SummaryAction[] = p.nextActions.map((entry) => {
    const a = object(
        entry,
        ["actionId", "title", "goal", "criteria", "reason", "factRefs", "due", "existingTaskId"],
        "下一步行动",
      ),
      criteria = strings(a.criteria, "行动验收条件");
    if (!criteria.length) fail("SCHEMA_INVALID", "建议任务需要明确验收条件");
    if (
      a.existingTaskId !== undefined &&
      !input.ledger.some((t) => t.key === a.existingTaskId && !t.key.includes("::"))
    )
      fail("DUPLICATE_INVALID", "语义重复必须引用输入中的任务 ID");
    return {
      actionId: text(a.actionId, "行动标识", 200),
      title: text(a.title, "行动标题", 200),
      goal: text(a.goal, "行动目标"),
      criteria,
      reason: text(a.reason, "建议原因", 3000),
      factRefs: facts(a.factRefs),
      due: validateTaskDue(a.due, sourceText, input.referenceDate),
      existingTaskId: a.existingTaskId as string | undefined,
    };
  });
  if (new Set(nextActions.map((a) => a.actionId)).size !== nextActions.length)
    fail("SCHEMA_INVALID", "行动标识不能重复");
  return {
    overview: text(p.overview, "项目概述", 20000),
    completed: section(p.completed, true),
    current: section(p.current),
    issues: section(p.issues),
    nextActions,
  };
}
function suggestionEvent(
  i: IntelligenceState,
  suggestion: TaskSuggestion,
  type: SuggestionEvent["type"],
  reason: string,
) {
  i.suggestionEvents.push({
    id: id("suggestion-event"),
    suggestionId: suggestion.id,
    type,
    at: now(),
    sourceSummaryId: suggestion.sourceSummaryId,
    sourceActionId: suggestion.sourceActionId,
    title: suggestion.title,
    reason,
    taskId: suggestion.linkedTaskId,
    ...(type === "proposed" ? { proposal: structuredClone(suggestion) } : {}),
  });
}
export function finishSummaryJob(
  s: Snapshot,
  jobId: string,
  value: unknown,
  meta?: Record<string, unknown>,
): IntelligenceResult {
  return atomic(s, (d) => {
    const { i, job, replayed } = getRunning(d, jobId, "summary");
    if (replayed) return { ok: true, summaryId: job.resultId, replayed: true };
    const input = job.input as SummaryInput,
      result = validateSummary(value, input);
    const summary: ProjectSummaryVersion = {
      ...result,
      id: id("summary"),
      version: i.summaryVersions.length + 1,
      jobId,
      sourceSeq: input.sourceSeq,
      sourceEventIds: [...input.sourceEventIds],
      ledger: structuredClone(input.ledger),
      factRefs: [...input.factRefs],
      generatedAt: now(),
      agentId: job.agentId!,
      meta: metaCopy(meta),
      hash: hashText(JSON.stringify({ input, result })),
      coverage: structuredClone(input.coverage),
      previousSummaryId: input.previousSummary?.id,
    };
    i.summaryVersions.push(summary);
    job.status = "succeeded";
    job.finishedAt = now();
    job.resultId = summary.id;
    settleJobUsage(d, job, meta);
    if (intelligenceSourceSeq(d) !== input.sourceSeq) {
      i.summaryState = { status: "stale", dirty: true, sourceSeq: input.sourceSeq };
      const queued = requestSummaryIn(d);
      return { ok: true, summaryId: summary.id, stale: true, jobId: queued.jobId };
    }
    i.latestSummaryId = summary.id;
    i.summaryState = { status: "ready", dirty: false, sourceSeq: input.sourceSeq };
    const previousPending = Object.values(i.suggestions).filter(
        (item) => item.status === "pending",
      ),
      retained = new Set<string>(),
      seenTitles = new Set<string>();
    for (const action of result.nextActions) {
      const normalized = normalizeTaskTitle(action.title);
      if (seenTitles.has(normalized)) continue;
      seenTitles.add(normalized);
      const settled = Object.values(i.suggestions).find(
        (item) =>
          (item.sourceActionId === action.actionId ||
            normalizeTaskTitle(item.title) === normalized) &&
          ["accepted", "rejected"].includes(item.status),
      );
      if (settled) continue;
      const previous = previousPending.find(
        (item) =>
          item.sourceActionId === action.actionId || normalizeTaskTitle(item.title) === normalized,
      );
      const linked = action.existingTaskId
        ? d.tasks[action.existingTaskId]
        : duplicateTask(d, action.title);
      const suggestion: TaskSuggestion = {
        id: previous?.id ?? id("suggestion"),
        projectId: d.project.id,
        sourceType: "project_summary",
        title: action.title,
        description: action.reason,
        goal: action.goal,
        criteria: [...action.criteria],
        due: action.due,
        factRefs: [...action.factRefs],
        sourceSummaryId: summary.id,
        sourceSummaryVersion: summary.version,
        sourceActionId: action.actionId,
        sourceSeq: summary.sourceSeq,
        status: linked ? "superseded" : "pending",
        linkedTaskId: linked?.id,
        createdAt: previous?.createdAt ?? now(),
        ...(linked ? { resolvedAt: now() } : {}),
      };
      i.suggestions[suggestion.id] = suggestion;
      retained.add(suggestion.id);
      suggestionEvent(
        i,
        suggestion,
        linked ? "duplicate" : "proposed",
        linked
          ? "同项目已有任务，未合并或新建"
          : previous
            ? "新总结重新校验同一待确认行动，保留身份"
            : "等待用户逐项确认",
      );
    }
    for (const suggestion of previousPending)
      if (!retained.has(suggestion.id)) {
        suggestion.status = "superseded";
        suggestion.resolvedAt = now();
        suggestionEvent(i, suggestion, "superseded", "新总结不再支持该行动");
      }
    return { ok: true, summaryId: summary.id };
  });
}
export function resolveSuggestionIn(
  s: Snapshot,
  suggestionId: string,
  decision: "accepted" | "rejected",
): IntelligenceResult {
  return atomic(s, (d) => {
    const i = ensureIntelligence(d),
      suggestion = i.suggestions[suggestionId];
    if (!suggestion) fail("NOT_FOUND", "行动建议不存在");
    if (!["accepted", "rejected"].includes(decision)) fail("SCHEMA_INVALID", "建议处理动作无效");
    if (suggestion.status === decision)
      return { ok: true, taskId: suggestion.linkedTaskId, replayed: true };
    if (suggestion.status !== "pending") fail("SUGGESTION_CLOSED", "建议已处理或被更新");
    if (decision === "rejected") {
      suggestion.status = "rejected";
      suggestion.resolvedAt = now();
      suggestionEvent(
        i,
        suggestion,
        "rejected",
        "用户忽略建议；后续相同标识或完全相同标题不再提醒",
      );
      return { ok: true };
    }
    const latest = i.summaryVersions.find((x) => x.id === i.latestSummaryId);
    if (
      !latest ||
      latest.id !== suggestion.sourceSummaryId ||
      (latest.sourceSeq !== intelligenceSourceSeq(d) &&
        !ensureCollaboration(d)
          .events.filter(
            (event) => event.sequence > latest.sourceSeq && !ignoredEvents.has(event.type),
          )
          .every(
            (event) =>
              event.type === "task_created" &&
              event.taskKey &&
              d.tasks[event.taskKey]?.createdFrom?.type === "suggestion" &&
              d.tasks[event.taskKey]?.createdFrom?.summaryId === latest.id,
          ))
    )
      fail("STALE_SUGGESTION", "项目事实已有变化，请等待后台更新后重新确认");
    const facts = ensureCollaboration(d);
    const validRef = (ref: string) => {
      if (!latest.factRefs.includes(ref)) return false;
      const task = facts.tasks[ref];
      if (task) {
        const fixed = latest.ledger.find((row) => row.key === ref);
        return (
          !!fixed &&
          fixed.version === task.version &&
          (!task.acceptedArtifactId || isCollaborationArtifactFresh(d, task.acceptedArtifactId))
        );
      }
      const artifact = facts.artifacts.find((value) => value.id === ref);
      if (artifact) return isCollaborationArtifactFresh(d, artifact.id);
      return (
        facts.events.some((value) => value.id === ref) ||
        facts.reviews.some((value) => value.id === ref) ||
        facts.decisions.some((value) => value.id === ref)
      );
    };
    if (suggestion.factRefs.some((ref) => !validRef(ref)))
      fail("FACT_REFERENCE_INVALID", "建议引用已失效");
    const duplicate = duplicateTask(d, suggestion.title);
    if (duplicate) {
      suggestion.status = "superseded";
      suggestion.linkedTaskId = duplicate.id;
      suggestion.resolvedAt = now();
      suggestionEvent(i, suggestion, "duplicate", "确认时检测到同标题任务，未重复创建");
      return { ok: true, taskId: duplicate.id, message: "已有相同任务，已关联现有记录" };
    }
    const taskId = createManagedTask(
        d,
        suggestion,
        { type: "suggestion", id: suggestion.id, summaryId: suggestion.sourceSummaryId },
        "suggestion-create:" + suggestion.id,
      ),
      state = ensureIntelligence(d),
      current = state.suggestions[suggestion.id];
    current.status = "accepted";
    current.linkedTaskId = taskId;
    current.resolvedAt = now();
    suggestionEvent(
      state,
      current,
      "accepted",
      "用户确认，直接采用已校验结构化任务，无需再次调用模型",
    );
    return { ok: true, taskId };
  });
}
export function failIntelligenceJob(
  s: Snapshot,
  jobId: string,
  error: string,
  meta?: Record<string, unknown>,
): IntelligenceResult {
  return atomic(s, (d) => {
    const i = ensureIntelligence(d),
      job = i.jobs[jobId];
    if (!job) fail("NOT_FOUND", "后台任务不存在");
    if (job.status === "succeeded") return { ok: true, replayed: true };
    job.status = "failed";
    job.error = text(error, "失败原因", 5000);
    job.finishedAt = now();
    settleJobUsage(d, job, meta);
    if (job.inputId) i.intakeStates[job.inputId] = { status: "failed", jobId, error: job.error };
    else if (job.kind === "summary")
      i.summaryState = {
        status: "failed",
        dirty: true,
        error: job.error,
        sourceSeq: (job.input as SummaryInput).sourceSeq,
        blockedSourceSeq: intelligenceSourceSeq(d),
      };
    return { ok: true };
  });
}
function settleJobUsage(s: Snapshot, job: IntelligenceJob, meta?: Record<string, unknown>) {
  const copy = metaCopy(meta);
  if (copy) {
    job.meta = copy;
    const usage = copy.actualTokens;
    if (usage !== undefined && usage !== null) {
      if (!Number.isSafeInteger(usage) || Number(usage) < 0)
        fail("USAGE_INVALID", "系统调用实际用量无效");
      if (
        job.actualTokens !== undefined &&
        job.actualTokens !== null &&
        Number(usage) < job.actualTokens
      )
        fail("USAGE_REGRESSION", "系统调用用量不能倒退");
      job.actualTokens = Number(usage);
      job.usageFinal = copy.acceptance !== "unknown";
    }
  }
  event(
    s,
    "intelligence_job_receipt",
    undefined,
    JSON.stringify({
      jobId: job.id,
      status: job.status,
      actualTokens: job.actualTokens ?? null,
      usageFinal: job.usageFinal ?? false,
      meta: copy,
    }),
  );
}
export function recoverIntelligenceJobs(s: Snapshot): void {
  const i = ensureIntelligence(s);
  for (const job of Object.values(i.jobs))
    if (job.status === "queued" || job.status === "running") {
      job.status = "failed";
      job.finishedAt = now();
      job.error = "应用重启中断；保留原文，请手动重试";
      if (job.inputId)
        i.intakeStates[job.inputId] = { status: "failed", jobId: job.id, error: job.error };
      else if (job.kind === "summary")
        i.summaryState = {
          status: "failed",
          dirty: true,
          error: job.error,
          sourceSeq: (job.input as SummaryInput).sourceSeq,
          blockedSourceSeq: intelligenceSourceSeq(s),
        };
    }
}
/** Read-only machine projection: advisory text never becomes a requirement or confirmed user fact. */
export function latestSummaryForContext(s: Snapshot) {
  const i = s.intelligence,
    summary = i?.summaryVersions.find((v) => v.id === i.latestSummaryId);
  return summary && summary.sourceSeq === intelligenceSourceSeq(s) ? summary : undefined;
}
