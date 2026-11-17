import type { Snapshot } from "./types";
import { deriveDeliveryMap } from "./goalDelivery";
import { receiptForSlot } from "./deliveryContract";
import { presentResult, taskResultEntries, type PresentedResult } from "./resultPresentation";
import { workBranch } from "./results";

export type DeliverySlot = ReturnType<typeof deriveDeliveryMap>["slots"][number];
export type DeliveryScope = { taskId?: string; workItemId?: string };
export const DELIVERY_STATE: Record<DeliverySlot["state"], string> = {
  empty: "等待交付",
  running: "正在完成",
  blocked: "等待条件",
  candidate: "候选成果",
  accepted: "已验收",
  changes_requested: "待修改",
  stale: "需要更新",
};

/** Read-only projection. Parent and child inventories never share completion totals. */
export function deliveryPresentation(snapshot: Snapshot, scope: DeliveryScope = {}) {
  const all = deriveDeliveryMap(snapshot, { allScopes: true });
  const orchestration = scope.taskId ? snapshot.orchestrations?.[scope.taskId] : undefined;
  const branch = scope.workItemId
    ? new Set(
        orchestration
          ? workBranch(orchestration, scope.workItemId).map((item) => item.id)
          : [scope.workItemId],
      )
    : null;
  const belongs = (item: { taskId: string; workItemId?: string }) =>
    item.taskId === scope.taskId && (!branch || (!!item.workItemId && branch.has(item.workItemId)));
  const plans = all.plans.filter((plan) =>
    !scope.taskId
      ? plan.scope === "project"
      : plan.slots.some(belongs) || (plan.scope === "task" && plan.tasks.some(belongs)),
  );
  const planIds = new Set(plans.map((plan) => plan.id));
  const slots = all.slots.filter(
    (slot) =>
      !slot.retired &&
      planIds.has(slot.planId) &&
      (!scope.taskId || slot.taskId === scope.taskId) &&
      (!branch || (!!slot.workItemId && branch.has(slot.workItemId))),
  );
  const usedOutputs = new Set(slots.map((slot) => slot.artifact?.outputId).filter(Boolean));
  const history: { taskId: string; taskTitle: string; entry: PresentedResult }[] = [];
  // Unmapped task records remain available in that task, never inflate a project's final output map.
  if (scope.taskId && snapshot.tasks[scope.taskId]) {
    const seen = new Set<string>();
    for (const entry of taskResultEntries(snapshot, scope.taskId, scope.workItemId ?? null)) {
      if (
        (entry.record.outputId && usedOutputs.has(entry.record.outputId)) ||
        seen.has(entry.record.id)
      )
        continue;
      seen.add(entry.record.id);
      history.push({ taskId: scope.taskId, taskTitle: snapshot.tasks[scope.taskId].title, entry });
    }
  }
  history.sort((a, b) => b.entry.record.at.localeCompare(a.entry.record.at));
  const required = slots.filter((slot) => slot.contract?.required !== false);
  const filled = required.filter(
    (slot) => slot.state === "candidate" || slot.state === "accepted",
  ).length;
  const tasks = Object.values(snapshot.tasks).map((task) => ({
    taskId: task.id,
    title: task.title,
  }));
  return {
    plans,
    slots,
    history,
    total: required.length,
    optional: slots.length - required.length,
    filled,
    tasks,
    assembly: (!filled ? "empty" : filled === required.length ? "assembled" : "partial") as
      | "empty"
      | "partial"
      | "assembled",
    accepted: required.filter((slot) => slot.state === "accepted").length,
    contributions: all.slots.filter((slot) => !slot.retired),
  };
}

/** Strict contracts display their own verified item, never a duplicated submission summary. */
export function deliverySlotEntry(snapshot: Snapshot, slot: DeliverySlot): PresentedResult | null {
  const artifact = slot.artifact;
  if (!artifact) return null;
  const receipt = receiptForSlot(artifact, slot);
  if (slot.contract && !receipt) return null;
  const attachments = receipt
    ? artifact.attachments?.filter((file) => file.id === receipt.attachmentId)
    : artifact.attachments;
  const record = {
    id: `artifact:${artifact.id}:${slot.id}`,
    outputId: artifact.outputId,
    title: receipt ? slot.title : artifact.title,
    text: receipt ? (receipt.body ?? receipt.textBody ?? "") : artifact.body,
    at: artifact.createdAt,
    itemId: slot.workItemId,
    origin: artifact.runId ? ("agent" as const) : ("human" as const),
    links: receipt ? [] : artifact.links,
    attachments,
    sessionId: slot.sourceSessionId,
  };
  return {
    ...presentResult(snapshot, slot.taskId, record, slot.state !== "accepted"),
    status: slot.state === "accepted" ? "已确认" : slot.state === "stale" ? "需重新核对" : "待核对",
  };
}

export const deliverySlotKey = (slot: Pick<DeliverySlot, "planId" | "id">) =>
  JSON.stringify([slot.planId, slot.id]);
export function deliverySlotDepth(slot: DeliverySlot, slots: DeliverySlot[]) {
  let depth = 0,
    current = slot;
  const seen = new Set([slot.id]);
  while (current.parentId && !seen.has(current.parentId)) {
    const parent = slots.find(
      (item) => item.planId === slot.planId && item.id === current.parentId,
    );
    if (!parent) break;
    seen.add(parent.id);
    current = parent;
    depth++;
  }
  return Math.min(depth, 3);
}
export function deliveryRelations(slot: DeliverySlot, slots: DeliverySlot[]) {
  return {
    sources: slots.filter((item) => slot.contributionIds?.includes(item.id)),
    targets: slots.filter((item) => item.contributionIds?.includes(slot.id)),
  };
}

/** Publication is a separate immutable record, scoped to the map being read. */
export function deliverySlotPublication(
  snapshot: Snapshot,
  slot: DeliverySlot,
  scope: DeliveryScope = {},
) {
  const scopeKey = scope.workItemId
    ? `task:${scope.taskId}:work:${scope.workItemId}`
    : scope.taskId
      ? `task:${scope.taskId}`
      : "project";
  const bundle = Object.values(snapshot.integration?.bundles ?? {}).find(
    (item) => item.deliveryScopeKey === scopeKey,
  );
  const version = snapshot.integration?.versions.find(
    (item) => item.id === bundle?.publishedVersionId,
  );
  const item = version?.deliveryPublication?.items.find((item) => item.slotId === slot.id);
  if (!version || !item) return undefined;
  const receipt = receiptForSlot(slot.artifact, slot);
  return {
    version: version.version,
    current:
      item.title === slot.title &&
      item.artifactId === slot.artifact?.id &&
      item.receipt?.contentHash === receipt?.contentHash &&
      item.contract.revision === slot.contract?.revision &&
      slot.state === "accepted",
  };
}
