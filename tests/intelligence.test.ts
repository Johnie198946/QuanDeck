import assert from "node:assert/strict";
import { createEmptySnapshot, LOCAL_PROJECTS_KEY } from "../src/data/projectStorage";
import { createSampleSnapshot } from "../src/data/fixtures";
import {
  applyCollaboration,
  buildContextPackage,
  estimateTokens,
  projectCommittedTokens,
} from "../src/data/collaboration";
import {
  beginIntelligenceJob,
  requestTaskTitleIn,
  finishTaskTitleJob,
  conciseTaskTitle,
  buildSummaryInput,
  ensureIntelligence,
  failIntelligenceJob,
  finishIntakeJob,
  finishSummaryJob,
  intelligenceSourceSeq,
  latestSummaryForContext,
  recoverIntelligenceJobs,
  requestSummaryIn,
  resolveSuggestionIn,
  retryIntakeIn,
  submitIntakeIn,
  validateTaskDue,
  type ProjectSummaryResult,
  type SummaryInput,
} from "../src/data/intelligence";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import type { Snapshot } from "../src/data/types";
let seq = 0;
const fresh = () => {
  const s = createEmptySnapshot({
    id: "intel-project",
    name: "TokenOps",
    timeZone: "Asia/Shanghai",
  });
  s.agents = createSampleSnapshot().agents;
  return s;
};
const add = (s: Snapshot, title: string) => {
  const result = applyCollaboration(
    s,
    {
      projectId: s.project.id,
      idempotencyKey: "add-" + ++seq,
      type: "create_task",
      payload: { title, goal: title, criteria: ["用户核对证据"], owner: "me" },
    },
    { kind: "human" },
  );
  assert(result.ok, result.message);
  return result.resourceId!;
};
const start = (s: Snapshot, jobId: string) => {
  const result = beginIntelligenceJob(s, jobId, s.agents[0].id);
  assert(result.ok, result.message);
  return result.job!;
};
function summary(
  input: SummaryInput,
  actions = ["完善海外 FAQ", "核对演讲时间"],
): ProjectSummaryResult {
  return {
    overview: "当前项目任务正在准备，尚未验收。",
    completed: [],
    current: input.ledger
      .slice(0, 1)
      .map((t) => ({ text: "待完成：" + t.title, taskKey: t.key, factRefs: [t.key] })),
    issues: [],
    nextActions: actions.map((title, index) => ({
      actionId: "action-" + title,
      title,
      goal: title,
      criteria: ["内容准确且用户确认"],
      reason: "根据现有任务补充下一步行动",
      factRefs: input.ledger.slice(0, 1).map((t) => t.key),
    })),
  };
}
const s = fresh(),
  raw = "  明天下午完成 TokenOps 英文演讲稿。\n";
