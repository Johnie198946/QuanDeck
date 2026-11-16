import assert from "node:assert/strict";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import {
  applyCollaboration,
  projectCommittedTokens,
  projectActiveCalls,
  type CollaborationCommand,
  type CollaborationResult,
} from "../src/data/collaboration";
import {
  beginIntelligenceJob,
  failIntelligenceJob,
  requestSummaryIn,
  submitIntakeIn,
  type IntelligenceResult,
} from "../src/data/intelligence";
import { applyIntegration, inspectIntegration } from "../src/data/resultIntegration";
import {
  IntegrationReviewRuntime,
  getIntegrationReviewState,
  recoverIntegrationReviews,
} from "../src/data/integrationReview";
import type {
  RuntimeAssistInput,
  RuntimeAssistReceipt,
  RuntimeDriver,
} from "../src/data/runtimeContracts";
import type { Snapshot } from "../src/data/types";
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  },
});
let sequence = 0;
function seed(s: Snapshot) {
  const call = (
    type: Parameters<typeof applyCollaboration>[1]["type"],
    payload: Record<string, unknown>,
    taskId?: string,
  ) => {
    const r = applyCollaboration(
      s,
      {
        projectId: s.project.id,
        idempotencyKey: `seed-${++sequence}`,
        type,
        taskId,
        expectedVersion: taskId ? s.collaboration?.tasks[taskId]?.version : undefined,
        payload,
      },
      { kind: "human" },
    );
    assert(r.ok, r.message);
    return r;
  };
  const task = call("create_task", {
    title: "泰国住宿",
    goal: "核对酒店",
    criteria: ["证据充分"],
    owner: "me",
  }).resourceId!;
  const sub = call(
    "submit",
    { title: "酒店事实", body: "第一行：曼谷入住\n第二行：清迈离店" },
    task,
  ).resourceId!;
  call(
    "review",
    { submissionId: sub, verdict: "accepted", note: "人审来源", checks: [true] },
    task,
  );
  const r = applyIntegration(s, {
    projectId: s.project.id,
    idempotencyKey: `draft-${++sequence}`,
    type: "create",
    payload: { title: "泰国总攻略", sourceIds: [s.collaboration!.tasks[task].acceptedArtifactId!] },
  });
  assert(r.ok, r.message);
  return r.draftId!;
}
class Provider implements RuntimeDriver {
  calls: RuntimeAssistInput[] = [];
  businessCalls = 0;
  hold = false;
  tokens: number | null = 25;
  mode:
    | "valid"
    | "bad-binding"
    | "bad-ref"
    | "bad-evidence"
    | "bad-receipt"
    | "extra"
    | "multiline" = "valid";
  waiting: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  subscribe = () => () => {};
  scan = async () => [];
  control = async () => {};
  async run(): Promise<never> {
    this.businessCalls++;
    throw Error("not a business run");
  }
  async assist(input: RuntimeAssistInput): Promise<RuntimeAssistReceipt> {
    this.calls.push(input);
    const schema = input.outputSchema as any,
      binding = Object.fromEntries(
        Object.entries(schema.properties.binding.properties).map(([key, value]) => [
          key,
          (value as any).const,
        ]),
      );
    const data = JSON.parse(input.prompt.split("\n只读资料：")[1]);
    const source = data.sources[0],
      section = data.revision.sections[0];
    const finding: any = {
      severity: "conflict",
      title: "检查跨天衔接",
      detail: "两个地点需核实交通时间",
      sectionIds: [section.id],
      sourceIds: [source.artifactId],
      evidence: [{ refId: source.artifactId, quote: "曼谷入住" }],
    };
    if (this.mode === "bad-binding") binding.projectId = "foreign";
    if (this.mode === "bad-ref") finding.sourceIds = ["outside-source"];
    if (this.mode === "bad-evidence")
      finding.evidence = [{ refId: source.artifactId, quote: "根本不存在的机场" }];
    if (this.mode === "multiline") finding.evidence = [{ refId: section.id, quote: section.body }];
    if (this.mode === "extra") finding.userConfirmed = true;
    const result = { overview: "只复核给定资料", findings: [finding] };
    const receipt: RuntimeAssistReceipt = {
      requestId: input.requestId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      tool: input.tool,
      sourceSessionId: `system-review-${this.calls.length}`,
      output: { schemaVersion: schema.properties.schemaVersion.const, binding, result },
      actualTokens: this.tokens,
      startedAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      contextPolicy: "new-isolated-session",
      toolPolicy: "read-only-isolated",
      budgetEnforcement: "soft",
      tokenLimit: input.maxTokens,
      budgetExceeded: false,
    };
    if (this.mode === "bad-receipt") {
      receipt.connectionId = "forged-other-provider";
      receipt.actualTokens = 0;
    }
    if (this.hold)
      await new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
    return receipt;
  }
  release() {
    for (const pending of this.waiting.splice(0)) pending.resolve();
  }
  timeout() {
    for (const pending of this.waiting.splice(0))
      pending.reject(
        Object.assign(Error("synthetic source timeout"), {
          code: "SYSTEM_TIMEOUT",
          actualTokens: null,
          acceptance: "unknown",
        }),
      );
  }
}
async function setup() {
  memory.clear();
  const base = new LocalWorkdeckDataSource(),
    projectId = (await base.createProject({ name: "旅行复核" })).projectId!;
  await base.registerAgent({ id: "codex", name: "Codex", short: "Codex", color: "#123456" });
  await base.registerAgent({
    id: "claude",
    name: "Claude",
    short: "Claude",
    color: "#654321",
    makeDefault: true,
  });
  memory.set(
    "quandeck.configured-agents.v1",
    JSON.stringify([
      { tool: "codex", connectionId: "first" },
      { tool: "claude", connectionId: "second" },
    ]),
  );
  let draft = "";
  base.mutateRuntimeProject(projectId, (s) => {
    draft = seed(s);
  });
  const driver = new Provider(),
    runtime = new IntegrationReviewRuntime(base, driver);
  return { base, projectId, draft, driver, runtime };
}
function sharedAdmissions(base: LocalWorkdeckDataSource, projectId: string) {
  let claim!: CollaborationCommand,
    summaryId = "",
    intakeId = "";
  base.mutateRuntimeProject(projectId, (s) => {
    s.collaboration!.policy.maxParallel = 1;
    const created = applyCollaboration(
      s,
      {
        projectId,
        idempotencyKey: `shared-task-${++sequence}`,
        type: "create_task",
        payload: { title: "核对交通", goal: "核对交通", criteria: ["证据充分"], owner: "agent" },
      },
      { kind: "human" },
    );
    assert(created.ok, created.message);
    claim = {
      projectId,
      idempotencyKey: `shared-claim-${++sequence}`,
      type: "claim",
      taskId: created.resourceId,
      expectedVersion: s.collaboration!.tasks[created.resourceId!].version,
      payload: { executor: "codex" },
    };
    summaryId = requestSummaryIn(s).jobId!;
    intakeId = submitIntakeIn(s, "整理旅行交通备忘").jobId!;
    assert(summaryId && intakeId);
  });
  const begin = (jobId: string) => {
    let result!: IntelligenceResult;
    base.mutateRuntimeProject(projectId, (s) => {
      result = beginIntelligenceJob(s, jobId, "codex");
    });
    return result;
  };
  const business = () => {
    let result!: CollaborationResult;
    base.mutateRuntimeProject(projectId, (s) => {
      result = applyCollaboration(s, claim, { kind: "service" });
    });
    return result;
  };
  return { summaryId, intakeId, begin, business };
}
async function main() {
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    let s = await base.load();
    assert.equal(
      driver.calls[0].connectionId,
      "first",
      "first configured connection beats starred/default agent",
    );
    assert.equal(driver.calls[0].kind, "integration");
    assert.equal(getIntegrationReviewState(s, draft).status, "ready");
    assert.equal(Object.keys(s.sessions).length, 0);
    assert.equal(Object.keys(s.collaboration!.runs).length, 0);
    assert.equal(driver.businessCalls, 0);
    assert.equal(s.integration!.reviews!.length, 1);
    assert.equal(s.integration!.reviews![0].findings[0].severity, "conflict");
    assert.equal(
      s.integration!.bundles[s.integration!.drafts[draft].bundleId].version,
      0,
      "AI advice cannot publish",
    );
    const current = inspectIntegration(s, draft);
    await assert.rejects(
      base.integrate({
        projectId,
        idempotencyKey: "publish-without-note",
        type: "publish",
        draftId: draft,
        expectedRevision: current.draft.revision,
        payload: { expectedBundleVersion: 0, reviewed: true },
      }),
      /处理说明/,
    );
    assert(
      (
        await base.integrate({
          projectId,
          idempotencyKey: "publish-reviewed",
          type: "publish",
          draftId: draft,
          expectedRevision: current.draft.revision,
          payload: {
            expectedBundleVersion: 0,
            reviewed: true,
            reviewNote: "已另行核对跨城交通，保留说明",
          },
        })
      ).ok,
    );
    runtime.stop();
  }
  for (const mode of ["bad-binding", "bad-ref", "bad-evidence", "extra"] as const) {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.mode = mode;
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    const s = await base.load();
    assert.equal(getIntegrationReviewState(s, draft).status, "failed", mode);
    assert.equal(s.integration!.reviews?.length ?? 0, 0, mode);
    assert.equal(s.integration!.versions.length, 0);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.mode = "multiline";
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    assert.equal(
      getIntegrationReviewState(await base.load(), draft).status,
      "ready",
      "valid multiline body quotes are not JSON-escaped evidence",
    );
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.mode = "bad-receipt";
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    const s = await base.load(),
      job = Object.values(s.integration!.reviewJobs!)[0];
    assert.equal(job.status, "failed");
    assert.equal(job.actualTokens, null, "unverified receipt cannot falsely settle zero usage");
    assert.equal(job.usageFinal, false);
    assert(projectCommittedTokens(s) >= job.reservedTokens);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.tokens = null;
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    const s = await base.load(),
      job = Object.values(s.integration!.reviewJobs!)[0];
    assert.equal(job.status, "succeeded");
    assert.equal(job.actualTokens, null);
    assert.equal(job.usageFinal, false);
    assert(projectCommittedTokens(s) >= job.reservedTokens);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    assert((await runtime.request(draft, projectId)).ok);
    const s = await base.load(),
      r = inspectIntegration(s, draft);
    assert(
      (
        await base.integrate({
          projectId,
          idempotencyKey: "edit-while-review",
          type: "save",
          draftId: draft,
          expectedRevision: r.draft.revision,
          payload: {
            title: r.revision.title,
            sourceIds: r.revision.sourcePins.map((p) => p.artifactId),
            sections: r.revision.sections.map((x) => ({ ...x, body: x.body + "\n增加新条件" })),
          },
        })
      ).ok,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    driver.release();
    await runtime.flush();
    assert.equal(
      getIntegrationReviewState(await base.load(), draft).status,
      "stale",
      "late review remains history, never a fresh verdict",
    );
    assert.equal((await base.load()).integration!.reviews!.length, 1);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    assert((await runtime.request(draft, projectId)).ok);
    await new Promise((resolve) => setTimeout(resolve, 0));
    base.mutateRuntimeProject(projectId, (s) => {
      const r = applyCollaboration(
        s,
        {
          projectId,
          idempotencyKey: "new-condition",
          type: "record_decision",
          payload: { kind: "constraint", text: "新增预算上限500元" },
        },
        { kind: "human" },
      );
      assert(r.ok);
    });
    driver.release();
    await runtime.flush();
    assert.equal(
      getIntegrationReviewState(await base.load(), draft).status,
      "stale",
      "new confirmed constraint fences old AI result",
    );
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    assert((await runtime.request(draft, projectId)).ok);
    await new Promise((resolve) => setTimeout(resolve, 0));
    base.mutateRuntimeProject(projectId, (s) => {
      const sourceId = inspectIntegration(s, draft).revision.sourcePins[0].artifactId;
      const r = applyCollaboration(
        s,
        {
          projectId,
          idempotencyKey: "stale-source",
          type: "mark_stale",
          payload: { artifactId: sourceId, reason: "酒店事实已过期" },
        },
        { kind: "human" },
      );
      assert(r.ok);
    });
    driver.release();
    await runtime.flush();
    assert.equal(
      getIntegrationReviewState(await base.load(), draft).status,
      "stale",
      "an invalidated source cannot keep an AI review fresh",
    );
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    assert((await runtime.request(draft, projectId)).ok);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rebooted = new LocalWorkdeckDataSource();
    const recovered = await rebooted.load();
    assert.equal(getIntegrationReviewState(recovered, draft).status, "failed");
    const job = Object.values(recovered.integration!.reviewJobs!)[0];
    assert.equal(job.usageFinal, false);
    assert.equal(job.actualTokens, null);
    assert.equal(recoverIntegrationReviews(recovered), false);
    const fresh = new IntegrationReviewRuntime(rebooted, driver);
    await fresh.flush();
    assert.equal(driver.calls.length, 1, "restart never replays admitted request");
    fresh.stop();
    driver.timeout();
    await runtime.flush();
    assert.equal((await base.load()).integration!.reviews?.length ?? 0, 0);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    await Promise.all(Array.from({ length: 6 }, () => runtime.request(draft, projectId)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = driver.calls.length,
      jobs = Object.values((await base.load()).integration!.reviewJobs!).length;
    driver.release();
    await runtime.flush();
    assert.equal(calls, 1, "simultaneous identical admissions must deduplicate");
    assert.equal(jobs, 1);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    driver.hold = true;
    const drafts = [draft];
    base.mutateRuntimeProject(projectId, (s) => {
      drafts.push(seed(s), seed(s));
    });
    const admitted = await Promise.all(drafts.map((id) => runtime.request(id, projectId)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = driver.calls.length;
    driver.release();
    await runtime.flush();
    assert(calls <= 2, "concurrent admission cannot exceed two active reviews");
    assert(admitted.some((r) => !r.ok));
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    base.mutateRuntimeProject(projectId, (s) => {
      s.collaboration!.policy.projectTokens = 1;
    });
    assert(!(await runtime.request(draft, projectId)).ok);
    assert.equal(driver.calls.length, 0);
    assert.equal(Object.keys((await base.load()).integration!.reviewJobs ?? {}).length, 0);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    for (let i = 0; i < 3; i++) {
      assert((await runtime.request(draft, projectId)).ok);
      await runtime.flush();
    }
    assert(!(await runtime.request(draft, projectId)).ok);
    assert.equal(driver.calls.length, 3);
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    memory.set(
      "quandeck.configured-agents.v1",
      JSON.stringify([
        { tool: "missing", connectionId: "not-first" },
        { tool: "codex", connectionId: "second-valid" },
      ]),
    );
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    assert.equal(driver.calls.length, 0, "unsupported first agent never silently falls back");
    assert.equal(getIntegrationReviewState(await base.load(), draft).status, "failed");
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    const admissions = sharedAdmissions(base, projectId);
    driver.hold = true;
    const first = await runtime.request(draft, projectId);
    assert(first.ok);
    assert.equal(projectActiveCalls(await base.load()), 1);
    assert.equal(
      admissions.begin(admissions.summaryId).code,
      "PARALLEL_LIMIT",
      "review blocks summary admission",
    );
    assert.equal(
      admissions.begin(admissions.intakeId).code,
      "PARALLEL_LIMIT",
      "review blocks intake admission",
    );
    assert.equal(admissions.business().code, "PARALLEL_LIMIT", "review blocks business admission");
    const replay = await runtime.request(draft, projectId);
    assert(
      replay.ok && replay.jobId === first.jobId,
      "same review replays at full shared capacity",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    driver.release();
    await runtime.flush();
    assert.equal(projectActiveCalls(await base.load()), 0);
    assert(admissions.begin(admissions.summaryId).ok, "completed review releases shared capacity");
    runtime.stop();
  }
  for (const firstKind of ["summary", "intake"] as const) {
    const { base, projectId, draft, driver, runtime } = await setup();
    const admissions = sharedAdmissions(base, projectId),
      jobId = firstKind === "summary" ? admissions.summaryId : admissions.intakeId;
    assert(admissions.begin(jobId).ok);
    assert(
      admissions.begin(jobId).replayed,
      "same intelligence job replays at full shared capacity",
    );
    assert.equal(
      admissions.business().code,
      "PARALLEL_LIMIT",
      `${firstKind} blocks business admission`,
    );
    assert(
      !(await runtime.request(draft, projectId)).ok,
      `${firstKind} blocks result review admission`,
    );
    assert.equal(driver.calls.length, 0);
    base.mutateRuntimeProject(projectId, (s) => {
      assert(failIntelligenceJob(s, jobId, "已结束测试调用", { actualTokens: 0 }).ok);
    });
    assert(
      (await runtime.request(draft, projectId)).ok,
      `${firstKind} terminal state releases shared capacity`,
    );
    await runtime.flush();
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    const admissions = sharedAdmissions(base, projectId),
      claimed = admissions.business();
    assert(claimed.ok);
    assert(admissions.business().replayed, "same claim replays at full shared capacity");
    for (const status of [
      "queued",
      "running",
      "waiting_input",
      "waiting_permission",
      "paused",
    ] as const) {
      base.mutateRuntimeProject(projectId, (s) => {
        s.collaboration!.runs[claimed.resourceId!].status = status;
      });
      assert.equal(projectActiveCalls(await base.load()), 1, `${status} keeps its project slot`);
      assert.equal(
        admissions.begin(admissions.summaryId).code,
        "PARALLEL_LIMIT",
        `${status} business blocks summary`,
      );
      assert.equal(
        admissions.begin(admissions.intakeId).code,
        "PARALLEL_LIMIT",
        `${status} business blocks intake`,
      );
      assert(
        !(await runtime.request(draft, projectId)).ok,
        `${status} business blocks result review`,
      );
    }
    assert.equal(driver.calls.length, 0);
    for (const status of ["succeeded", "failed", "cancelled", "lost"] as const) {
      base.mutateRuntimeProject(projectId, (s) => {
        s.collaboration!.runs[claimed.resourceId!].status = status;
      });
      assert.equal(projectActiveCalls(await base.load()), 0, `${status} releases its project slot`);
    }
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    runtime.stop();
  }
  {
    const { base, projectId, draft, driver, runtime } = await setup();
    assert((await runtime.request(draft, projectId)).ok);
    await runtime.flush();
    const reserved = Object.values((await base.load()).integration!.reviewJobs!)[0].reservedTokens;
    base.mutateRuntimeProject(projectId, s => {
      s.collaboration!.policy.contextTokens = reserved - 2999;
      s.collaboration!.policy.runTokens = reserved - 2999;
    });
    const runLimited = await runtime.request(draft, projectId);
    assert(!runLimited.ok && runLimited.message?.includes('单次运行预算'));
    base.mutateRuntimeProject(projectId, s => {
      s.collaboration!.policy.contextTokens = 256;
      s.collaboration!.policy.runTokens = 20000;
    });
    const contextLimited = await runtime.request(draft, projectId);
    assert(!contextLimited.ok && contextLimited.message?.includes('上下文预算'));
    assert.equal(driver.calls.length, 1, 'per-call/context budget failures never start a provider request');
    runtime.stop();
  }
  console.log(
    "integration review: first provider, strict receipts/evidence, stale fencing, no business sessions, unknown budget, restart safety, shared admission limits and idempotency passed",
  );
}
void main();
