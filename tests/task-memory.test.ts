import assert from "node:assert/strict";
import { createEmptySnapshot } from "../src/data/projectStorage";
import { applyCollaboration, deriveBlackboard, hashText } from "../src/data/collaboration";
import {
  buildTaskMemoryIndex,
  getTaskMemory,
  queryTaskMemory,
  readTaskEvidence,
  taskMemoryIndexIdentity,
} from "../src/data/taskMemory";
import { recordExecutionProvenance, taskExecutions } from "../src/data/executionProvenance";
import { listIntegrationSources } from "../src/data/resultIntegration";
import type { Snapshot, Session } from "../src/data/types";
import type { RuntimeReceipt } from "../src/data/runtimeContracts";
import { SampleWorkdeckDataSource } from "../src/data/repository";
let serial = 0;
const snapshot = createEmptySnapshot({ id: "memory-project", name: "泰国旅行" });
function command(
  s: Snapshot,
  type: Parameters<typeof applyCollaboration>[1]["type"],
  payload: Record<string, unknown>,
  taskId?: string,
) {
  const r = applyCollaboration(
    s,
    {
      projectId: s.project.id,
      idempotencyKey: `memory-${++serial}`,
      type,
      taskId,
      expectedVersion: taskId ? s.collaboration?.tasks[taskId]?.version : undefined,
      payload,
    },
    { kind: "human" },
  );
  assert(r.ok, r.message);
  return r;
}
function task(title: string, body?: string) {
  const id = command(snapshot, "create_task", {
    title,
    goal: title,
    owner: "me",
    criteria: ["可追溯"],
  }).resourceId!;
  if (body) {
    const sub = command(snapshot, "submit", { title, body }, id).resourceId!;
    command(
      snapshot,
      "review",
      { submissionId: sub, verdict: "accepted", checks: [true], note: "人工核对" },
      id,
    );
  }
  return id;
}
function execution(
  taskId: string,
  connectionId: string,
  sourceSessionId: string,
  tool: "codex" | "claude" = "codex",
) {
  const now = new Date().toISOString(),
    runId = `managed-${++serial}`,
    sessionId = `local-${serial}`,
    contextPackageId = `context-${serial}`;
  snapshot.collaboration!.runs[runId] = {
    id: runId,
    key: taskId,
    executor: tool,
    purpose: "execution",
    status: "succeeded",
    specRevision: 1,
    claimEpoch: 1,
    contextPackageId,
    sessionId,
    startedAt: now,
    lastHeartbeatAt: now,
    leaseExpiresAt: now,
    reservedTokens: 100,
    actualTokens: 20,
    usageFinal: true,
  };
  const session: Session = {
    id: sessionId,
    taskId,
    agentId: tool,
    title: taskId,
    origin: "dispatch",
    status: "archived",
    startedAt: now,
    lastActivity: now,
    step: null,
    tokens: 20,
    rounds: [],
    subAgents: [],
    source: { tool, connectionId, sessionId: sourceSessionId },
    runtime: {
      dispatchId: `dispatch-${serial}`,
      runId: `driver-${serial}`,
      projectId: snapshot.project.id,
      taskId,
      connection: { tool, connectionId, projectPath: "/synthetic" },
      purpose: "execution",
      context: { taskTitle: taskId, prompt: "synthetic prompt", capturedAt: now },
      sequence: 1,
      eventIds: [],
      collaboration: {
        projectId: snapshot.project.id,
        taskId,
        runId,
        contextPackageId,
        taskVersion: 1,
        specRevision: 1,
        claimEpoch: 1,
      },
    },
  };
  snapshot.sessions[sessionId] = session;
  snapshot.tasks[taskId].sessionIds.push(sessionId);
  const receipt: RuntimeReceipt = {
    runId: session.runtime!.runId!,
    sessionId: sourceSessionId,
    connectionId,
    acceptedAt: now,
  };
  return { runId, session, receipt };
}
const transport = task(
  "泰国交通攻略",
  "曼谷机场乘机场快线进城，保留交通预算和出行条件。".repeat(60),
);
const hotel = task("泰国住宿攻略", "清迈古城住宿已核对。");
const manual = task("人工核对护照", "有效期已人工查看");
const japan = task("日本京都指南", "京都站往清水寺乘公交车。");
const first = execution(transport, "codex-account-A", "same-provider-id");
recordExecutionProvenance(snapshot, first.session.id, first.receipt);
recordExecutionProvenance(snapshot, first.session.id, first.receipt);
assert.equal(
  snapshot.collaboration!.executionLinks!.length,
  1,
  "same exact admission is idempotent",
);
const second = execution(hotel, "codex-account-B", "same-provider-id");
recordExecutionProvenance(snapshot, second.session.id, second.receipt);
const third = execution(japan, "claude-account-A", "same-provider-id", "claude");
recordExecutionProvenance(snapshot, third.session.id, third.receipt);
assert.equal(
  queryTaskMemory(snapshot, { projectId: snapshot.project.id, sourceSessionId: "same-provider-id" })
    .items.length,
  3,
  "unqualified source IDs retain all candidates",
);
assert.deepEqual(
  queryTaskMemory(snapshot, {
    projectId: snapshot.project.id,
    sourceSessionId: "same-provider-id",
    tool: "codex",
    connectionId: "codex-account-A",
  }).items.map((x) => x.key),
  [transport],
  "connection-scoped exact lookup never mixes accounts",
);
assert.deepEqual(
  queryTaskMemory(snapshot, {
    projectId: snapshot.project.id,
    sourceSessionId: "same-provider-id",
    tool: "claude",
  }).items.map((x) => x.key),
  [japan],
);
assert.equal(
  queryTaskMemory(snapshot, { projectId: "other-project", sourceSessionId: "same-provider-id" })
    .items.length,
  0,
);
for (const id of [transport, first.session.id, first.runId, first.receipt.runId])
  assert(
    queryTaskMemory(snapshot, { projectId: snapshot.project.id, query: id }).items.some(
      (x) => x.key === transport,
    ),
  );