const submitted = submitIntakeIn(s, raw);
assert(submitted.ok);
assert.equal(Object.keys(s.tasks).length, 0, "raw input is durably recorded before an AI response");
assert.equal(s.intelligence!.intakes[0].text, raw);
assert.equal(s.journal.blocks[0].kind, "text");
assert.equal(s.intelligence!.intakeStates[submitted.inputId!].status, "queued");
const job = start(s, submitted.jobId!),
  input = s.intelligence!.intakes[0],
  tomorrow = new Date(input.referenceDate + "T00:00:00Z");
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const dueDate = tomorrow.toISOString().slice(0, 10);
const classification = {
  source: "user_input",
  intent: "task",
  decision: "auto_create",
  reason: "用户明确要求完成演讲稿",
  task: {
    title: "完成 TokenOps 英文演讲稿",
    due: { precision: "period", date: dueDate, period: "afternoon", rawText: "明天下午" },
  },
};
const beforeInvalid = JSON.stringify(s);
assert.equal(
  finishIntakeJob(s, job.id, {
    ...classification,
    task: {
      ...classification.task,
      due: { precision: "time", date: dueDate, time: "15:00", rawText: "明天下午" },
    },
  }).code,
  "DUE_INVALID",
);
assert.equal(
  JSON.stringify(s),
  beforeInvalid,
  "no invented clock or partial task on invalid output",
);
const classified = finishIntakeJob(s, job.id, classification, {
  requestId: "real-receipt",
  actualTokens: 125,
});
assert(classified.ok, classified.message);
assert.equal(s.tasks[classified.taskId!].due?.precision, "period");
assert.equal(s.tasks[classified.taskId!].due?.time, undefined);
assert.equal(s.tasks[classified.taskId!].createdFrom?.id, input.id);
assert.equal(s.tasks[classified.taskId!].originalTitle, raw, "condensed intake title keeps complete original text in task details");
assert.equal(s.tasks[classified.taskId!].owner, "me");
assert.equal(s.tasks[classified.taskId!].sessionIds.length, 0);
assert.equal(s.plans.length, 0, "due precision never silently creates a calendar slot");
assert.equal(
  Object.keys(s.collaboration!.runs).length,
  0,
  "classification is not a fake business run",
);
assert.equal(finishIntakeJob(s, job.id, classification).replayed, true);
assert.equal(Object.keys(s.tasks).length, 1);
const recorded = submitIntakeIn(s, "有个想法，TokenOps 可以做得更好");
start(s, recorded.jobId!);
assert(
  finishIntakeJob(s, recorded.jobId!, {
    source: "user_input",
    intent: "note",
    decision: "keep_note",
    reason: "目前是想法记录",
  }).ok,
);
assert.equal(Object.keys(s.tasks).length, 1);
const ambiguous = submitIntakeIn(s, "可能需要再看看");
start(s, ambiguous.jobId!);
assert(
  finishIntakeJob(s, ambiguous.jobId!, {
    source: "user_input",
    intent: "ambiguous",
    decision: "suggest_manual",
    reason: "尚未指定可交付的行动",
  }).ok,
);
assert.equal(Object.keys(s.tasks).length, 1);
const duplicate = submitIntakeIn(s, "完成 TokenOps 英文演讲稿");
start(s, duplicate.jobId!);
assert(
  finishIntakeJob(s, duplicate.jobId!, {
    source: "user_input",
    intent: "task",
    decision: "auto_create",
    reason: "明确任务",
    task: { title: "  完成 TokenOps 英文演讲稿  " },
  }).ok,
);
assert.equal(
  Object.keys(s.tasks).length,
  1,
  "only normalized exact titles can be suppressed deterministically",
);
assert.equal(s.intelligence!.classifications.at(-1)!.result.intent, "duplicate");
const semantic = submitIntakeIn(s, "准备英文稿");
start(s, semantic.jobId!);
assert.equal(
  finishIntakeJob(s, semantic.jobId!, {
    source: "user_input",
    intent: "duplicate",
    decision: "duplicate",
    reason: "语义重复",
    existingTaskId: "foreign-project-id",
  }).code,
  "DUPLICATE_INVALID",
);
assert(
  finishIntakeJob(s, semantic.jobId!, {
    source: "user_input",
    intent: "duplicate",
    decision: "duplicate",
    reason: "已引用现有任务，用户可查看",
    existingTaskId: classified.taskId,
  }).ok,
);
assert.equal(Object.keys(s.tasks).length, 1);
const failed = submitIntakeIn(s, "后天检查录音设备");
start(s, failed.jobId!);
assert(failIntelligenceJob(s, failed.jobId!, "模型不可用").ok);
const retried = retryIntakeIn(s, failed.inputId!);
assert(retried.ok);
assert.notEqual(retried.jobId, failed.jobId);
assert.equal(s.intelligence!.intakes.filter((x) => x.id === failed.inputId).length, 1);
assert.equal(
  finishIntakeJob(s, failed.jobId!, classification).code,
  "JOB_CLOSED",
  "late failed-job outputs cannot replace the retry",
);
recoverIntelligenceJobs(s);
assert.equal(s.intelligence!.intakeStates[failed.inputId!].status, "failed");
assert(s.intelligence!.intakes.some((x) => x.text === "后天检查录音设备"));
assert.throws(
  () =>
    validateTaskDue(
      { precision: "date", date: "2026-11-18", rawText: "下次有空" },
      "下次有空",
      "2026-11-16",
    ),
  /日期/,
);
assert.deepEqual(
  validateTaskDue(
    { precision: "time", date: "2026-11-17", time: "15:00", rawText: "明天下午3点" },
    "明天下午3点提交",
    "2026-11-16",
  ),
  { precision: "time", date: "2026-11-17", time: "15:00", rawText: "明天下午3点" },
);

