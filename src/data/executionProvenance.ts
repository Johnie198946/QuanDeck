import type { Snapshot } from "./types";
import type { SourceReference } from "../integration/contracts";
import type { RuntimeReceipt } from "./runtimeContracts";

/** Source IDs are scoped by provider AND connection; a local chat ID is never a provider ID. */
export interface ExecutionReference {
  id: string;
  projectId: string;
  taskKey: string;
  taskId: string;
  workItemId?: string;
  agentId: string;
  tool: SourceReference["tool"];
  connectionId?: string;
  sessionId: string;
  sourceSessionId: string;
  parentSourceSessionId?: string;
  runId?: string;
  runtimeRunId?: string;
  contextPackageId?: string;
  at: string;
  provenance: "receipt" | "existing-record";
}
const keyOf = (taskId: string, itemId?: string) => (itemId ? `${taskId}::${itemId}` : taskId);
const sameSource = (a: ExecutionReference, b: ExecutionReference) =>
  a.tool === b.tool && a.connectionId === b.connectionId && a.sourceSessionId === b.sourceSessionId;

/** Called only by the trusted runtime adapter, in the same transaction as admission. */
export function recordExecutionProvenance(
  snapshot: Snapshot,
  sessionId: string,
  receipt: RuntimeReceipt,
) {
  const session = snapshot.sessions[sessionId],
    runtime = session?.runtime,
    binding = runtime?.collaboration;
  if (!session || !runtime || !binding || !snapshot.collaboration) return;
  const run = snapshot.collaboration.runs[binding.runId];
  if (
    !run ||
    binding.projectId !== snapshot.project.id ||
    runtime.projectId !== snapshot.project.id ||
    runtime.taskId !== binding.taskId ||
    runtime.workItemId !== binding.workItemId ||
    run.key !== keyOf(binding.taskId, binding.workItemId) ||
    run.contextPackageId !== binding.contextPackageId ||
    run.specRevision !== binding.specRevision ||
    run.claimEpoch !== binding.claimEpoch ||
    !receipt.sessionId?.trim() ||
    !receipt.runId?.trim() ||
    !Number.isFinite(Date.parse(receipt.acceptedAt)) ||
    receipt.connectionId !== runtime.connection.connectionId
  )
    throw new Error("执行来源与任务绑定不一致");
  const reference: ExecutionReference = {
    id: `execution:${binding.runId}`,
    projectId: snapshot.project.id,
    taskKey: run.key,
    taskId: binding.taskId,
    ...(binding.workItemId ? { workItemId: binding.workItemId } : {}),
    agentId: session.agentId,
    tool: runtime.connection.tool,
    connectionId: receipt.connectionId,
    sessionId,
    sourceSessionId: receipt.sessionId,
    runId: binding.runId,
    runtimeRunId: receipt.runId,
    contextPackageId: binding.contextPackageId,
    at: receipt.acceptedAt,
    provenance: "receipt",
  };
  const records = (snapshot.collaboration.executionLinks ??= []);
  const previous = records.find((item) => item.id === reference.id);
  if (previous) {
    if (
      new Set([...Object.keys(previous), ...Object.keys(reference)]).size &&
      [...new Set([...Object.keys(previous), ...Object.keys(reference)])].some(
        (key) =>
          previous[key as keyof ExecutionReference] !== reference[key as keyof ExecutionReference],
      )
    )
      throw new Error("执行来源已固定，不能重绑会话");
    return;
  }
  if (records.some((item) => sameSource(item, reference) && item.runId !== reference.runId))
    throw new Error("源会话已用于另一运行；新运行必须新建会话");
  records.push(reference);
}

/** One project pass, reused by ledger/index callers instead of rescanning every session per task. */
export function buildExecutionIndex(snapshot: Snapshot): Map<string, ExecutionReference[]> {
  const output = new Map<string, ExecutionReference[]>(),
    seen = new Set<string>();
  const add = (item: ExecutionReference) => {
    if (item.projectId !== snapshot.project.id) return;
    const identity = JSON.stringify([
      item.taskKey,
      item.sessionId,
      item.tool,
      item.connectionId,
      item.sourceSessionId,
    ]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const bucket = output.get(item.taskKey) ?? [];
    bucket.push({ ...item });
    output.set(item.taskKey, bucket);
  };
  for (const item of snapshot.collaboration?.executionLinks ?? []) add(item);
  for (const session of Object.values(snapshot.sessions)) {
    const runtime = session.runtime,
      binding = runtime?.collaboration;
    if (
      (binding && binding.projectId !== snapshot.project.id) ||
      (runtime && runtime.projectId !== snapshot.project.id)
    )
      continue;
    const taskId = binding?.taskId ?? runtime?.taskId ?? session.taskId;
    const workItemId = binding?.workItemId ?? runtime?.workItemId;
    const source = session.source;
    if (!taskId || !source?.sessionId) continue;
    const taskKey = keyOf(taskId, workItemId);
    if (
      runtime &&
      (session.taskId !== runtime.taskId ||
        source.tool !== runtime.connection.tool ||
        source.connectionId !== runtime.connection.connectionId)
    )
      continue;
    if (binding) {
      // Legacy managed records are evidence only when they still match the original
      // admitted run. Do not compare with today's task spec: late receipts remain valid.
      const run = snapshot.collaboration?.runs[binding.runId];
      if (
        !run ||
        runtime!.taskId !== binding.taskId ||
        runtime!.workItemId !== binding.workItemId ||
        run.key !== taskKey ||
        run.contextPackageId !== binding.contextPackageId ||
        run.specRevision !== binding.specRevision ||
        run.claimEpoch !== binding.claimEpoch ||
        !runtime!.runId?.trim() ||
        (run.sessionId && run.sessionId !== session.id)
      )
        continue;
    }
    add({
      id: `record:${session.id}`,
      projectId: snapshot.project.id,
      taskKey,
      taskId,
      workItemId,
      agentId: session.agentId,
      tool: source.tool,
      connectionId: source.connectionId,
      sessionId: session.id,
      sourceSessionId: source.childSessionId ?? source.sessionId,
      ...(source.childSessionId ? { parentSourceSessionId: source.sessionId } : {}),
      runId: binding?.runId,
      runtimeRunId: runtime?.runId,
      contextPackageId: binding?.contextPackageId,
      at: runtime?.acceptedAt ?? session.startedAt ?? session.lastActivity,
      provenance: "existing-record",
    });
  }
  for (const orchestration of Object.values(snapshot.orchestrations ?? {}))
    for (const attempt of Object.values(orchestration.attempts)) {
      const source = attempt.source;
      if (!source?.sessionId) continue;
      const taskKey = keyOf(orchestration.taskId, attempt.workItemId);
      add({
        id: `attempt:${attempt.id}`,
        projectId: snapshot.project.id,
        taskKey,
        taskId: orchestration.taskId,
        workItemId: attempt.workItemId,
        agentId: orchestration.executors[attempt.executorId]?.agentId ?? "",
        tool: source.tool,
        connectionId: source.connectionId,
        sessionId: attempt.sessionId,
        sourceSessionId: source.childSessionId ?? source.sessionId,
        ...(source.childSessionId ? { parentSourceSessionId: source.sessionId } : {}),
        at: attempt.startedAt,
        provenance: "existing-record",
      });
    }
  for (const bucket of output.values())
    bucket.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return output;
}
/** Older receipts remain labelled as existing records, never invented. */
export function taskExecutions(snapshot: Snapshot, taskKey: string): ExecutionReference[] {
  return buildExecutionIndex(snapshot).get(taskKey) ?? [];
}