assert.equal(getTaskMemory(snapshot, transport)!.executions[0].sourceSessionId, "same-provider-id");
assert.equal(
  getTaskMemory(snapshot, manual)!.executions.length,
  0,
  "manual task has no fake AI chat",
);
assert(getTaskMemory(snapshot, transport)!.summary.length <= 2000);
assert(getTaskMemory(snapshot, transport)!.handoff, "registered summary carries immutable handoff provenance");
assert.equal(getTaskMemory(snapshot, transport)!.summaryKind, "accepted-result");
const search = queryTaskMemory(snapshot, {
  projectId: snapshot.project.id,
  query: "泰国交通",
  limit: 1,
});
assert.equal(search.items.length, 1);
assert.equal(search.items[0].key, transport);
const artifactId = snapshot.collaboration!.tasks[transport].acceptedArtifactId!,
  artifact = snapshot.collaboration!.artifacts.find((x) => x.id === artifactId)!;
artifact.runId = first.runId;
const newer = execution(transport, "codex-account-A", "new-provider-id");
recordExecutionProvenance(snapshot, newer.session.id, newer.receipt);
const exact = listIntegrationSources(snapshot).find((x) => x.artifactId === artifactId)!;
assert.equal(
  exact.sessionId,
  first.session.id,
  "artifact provenance uses its exact historical run, never newest task chat",
);
assert.equal(exact.sourceSessionId, "same-provider-id");
const copy = readTaskEvidence(snapshot, transport, artifactId)!;
copy.body = "caller edited";
assert.notEqual(artifact.body, copy.body);
assert.equal(readTaskEvidence(snapshot, hotel, artifactId), undefined);
assert.equal(readTaskEvidence(snapshot, transport, artifactId)!.hash, hashText(artifact.body));
// Before immutable admission links existed, only fully consistent original run
// bindings may provide managed provenance. A direct run.sessionId pointer is not proof.
function legacyFixture() {
  const copy = structuredClone(snapshot);
  copy.collaboration!.executionLinks = [];
  return copy;
}
const existing = legacyFixture();
assert.equal(
  listIntegrationSources(existing).find((a) => a.artifactId === artifactId)!.sourceSessionId,
  first.receipt.sessionId,
  "valid legacy managed source remains traceable",
);
const invalidBindings: [string, (s: Snapshot) => void][] = [
  [
    "foreign project",
    (s) => {
      s.sessions[first.session.id].runtime!.projectId = "foreign";
    },
  ],
  [
    "foreign binding project",
    (s) => {
      s.sessions[first.session.id].runtime!.collaboration!.projectId = "foreign";
    },
  ],
  [
    "different task",
    (s) => {
      s.sessions[first.session.id].runtime!.taskId = hotel;
    },
  ],
  [
    "different local session task",
    (s) => {
      s.sessions[first.session.id].taskId = hotel;
    },
  ],
  [
    "different run key",
    (s) => {
      s.collaboration!.runs[first.runId].key = hotel;
    },
  ],
  [
    "different context",
    (s) => {
      s.sessions[first.session.id].runtime!.collaboration!.contextPackageId = "wrong";
    },
  ],
  [
    "different original spec",
    (s) => {
      s.sessions[first.session.id].runtime!.collaboration!.specRevision = 99;
    },
  ],
  [
    "different original epoch",
    (s) => {
      s.sessions[first.session.id].runtime!.collaboration!.claimEpoch = 99;
    },
  ],
  [
    "different source connection",
    (s) => {
      s.sessions[first.session.id].source!.connectionId = "wrong";
    },
  ],
  [
    "different source provider",
    (s) => {
      s.sessions[first.session.id].source!.tool = "claude";
    },
  ],
  [
    "different run session pointer",
    (s) => {
      s.collaboration!.runs[first.runId].sessionId = second.session.id;
    },
  ],
];
for (const [reason, mutate] of invalidBindings) {
  const broken = legacyFixture();
  mutate(broken);
  const source = listIntegrationSources(broken).find((a) => a.artifactId === artifactId)!;
  assert.equal(
    source.sourceSessionId,
    undefined,
    `${reason} must not bypass the verified execution index through a raw session fallback`,
  );
  assert(
    !taskExecutions(broken, transport).some((e) => e.sessionId === first.session.id),
    `${reason} cannot masquerade as a managed task execution`,
  );
}
const late = legacyFixture();
late.collaboration!.tasks[transport].specRevision = 2;
assert(
  taskExecutions(late, transport).some((e) => e.sessionId === first.session.id),
  "original matching spec preserves historical provenance after task requirements change",
);
recordExecutionProvenance(late, first.session.id, first.receipt);
assert.equal(
  late.collaboration!.executionLinks!.length,
  1,
  "late admission binds original run rather than current task spec",
);
const unmanaged = legacyFixture();
delete unmanaged.sessions[first.session.id].runtime;
const oldCard = getTaskMemory(unmanaged, transport)!;
assert(
  oldCard.executions.some((e) => e.sessionId === first.session.id && !e.runId),
  "legacy unmanaged sessions remain visible as task history",
);
assert.equal(
  listIntegrationSources(unmanaged).find((a) => a.artifactId === artifactId)!.sourceSessionId,
  undefined,
  "unmanaged task history cannot impersonate a managed artifact run",
);