// An AI title cannot discard the user's original constraints.
const constrained = fresh(),
  brief = submitIntakeIn(constrained, "整理泰国攻略，不安排夜间交通，预算不超过5000元");
start(constrained, brief.jobId!);
const briefResult = finishIntakeJob(constrained, brief.jobId!, {
  source: "user_input",
  intent: "task",
  decision: "auto_create",
  reason: "明确待办",
  task: { title: "整理泰国攻略" },
});
assert(briefResult.ok);
const briefContext = buildContextPackage(constrained, briefResult.taskId!);
assert(briefContext.prompt.includes("不安排夜间交通"));
assert(briefContext.prompt.includes("5000"));
assert.equal(briefContext.userInput?.id, brief.inputId);

// System analysis shares the project budget and retains unknown receipts as reservations.
const capped = fresh();
assert(
  applyCollaboration(
    capped,
    {
      projectId: capped.project.id,
      idempotencyKey: "budget",
      type: "set_policy",
      payload: { contextTokens: 1000, runTokens: 5000, projectTokens: 5000, maxAttempts: 1 },
    },
    { kind: "human" },
  ).ok,
);
const capA = submitIntakeIn(capped, "任务 A"),
  capB = submitIntakeIn(capped, "任务 B");
start(capped, capA.jobId!);
assert.equal(
  beginIntelligenceJob(capped, capB.jobId!, capped.agents[0].id).ok,
  true,
);
assert(
  failIntelligenceJob(capped, capA.jobId!, "接受状态未知", {
    actualTokens: 0,
    acceptance: "unknown",
  }).ok,
);
assert.equal(projectCommittedTokens(capped), 0, "unknown usage remains unknown, without artificial reservation");
const again = retryIntakeIn(capped, capA.inputId!);
assert.equal(beginIntelligenceJob(capped, again.jobId!, capped.agents[0].id).code, "ATTEMPT_LIMIT");
const bounded = fresh();
for (let n = 0; n < 100; n++) add(bounded, "历史任务 " + n);
for (const task of Object.values(bounded.tasks).slice(0, 4)) {
  const result = applyCollaboration(
    bounded,
    {
      projectId: bounded.project.id,
      idempotencyKey: "artifact-" + task.id,
      type: "submit",
      taskId: task.id,
      expectedVersion: bounded.collaboration!.tasks[task.id].version,
      payload: { title: task.title, body: "需要按来源检查的中文成果。".repeat(300) },
    },
    { kind: "human" },
  );
  assert(result.ok);
}
const limited = buildSummaryInput(bounded);
assert.equal(limited.coverage!.tokenBudget, null);
assert.equal(limited.coverage!.omittedTasks, 0, "summary retains all task facts without a token cap");
assert.equal(limited.blockedReason, undefined);

// Summary snapshots use a business watermark; stale model output remains historical only.
const requested = requestSummaryIn(s);
assert(requested.ok);
const started = start(s, requested.jobId!),
  fixedInput = started.input as SummaryInput;
const originalSeq = fixedInput.sourceSeq;
assert.equal(requestSummaryIn(s).jobId, requested.jobId, "one queued/running summary per project");
add(s, "检查新话筒");
assert(intelligenceSourceSeq(s) > originalSeq);
const old = finishSummaryJob(s, started.id, summary(fixedInput));
assert(old.ok && old.stale);
assert.equal(s.intelligence!.summaryVersions.length, 1);
assert.equal(s.intelligence!.latestSummaryId, undefined);
assert.equal(Object.keys(s.intelligence!.suggestions).length, 0);
assert(old.jobId, "newer business facts schedule a fresh summary");
const next = start(s, old.jobId!),
  newInput = next.input as SummaryInput;
