import type { Snapshot } from "./types";
import type { DeliverySlot, DeliverySlotDraft, GoalPlanVersion } from "./goalDelivery";
import { hashText, stableContent } from "./contentHash";
import { defaultDeliveryContract, readDeliveryContract } from "./deliveryContract";
export type DeliveryChangeOperation =
  | { type: "add"; slot: DeliverySlotDraft }
  | { type: "update"; slotId: string; patch: Partial<DeliverySlotDraft> }
  | { type: "cancel"; slotId: string }
  | { type: "replace" | "split" | "merge"; slotIds: string[]; slots: DeliverySlotDraft[] };
export interface DeliveryChangeInput {
  planId: string;
  taskId?: string;
  workItemId?: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
  operations: DeliveryChangeOperation[];
}
export interface DeliveryChangeResult {
  ok: boolean;
  code?: string;
  message?: string;
  planId: string;
  baseVersion: number;
  nextVersion: number;
  version?: number;
  slots: DeliverySlot[];
  addedIds: string[];
  changedIds: string[];
  retiredIds: string[];
  affectedTaskKeys: string[];
  invalidatedArtifactIds: string[];
  replayed?: boolean;
}
function failure(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
const definition = (s: DeliverySlot) =>
  stableContent({
    title: s.title,
    description: s.description,
    taskKey: s.taskKey,
    parentId: s.parentId,
    contributionIds: s.contributionIds ?? [],
    contract: s.contract ? { ...s.contract, revision: 0 } : undefined,
    retired: !!s.retired,
  });
function changePlan(snapshot: Snapshot, input: DeliveryChangeInput): GoalPlanVersion | undefined {
  const current = snapshot.collaboration?.goalPlans?.[input.planId]?.at(-1);
  if (current) return current;
  if (input.expectedVersion !== 0 || !input.taskId) return;
  const key = input.workItemId ? `${input.taskId}::${input.workItemId}` : input.taskId,
    task = snapshot.collaboration?.tasks[key];
  if (input.planId !== `delivery:${key}` || !task || task.archived)
    failure("SCOPE_MISMATCH", "新交付清单必须绑定当前任务");
  return {
    id: input.planId,
    title: task.title,
    scope: "task",
    taskId: task.taskId,
    version: 0,
    draftVersion: 0,
    at: new Date().toISOString(),
    contractSchema: 1,
    standalone: true,
    tasks: [
      {
        key: task.key,
        taskId: task.taskId,
        workItemId: task.workItemId,
        draftKey: task.key,
        specRevision: task.specRevision,
      },
    ],
    slots: [],
  };
}
/** Creates a delivery definition only; it never approves a direction or starts execution. */
export function ensureTaskDeliveryPlan(
  snapshot: Snapshot,
  taskId: string,
  workItemId?: string,
): string {
  const planId = `delivery:${workItemId ? `${taskId}::${workItemId}` : taskId}`;
  const plan = changePlan(snapshot, {
    planId,
    taskId,
    workItemId,
    expectedVersion: 0,
    idempotencyKey: "definition",
    reason: "定义任务交付",
    operations: [],
  });
  if (!plan) failure("NOT_FOUND", "任务不存在");
  const c = snapshot.collaboration!;
  c.goalPlans ??= {};
  c.goalPlans[planId] ??= [plan];
  return planId;
}
function preview(snapshot: Snapshot, input: DeliveryChangeInput): DeliveryChangeResult {
  const c = snapshot.collaboration,
    plan = changePlan(snapshot, input);
  if (!plan) failure("NOT_FOUND", "交付清单不存在");
  if (plan.version !== input.expectedVersion)
    failure("VERSION_CONFLICT", "交付清单已变化，请刷新后重新核对影响");
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    typeof input.idempotencyKey !== "string" ||
    !/^[a-zA-Z0-9_:.\-]{1,160}$/.test(input.idempotencyKey)
  )
    failure("INVALID_CHANGE", "变更需要理由和有效请求标识");
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 100)
    failure("INVALID_CHANGE", "变更操作应为1–100项");
  const slots = structuredClone(plan.slots),
    at = new Date().toISOString(),
    addedIds: string[] = [],
    retiredIds: string[] = [],
    touched = new Set<string>();
  const current = (id: string) => {
    const s = slots.find((s) => s.id === id && !s.retired);
    if (!s) failure("NOT_FOUND", "交付件不存在或已取消");
    return s;
  };
  const add = (raw: DeliverySlotDraft) => {
    if (
      !raw ||
      Object.keys(raw).some(
        (k) =>
          ![
            "id",
            "title",
            "taskKey",
            "description",
            "parentId",
            "contract",
            "contributionIds",
          ].includes(k),
      ) ||
      typeof raw.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) ||
      slots.some((s) => s.definitionId === raw.id || s.id === raw.id)
    )
      failure("DUPLICATE_DELIVERY", "交付件标识重复或无效");
    const task = plan.tasks.find((t) => t.key === raw.taskKey || t.draftKey === raw.taskKey);
    if (!task) failure("SCOPE_MISMATCH", "负责的任务不属于本清单");
    if (
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title.length > 200 ||
      (raw.description !== undefined &&
        (typeof raw.description !== "string" || raw.description.length > 2000))
    )
      failure("INVALID_CHANGE", "交付名称或说明无效");
    const contract = readDeliveryContract(raw.contract ?? defaultDeliveryContract(raw.description));
    contract.revision = 1;
    const s: DeliverySlot = {
      ...raw,
      id: `slot-${hashText(`${plan.id}:${raw.id}`).slice(0, 24)}`,
      definitionId: raw.id,
      planId: plan.id,
      taskKey: task.key,
      taskId: task.taskId,
      workItemId: task.workItemId,
      contract,
    };
    slots.push(s);
    addedIds.push(s.id);
    return s;
  };
  const retire = (id: string, replacements: string[]) => {
    const s = current(id);
    if (touched.has(id)) failure("DUPLICATE_CHANGE", "同一交付件不能在一个变更中重复修改");
    touched.add(id);
    s.retired = { reason: input.reason.trim(), at, replacementIds: replacements };
    retiredIds.push(id);
  };
  for (const op of input.operations) {
    if (!op || typeof op !== "object") failure("INVALID_CHANGE", "变更操作无效");
    if (op.type === "add") add(op.slot);
    else if (op.type === "update") {
      const s = current(op.slotId);
      if (touched.has(s.id)) failure("DUPLICATE_CHANGE", "同一交付件不能重复修改");
      touched.add(s.id);
      if (
        !op.patch ||
        Object.keys(op.patch).some(
          (k) =>
            ![
              "title",
              "description",
              "taskKey",
              "parentId",
              "contract",
              "contributionIds",
            ].includes(k),
        )
      )
        failure("INVALID_CHANGE", "只能修改名称、要求、负责任务、贡献与契约");
      const task = op.patch.taskKey
        ? plan.tasks.find((t) => t.key === op.patch.taskKey || t.draftKey === op.patch.taskKey)
        : plan.tasks.find((t) => t.key === s.taskKey);
      if (!task) failure("SCOPE_MISMATCH", "负责的任务不属于本清单");
      Object.assign(s, op.patch, {
        taskKey: task.key,
        taskId: task.taskId,
        workItemId: task.workItemId,
      });
      if (
        typeof s.title !== "string" ||
        !s.title.trim() ||
        s.title.length > 200 ||
        (s.description !== undefined &&
          (typeof s.description !== "string" || s.description.length > 2000))
      )
        failure("INVALID_CHANGE", "交付名称或说明无效");
      s.contract = readDeliveryContract(s.contract ?? defaultDeliveryContract(s.description));
    } else if (op.type === "cancel") retire(op.slotId, []);
    else if (["replace", "split", "merge"].includes(op.type)) {
      const multi = op as Extract<DeliveryChangeOperation, { type: "replace" | "split" | "merge" }>;
      if (
        !Array.isArray(multi.slotIds) ||
        !Array.isArray(multi.slots) ||
        !multi.slotIds.length ||
        !multi.slots.length ||
        new Set(multi.slotIds).size !== multi.slotIds.length ||
        (op.type === "split" && (multi.slotIds.length !== 1 || multi.slots.length < 2)) ||
        (op.type === "merge" && (multi.slotIds.length < 2 || multi.slots.length !== 1))
      )
        failure("INVALID_CHANGE", "替代、拆分或合并的数量无效");
      multi.slotIds.forEach(current);
      const added = multi.slots.map(add);
      multi.slotIds.forEach((id) =>
        retire(
          id,
          added.map((s) => s.id),
        ),
      );
    } else failure("INVALID_CHANGE", "不支持的变更操作");
  }
  const changedIds: string[] = [];
  for (const s of slots.filter((s) => !s.retired)) {
    const old = plan.slots.find((x) => x.id === s.id);
    s.contract = readDeliveryContract(s.contract ?? defaultDeliveryContract(s.description));
    const changed = !!old && definition(s) !== definition(old);
    s.contract.revision = old?.contract
      ? changed
        ? old.contract.revision + 1
        : old.contract.revision
      : 1;
    if (changed) changedIds.push(s.id);
  }
  const active = slots.filter((s) => !s.retired),
    all = new Map(
      Object.values(c!.goalPlans ?? {})
        .flatMap((v) => v.at(-1)?.slots ?? [])
        .filter((s) => !s.retired)
        .map((s) => [s.id, s]),
    );
  plan.slots.forEach((s) => all.delete(s.id));
  active.forEach((s) => all.set(s.id, s));
  for (const s of active) {
    if (s.parentId && !all.has(s.parentId)) failure("INVALID_GRAPH", "上级交付件不存在或已取消");
    if (
      s.contributionIds !== undefined &&
      (!Array.isArray(s.contributionIds) ||
        s.contributionIds.length > 100 ||
        new Set(s.contributionIds).size !== s.contributionIds.length ||
        s.contributionIds.some((id) => typeof id !== "string" || !all.has(id)))
    )
      failure("INVALID_GRAPH", "贡献来源不存在、重复或已取消");
  }
  const visit = (id: string, path: Set<string>) => {
    if (path.has(id)) failure("INVALID_GRAPH", "交付贡献关系不能循环");
    const next = new Set([...path, id]);
    for (const dep of [
      ...(all.get(id)?.contributionIds ?? []),
      ...(all.get(id)?.parentId ? [all.get(id)!.parentId!] : []),
    ])
      visit(dep, next);
  };
  active.forEach((s) => visit(s.id, new Set()));
  // Downstream references must be explicitly changed in the same project transaction.
  for (const s of all.values())
    if ((s.contributionIds ?? []).some((id) => retiredIds.includes(id)))
      failure("DEPENDENT_DELIVERY", "其他交付件仍引用被取消项，请先更新其贡献关系");
  const affectedTaskKeys = [
    ...new Set(
      [...slots, ...plan.slots]
        .filter((s) => [...addedIds, ...changedIds, ...retiredIds].includes(s.id))
        .map((s) => s.taskKey),
    ),
  ];
  const invalidatedArtifactIds = c!.artifacts
    .filter((a) => affectedTaskKeys.includes(a.key))
    .map((a) => a.id);
  return {
    ok: true,
    planId: plan.id,
    baseVersion: plan.version,
    nextVersion: plan.version + 1,
    slots,
    addedIds,
    changedIds,
    retiredIds,
    affectedTaskKeys,
    invalidatedArtifactIds,
  };
}
export function previewDeliveryChange(
  snapshot: Snapshot,
  input: DeliveryChangeInput,
): DeliveryChangeResult {
  try {
    return preview(snapshot, input);
  } catch (e) {
    const x = e as Error & { code?: string };
    return {
      ok: false,
      code: x.code ?? "INVALID_CHANGE",
      message: x.message,
      planId: input?.planId,
      baseVersion: input?.expectedVersion,
      nextVersion: input?.expectedVersion,
      slots: [],
      addedIds: [],
      changedIds: [],
      retiredIds: [],
      affectedTaskKeys: [],
      invalidatedArtifactIds: [],
    };
  }
}
/** Caller must run this inside the authenticated human command transaction. */
export function applyDeliveryChange(
  snapshot: Snapshot,
  input: DeliveryChangeInput,
): DeliveryChangeResult {
  const c = snapshot.collaboration;
  if (!c) return previewDeliveryChange(snapshot, input);
  const receiptKey = `delivery-change:${input.idempotencyKey}`,
    fingerprint = hashText(stableContent(input)),
    existing = c.receipts[receiptKey];
  if (existing)
    return existing.fingerprint === fingerprint
      ? { ...(existing.result as unknown as DeliveryChangeResult), replayed: true }
      : {
          ...previewDeliveryChange(snapshot, input),
          ok: false,
          code: "IDEMPOTENCY_CONFLICT",
          message: "请求标识已经用于另一项变更",
        };
  const result = previewDeliveryChange(snapshot, input);
  if (!result.ok) return result;
  const previous = changePlan(snapshot, input)!;
  c.goalPlans ??= {};
  const versions = (c.goalPlans[input.planId] ??= []);
  const next: GoalPlanVersion = {
    ...structuredClone(previous),
    version: result.nextVersion,
    at: new Date().toISOString(),
    contractSchema: 1,
    slots: result.slots,
  };
  versions.push(next);
  const stale = new Set(result.invalidatedArtifactIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of c.artifacts)
      if (!stale.has(a.id) && a.sourceIds.some((id) => stale.has(id))) {
        stale.add(a.id);
        changed = true;
      }
  }
  for (const id of stale) c.freshness[id] = "stale";
  for (const task of Object.values(c.tasks))
    if (
      result.affectedTaskKeys.includes(task.key) ||
      (task.acceptedArtifactId && stale.has(task.acceptedArtifactId))
    ) {
      if (c.artifacts.some((a) => a.key === task.key && stale.has(a.id)))
        task.requiresRevalidation = true;
      task.version++;
    }
  if (c.goalAutomation?.[input.planId]) c.goalAutomation[input.planId].enabled = false;
  c.events.push({
    id: `delivery-change:${input.idempotencyKey}`,
    sequence: ++c.sequence,
    type: "delivery_contract_changed",
    actor: "human",
    at: next.at,
    detail: JSON.stringify({
      planId: next.id,
      previousVersion: previous.version,
      version: next.version,
      reason: input.reason.trim(),
      addedIds: result.addedIds,
      changedIds: result.changedIds,
      retiredIds: result.retiredIds,
      invalidatedArtifactIds: [...stale],
    }),
  });
  result.version = next.version;
  result.invalidatedArtifactIds = [...stale];
  c.receipts[receiptKey] = { fingerprint, result: structuredClone(result) };
  return result;
}