const immutable = JSON.stringify(snapshot.collaboration!.executionLinks);
assert.throws(
  () =>
    recordExecutionProvenance(snapshot, first.session.id, {
      ...first.receipt,
      sessionId: "replacement",
    }),
  /不能重绑/,
);
assert.throws(
  () =>
    recordExecutionProvenance(snapshot, first.session.id, {
      ...first.receipt,
      connectionId: "other",
    }),
  /不一致/,
);
assert.equal(JSON.stringify(snapshot.collaboration!.executionLinks), immutable);
const reuse = execution(hotel, "codex-account-A", "same-provider-id");
assert.throws(
  () => recordExecutionProvenance(snapshot, reuse.session.id, reuse.receipt),
  /新运行必须新建/,
);
const badProject = execution(hotel, "codex-account-B", "cross-project-test");
badProject.session.runtime!.collaboration!.projectId = "foreign";
assert.throws(
  () => recordExecutionProvenance(snapshot, badProject.session.id, badProject.receipt),
  /不一致|项目/,
  "helper independently rejects cross-project binding",
);
assert(
  !taskExecutions(snapshot, hotel).some((link) => link.sessionId === badProject.session.id),
  "foreign project binding cannot become an existing-record fallback",
);
snapshot.collaboration!.executionLinks!.push({
  ...snapshot.collaboration!.executionLinks![0],
  id: "foreign-project-record",
  projectId: "foreign",
  taskKey: hotel,
  taskId: hotel,
  sessionId: "foreign-session",
});
assert(
  !taskExecutions(snapshot, hotel).some((link) => link.sessionId === "foreign-session"),
  "immutable links are still scoped by project",
);
const foreignContext = execution(hotel, "codex-account-B", "context-test");
foreignContext.session.runtime!.collaboration!.contextPackageId = "wrong-context";
assert.throws(
  () => recordExecutionProvenance(snapshot, foreignContext.session.id, foreignContext.receipt),
  /不一致|上下文/,
  "helper independently rejects wrong context binding",
);
command(snapshot, "mark_stale", { artifactId, reason: "交通班次已变更" });
assert.equal(getTaskMemory(snapshot, transport)!.stale, true);
command(snapshot, "archive_task", { reason: "保留历史" }, hotel);
assert(
  !queryTaskMemory(snapshot, { projectId: snapshot.project.id }).items.some((x) => x.key === hotel),
);
assert(
  queryTaskMemory(snapshot, { projectId: snapshot.project.id, includeArchived: true }).items.some(
    (x) => x.key === hotel,
  ),
);
const before = JSON.stringify(snapshot);
buildTaskMemoryIndex(snapshot);
deriveBlackboard(snapshot);
assert.equal(JSON.stringify(snapshot), before, "indexes and blackboard are read-only projections");
assert(taskExecutions(snapshot, transport).every((x) => x.taskId === transport));
const lazyIndex = buildTaskMemoryIndex(snapshot);
assert.equal(lazyIndex.termsBuilt, false);
queryTaskMemory(snapshot, { projectId: snapshot.project.id, query: first.runId }, lazyIndex);
assert.equal(lazyIndex.termsBuilt, false, "exact IDs bypass full evidence tokenization");
queryTaskMemory(snapshot, { projectId: snapshot.project.id, query: "曼谷机场" }, lazyIndex);
assert.equal(lazyIndex.termsBuilt, true, "keyword terms materialize only on demand");
const returned = queryTaskMemory(
  snapshot,
  { projectId: snapshot.project.id, taskKey: transport },
  lazyIndex,
);
returned.items[0].summary = "caller mutation";
returned.items[0].executions[0].sourceSessionId = "caller mutation";
const isolated = queryTaskMemory(
  snapshot,
  { projectId: snapshot.project.id, taskKey: transport },
  lazyIndex,
);
assert.notEqual(isolated.items[0].summary, "caller mutation");
assert.notEqual(isolated.items[0].executions[0].sourceSessionId, "caller mutation");
const anotherSnapshot = createEmptySnapshot({ id: "other", name: "其他项目" });
assert.equal(
  queryTaskMemory(anotherSnapshot, { projectId: "other", query: transport }, lazyIndex).total,
  0,
  "cached indexes cannot cross project or snapshot identities",
);