const impossible = {
  ...summary(newInput),
  completed: [
    { text: "已完成英文稿", taskKey: classified.taskId!, factRefs: [classified.taskId!] },
  ],
};
assert.equal(
  finishSummaryJob(s, next.id, impossible).code,
  "FACT_REFERENCE_INVALID",
  "summary cannot certify an unfinished task",
);
const final = finishSummaryJob(s, next.id, summary(newInput), { actualTokens: 200 });
assert(final.ok && !final.stale);
assert.equal(s.intelligence!.summaryVersions.length, 2);
assert.equal(s.intelligence!.summaryState.status, "ready");
const pending = Object.values(s.intelligence!.suggestions).filter((x) => x.status === "pending");
assert.equal(pending.length, 2);
assert.equal(
  Object.keys(s.tasks).length,
  2,
  "suggested next actions never create tasks before confirmation",
);
const readSummary = latestSummaryForContext(s)!;
assert.equal(readSummary.id, final.summaryId);
const cseq = intelligenceSourceSeq(s);
const context = buildContextPackage(s, classified.taskId!);
assert.equal(context.summary?.id, readSummary.id);
assert(context.prompt.includes("不替代用户条件"));
assert.equal(intelligenceSourceSeq(s), cseq, "retrieval does not create summary-trigger events");
assert.equal(
  requestSummaryIn(s).jobId,
  undefined,
  "saving or reading a summary does not schedule itself again",
);
const ignore = resolveSuggestionIn(s, pending[0].id, "rejected");
assert(ignore.ok);
assert.equal(Object.keys(s.tasks).length, 2);
const accepted = resolveSuggestionIn(s, pending[1].id, "accepted");
assert(accepted.ok, accepted.message);
assert.equal(Object.keys(s.tasks).length, 3);
assert.equal(s.tasks[accepted.taskId!].createdFrom?.type, "suggestion");
assert.equal(resolveSuggestionIn(s, pending[1].id, "accepted").taskId, accepted.taskId);
const regen = requestSummaryIn(s);
const regenJob = start(s, regen.jobId!),
  regenInput = regenJob.input as SummaryInput;
assert(finishSummaryJob(s, regenJob.id, summary(regenInput)).ok);
assert.equal(
  Object.values(s.intelligence!.suggestions).filter((x) => x.status === "pending").length,
  0,
  "accepted and rejected exact action identities do not prompt again",
);
const staleRequest = requestSummaryIn(s);
assert.equal(staleRequest.jobId, undefined);
add(s, "核对客户名单");
const newRequest = requestSummaryIn(s),
  newJob = start(s, newRequest.jobId!),
  newerInput = newJob.input as SummaryInput;
assert(finishSummaryJob(s, newJob.id, summary(newerInput, ["录制演讲彩排"])).ok);
const staleSuggestion = Object.values(s.intelligence!.suggestions).find(
  (x) => x.status === "pending",
)!;
add(s, "新资料改变范围");
const numberBefore = Object.keys(s.tasks).length;
assert.equal(resolveSuggestionIn(s, staleSuggestion.id, "accepted").code, "STALE_SUGGESTION");
assert.equal(Object.keys(s.tasks).length, numberBefore);
const batch = fresh();
add(batch, "准备用户研究");
const batchRequest = requestSummaryIn(batch),
  batchJob = start(batch, batchRequest.jobId!),
  batchInput = batchJob.input as SummaryInput;
assert(
  finishSummaryJob(batch, batchJob.id, summary(batchInput, ["收集访谈问题", "发送访谈邀请"]), {
    actualTokens: 10,
  }).ok,
);
const originalPending = Object.values(batch.intelligence!.suggestions),
  originalIds = originalPending.map((x) => x.id).sort(),
  originalProposal = JSON.stringify(batch.intelligence!.suggestionEvents);