// Paging survives transport noise, but never mixes different business/source versions.
const pagingSnapshot = structuredClone(snapshot);
const pagingQuery = { projectId: pagingSnapshot.project.id, includeArchived: true, limit: 1 };
const pagingIndex = buildTaskMemoryIndex(pagingSnapshot);
const firstPage = queryTaskMemory(pagingSnapshot, pagingQuery, pagingIndex);
assert(firstPage.nextCursor, "synthetic project has more than one memory page");
const stableIdentity = taskMemoryIndexIdentity(pagingSnapshot);
assert.equal(stableIdentity, pagingIndex.identity);
const beforeNoise = queryTaskMemory(pagingSnapshot, { ...pagingQuery, cursor: firstPage.nextCursor });
const heartbeat = applyCollaboration(pagingSnapshot, {
  projectId: pagingSnapshot.project.id,
  type: "run_status",
  idempotencyKey: "cursor-heartbeat-noise",
  taskId: transport,
  payload: { runId: first.runId, actualTokens: 21, heartbeat: true },
}, { kind: "service" });
assert(heartbeat.ok, heartbeat.message);
pagingSnapshot.sessions[first.session.id].tokens += 100;
pagingSnapshot.sessions[first.session.id].lastActivity = "2026-01-02T00:00:00.000Z";
assert(pagingSnapshot.collaboration!.sequence > firstPage.sourceSequence);
assert.equal(taskMemoryIndexIdentity(pagingSnapshot), stableIdentity,
  "heartbeat, receipt sequence and token counters do not invalidate business memory");
const afterNoise = queryTaskMemory(pagingSnapshot,
  { ...pagingQuery, cursor: firstPage.nextCursor }, pagingIndex);
assert.deepEqual(afterNoise.items, beforeNoise.items, "heartbeat allows continuing the same page");
assert.equal(afterNoise.nextCursor, beforeNoise.nextCursor);
assert.equal(afterNoise.sourceSequence, pagingSnapshot.collaboration!.sequence,
  "raw sequence remains provenance metadata only");