add(batch, "新增背景资料");
const refreshed = requestSummaryIn(batch),
  refreshedJob = start(batch, refreshed.jobId!),
  refreshedInput = refreshedJob.input as SummaryInput;
const refreshedSummary = summary(refreshedInput, ["收集访谈问题", "发送访谈邀请"]);
refreshedSummary.nextActions[0].factRefs = [refreshedInput.sourceEventIds[0]];
assert(finishSummaryJob(batch, refreshedJob.id, refreshedSummary, { actualTokens: 10 }).ok);
assert.deepEqual(
  Object.values(batch.intelligence!.suggestions)
    .filter((x) => x.status === "pending")
    .map((x) => x.id)
    .sort(),
  originalIds,
  "new summaries retain pending action identity",
);
assert.equal(
  JSON.stringify(batch.intelligence!.suggestionEvents.slice(0, 2)),
  originalProposal,
  "previous proposal content is append-only",
);
for (const suggestion of Object.values(batch.intelligence!.suggestions).filter(
  (x) => x.status === "pending",
)) {
  const resolved = resolveSuggestionIn(batch, suggestion.id, "accepted");
  assert(resolved.ok, resolved.message);
}
assert.equal(
  Object.values(batch.intelligence!.suggestions).filter((x) => x.status === "accepted").length,
  2,
  "multiple actions from one summary confirm without another model call",
);
assert.equal(batch.intelligence!.summaryVersions.length, 2);

const summaryHistory = JSON.stringify(s.intelligence!.summaryVersions);
recoverIntelligenceJobs(s);
assert.equal(
  JSON.stringify(s.intelligence!.summaryVersions),
  summaryHistory,
  "restart never edits past summaries",
);