command(pagingSnapshot, "revise_task", {
  goal: "核对护照及新的旅行日期", criteria: ["有效期与日期一致"], reason: "新增真实要求",
}, manual);
assert.notEqual(taskMemoryIndexIdentity(pagingSnapshot), stableIdentity);
assert.throws(() => queryTaskMemory(pagingSnapshot,
  { ...pagingQuery, cursor: firstPage.nextCursor }, pagingIndex),
  (error: unknown) => (error as { code?: string }).code === "STALE_CURSOR",
  "task requirements changing invalidate old paging, including a previously cached index");

const changedBody = structuredClone(snapshot);
const bodyIndex = buildTaskMemoryIndex(changedBody);
const bodyPage = queryTaskMemory(changedBody, pagingQuery, bodyIndex);
changedBody.collaboration!.artifacts.find(a => a.id === artifactId)!.body += "来源尾部发生变化";
assert.notEqual(taskMemoryIndexIdentity(changedBody), bodyIndex.identity,
  "full source content participates even when the short card excerpt stays unchanged");
assert.throws(() => queryTaskMemory(changedBody, { ...pagingQuery, cursor: bodyPage.nextCursor }),
  (error: unknown) => (error as { code?: string }).code === "STALE_CURSOR");
const foreignPaging = structuredClone(snapshot);
foreignPaging.project.id = "another-project-with-the-same-task-ids";
assert.notEqual(taskMemoryIndexIdentity(foreignPaging), stableIdentity,
  "identical task IDs cannot make project indexes interchangeable");
assert.throws(() => queryTaskMemory(foreignPaging, {
  ...pagingQuery, projectId: foreignPaging.project.id, cursor: firstPage.nextCursor,
}), (error: unknown) => (error as { code?: string }).code === "STALE_CURSOR");

async function verifyRepositoryCache() {
  const fixture = structuredClone(snapshot);
  const expiring = fixture.collaboration!.artifacts.find((a) => a.key === manual)!;
  const base = Date.now();
  expiring.expiresAt = new Date(base + 1000).toISOString();
  const originalNow = Date.now;
  let now = base;
  Date.now = () => now;
  try {
    const repository = new SampleWorkdeckDataSource({ snapshot: fixture, onPersist: () => {} });
    const cache = () =>
      (
        repository as unknown as {
          taskMemoryCache?: { index: ReturnType<typeof buildTaskMemoryIndex> };
        }
      ).taskMemoryCache?.index;
    const query = { projectId: fixture.project.id, taskKey: manual };
    const initial = await repository.queryTaskMemory(query);
    assert.equal(initial.items[0].stale, false);
    const firstIndex = cache();
    await repository.queryTaskMemory(query);
    assert.equal(cache(), firstIndex, "unchanged snapshot reuses derived short-card index");
    assert.equal(firstIndex?.termsBuilt, false);
    initial.items[0].title = "untrusted caller edit";
    assert.notEqual(
      (await repository.queryTaskMemory(query)).items[0].title,
      initial.items[0].title,
    );
    assert.equal(
      cache()?.validUntil,
      base + 1000,
      "expiry bounds cache lifetime before general TTL",
    );
    now = base + 1001;
    assert.equal(
      (await repository.queryTaskMemory(query)).items[0].stale,
      true,
      "expiry is reflected without any write",
    );
    assert.notEqual(cache(), firstIndex);
    const expiredIndex = cache();
    repository.mutateRuntime((s) => {
      s.collaboration!.tasks[manual].requiresRevalidation = true;
    });
    await repository.queryTaskMemory(query);
    assert.notEqual(
      cache(),
      expiredIndex,
      "a committed snapshot replacement invalidates index immediately",
    );
    const updatedIndex = cache();
    now += 5001;
    await repository.queryTaskMemory(query);
    assert.notEqual(cache(), updatedIndex, "short TTL eventually refreshes unchanged state");
    assert.equal((await repository.queryTaskMemory({ ...query, projectId: "foreign" })).total, 0);
  } finally {
    Date.now = originalNow;
  }
}
verifyRepositoryCache()
  .then(() =>
    console.log(
      "task memory: scoped IDs, compact summaries, exact immutable provenance, read-only projections, lazy terms and bounded snapshot cache passed",
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