(async () => {
  const memory = new Map<string, string>();
  let diskFailure = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (diskFailure) throw new Error("quota");
        memory.set(k, v);
      },
    },
  });
  const repo = new LocalWorkdeckDataSource();
  const project = (await repo.createProject({ name: "原文持久化" })).projectId!;
  const saved = await repo.submitIntake("用户原文先落盘");
  assert(saved.ok);
  const persisted = JSON.parse(memory.get(LOCAL_PROJECTS_KEY)!);
  assert.equal(persisted.projects[project].intelligence.intakes[0].text, "用户原文先落盘");
  assert.equal(Object.keys(persisted.projects[project].tasks).length, 0);
  await repo.addBlock("task", "手动创建完全独立");
  assert.equal((await repo.load()).intelligence!.intakes.length, 1);
  assert.equal(Object.keys((await repo.load()).tasks).length, 1);
  const before = await repo.load();
  diskFailure = true;
  await assert.rejects(repo.submitIntake("保存失败不能启动模型"), /未保存/);
  diskFailure = false;
  assert.deepEqual(await repo.load(), before);
  await repo.registerAgent({ id: "codex", name: "Codex", short: "Codex", color: "#556677" });
  const override = await repo.submitIntake("明天下午整理泰国攻略");
  repo.mutateRuntimeProject(project, (d) => {
    assert(beginIntelligenceJob(d, override.jobId!, "codex").ok);
  });
  const countBefore = Object.keys((await repo.load()).tasks).length,
    manualId = await repo.convertTextToTask(override.blockId!);
  repo.mutateRuntimeProject(project, (d) => {
    assert(
      finishIntakeJob(
        d,
        override.jobId!,
        {
          source: "user_input",
          intent: "task",
          decision: "auto_create",
          reason: "明确待办",
          task: { title: "整理泰国攻略" },
        },
        { actualTokens: 10 },
      ).ok,
    );
  });
  assert.equal(
    Object.keys((await repo.load()).tasks).length,
    countBefore + 1,
    "manual conversion wins over a differently titled async classification",
  );
  assert.equal(
    (await repo.load()).intelligence!.classifications.at(-1)!.result.existingTaskId,
    manualId,
  );
  const edited = await repo.submitIntake("整理第二份攻略");
  repo.mutateRuntimeProject(project, (d) => {
    assert(beginIntelligenceJob(d, edited.jobId!, "codex").ok);
  });
  await repo.updateText(edited.blockId!, "改成一条普通记录");
  repo.mutateRuntimeProject(project, (d) => {
    assert(
      finishIntakeJob(
        d,
        edited.jobId!,
        {
          source: "user_input",
          intent: "task",
          decision: "auto_create",
          reason: "旧请求",
          task: { title: "旧自动任务" },
        },
        { actualTokens: 10 },
      ).ok,
    );
  });
  assert(
    !Object.values((await repo.load()).tasks).some((task) => task.title === "旧自动任务"),
    "editing the original block invalidates automatic creation",
  );
  const restarted = new LocalWorkdeckDataSource();
  assert.equal(
    (await restarted.load()).intelligence!.intakeStates[saved.inputId!].status,
    "failed",
  );
  assert.equal((await restarted.load()).intelligence!.intakes[0].text, "用户原文先落盘");
  console.log(
    "intelligence: raw-first persistence, strict intent permissions, no fake due clocks/schedules/runs, exact/reference dedup, stale summaries, confirmed suggestions, rejection memory, restart safety, advisory context and rollback passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// AI title changes affect only the display name, with source text and edit guards intact.
{
  const s = fresh(), original = '准备一份包含用户访谈、竞品功能、价格对比、上线计划以及后续跟进安排的详细项目调研报告，并在会前核对全部信息';
  const taskId = add(s, original), goal = s.collaboration!.specs.at(-1)!.goal;
  const job = requestTaskTitleIn(s, taskId); assert(job.ok && job.jobId);
  assert.equal(requestTaskTitleIn(s, taskId).jobId, job.jobId, 'repeat click reuses pending title request');
  start(s, job.jobId!);
  assert(finishTaskTitleJob(s, job.jobId!, {title:'整理项目调研报告'}, {actualTokens:21}).ok);
  assert.equal(s.tasks[taskId].title, '整理项目调研报告');
  assert.equal(s.tasks[taskId].originalTitle, original);
  assert.equal(s.collaboration!.specs.at(-1)!.goal, goal, 'AI cannot rewrite the source goal');
  assert.equal(s.collaboration!.tasks[taskId].title, s.tasks[taskId].title);
  assert.equal(s.intelligence!.jobs[job.jobId!].actualTokens, 21);
  assert.equal(s.intelligence!.summaryState.status, 'idle', 'title job does not become summary state');
  const stale = requestTaskTitleIn(s, taskId); start(s, stale.jobId!);
  s.tasks[taskId].title = '用户自己命名'; s.tasks[taskId].titleRevision!++;
  assert(finishTaskTitleJob(s, stale.jobId!, {title:'旧的模型结果'}, {actualTokens:20}).stale);
  assert.equal(s.tasks[taskId].title, '用户自己命名');
  const invalid = requestTaskTitleIn(s, taskId); start(s, invalid.jobId!);
  assert(!finishTaskTitleJob(s, invalid.jobId!, {title:'长'.repeat(41)}, {actualTokens:10}).ok);
  assert.equal(s.tasks[taskId].title, '用户自己命名');
  failIntelligenceJob(s, invalid.jobId!, 'provider error', {actualTokens:10});
  assert.equal(s.intelligence!.summaryState.status, 'idle');
  const interrupted = requestTaskTitleIn(s, taskId); recoverIntelligenceJobs(s);
  assert.equal(s.intelligence!.jobs[interrupted.jobId!].status, 'failed');
  assert.equal(s.intelligence!.summaryState.status, 'idle');
  assert.throws(() => conciseTaskTitle('  '));
  assert.throws(() => conciseTaskTitle('first\nsecond'));
  assert.equal(Array.from(conciseTaskTitle('😀'.repeat(40))).length, 40);
  assert.throws(() => conciseTaskTitle('😀'.repeat(41)));
}
