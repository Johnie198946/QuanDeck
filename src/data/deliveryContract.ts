import type { Snapshot } from "./types";
import type { CollaborationArtifact } from "./collaboration";
import type {
  DeliverySlot,
  DeliverySlotDraft,
  GoalPlanVersion,
  GoalTaskBinding,
} from "./goalDelivery";
import { hashText, stableContent } from "./contentHash";

export interface DeliveryContract {
  revision: number;
  kind: "text" | "file";
  format: string;
  required: boolean;
  criteria: string[];
  purpose?: "deliverable" | "project_spec";
}
export interface DeliveryItemInput {
  slotId: string;
  contractRevision: number;
  body?: string;
  attachmentId?: string;
  path?: string;
  name?: string;
}
/** Trusted transport evidence. This is never accepted inside an Agent payload. */
export interface VerifiedDeliveryFile {
  attachmentId: string;
  name: string;
  bytes: number;
  sha256: string;
  mimeType?: string;
  verifiedAt: string;
  path?: string;
  storagePath?: string;
  textBody?: string;
}
export interface DeliveryReceipt extends DeliveryItemInput {
  kind: "text" | "file";
  format: string;
  contentHash: string;
  bytes: number;
  verifiedAt: string;
  fileName?: string;
  textBody?: string;
}
function fail(message: string, code = "DELIVERY_INVALID"): never {
  throw Object.assign(new Error(message), { code });
}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
export function readDeliveryContract(value: unknown): DeliveryContract {
  if (
    !plain(value) ||
    Object.keys(value).some(
      (k) => !["revision", "kind", "format", "required", "criteria", "purpose"].includes(k),
    )
  )
    fail("交付契约字段无效");
  if (
    !["text", "file"].includes(String(value.kind)) ||
    !string(value.format, 80) ||
    !/^[a-z0-9.+_-]+$/i.test(String(value.format)) ||
    typeof value.required !== "boolean" ||
    !Array.isArray(value.criteria) ||
    value.criteria.length > 30 ||
    !value.criteria.every((x) => string(x, 2000)) ||
    (value.purpose !== undefined &&
      !["deliverable", "project_spec"].includes(String(value.purpose)))
  )
    fail("交付契约类型、格式或验收条件无效");
  if (
    value.revision !== undefined &&
    (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
  )
    fail("交付契约版本无效");
  return {
    revision: Number(value.revision ?? 1),
    kind: value.kind as DeliveryContract["kind"],
    format: String(value.format).toLowerCase(),
    required: value.required,
    criteria: [...value.criteria] as string[],
    purpose: value.purpose as DeliveryContract["purpose"],
  };
}
export const defaultDeliveryContract = (description?: string): DeliveryContract => ({
  revision: 1,
  kind: "text",
  format: "markdown",
  required: true,
  criteria: [description?.trim() || "交付内容完整且符合当前任务要求"],
  purpose: "deliverable",
});
export function currentDeliverySlots(snapshot: Snapshot, key?: string): DeliverySlot[] {
  return Object.values(snapshot.collaboration?.goalPlans ?? {})
    .flatMap((v) => v.at(-1)?.slots ?? [])
    .filter((s) => !s.retired && (!key || s.taskKey === key));
}
export function receiptForSlot(
  artifact: CollaborationArtifact | undefined,
  slot: DeliverySlot,
): DeliveryReceipt | undefined {
  return artifact?.deliveryReceipts?.find(
    (r) =>
      r.slotId === slot.id &&
      r.contractRevision === slot.contract?.revision &&
      r.kind === slot.contract.kind &&
      r.format === slot.contract.format,
  );
}
export function validateDeliveryItems(
  snapshot: Snapshot,
  key: string,
  value: unknown,
  files: VerifiedDeliveryFile[] = [],
  at = new Date().toISOString(),
): DeliveryReceipt[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail("逐件交付必须为至多100项的列表");
  const slots = currentDeliverySlots(snapshot, key),
    seen = new Set<string>();
  return value.map((raw) => {
    if (
      !plain(raw) ||
      Object.keys(raw).some(
        (k) => !["slotId", "contractRevision", "body", "attachmentId", "path", "name"].includes(k),
      ) ||
      !string(raw.slotId, 240) ||
      !Number.isSafeInteger(raw.contractRevision)
    )
      fail("逐件交付只允许位置、契约版本和正文或附件引用");
    const id = String(raw.slotId);
    if (seen.has(id)) fail("同一交付件不能重复提交");
    seen.add(id);
    const slot = slots.find((s) => s.id === id);
    if (!slot?.contract) fail("交付件不属于当前任务的有效契约", "SCOPE_MISMATCH");
    const contract = slot.contract;
    if (raw.contractRevision !== contract.revision)
      fail("交付契约已变化，请按当前版本重新交付", "DELIVERY_CONTRACT_CHANGED");
    if (contract.kind === "text") {
      if (
        raw.attachmentId !== undefined ||
        raw.path !== undefined ||
        raw.name !== undefined ||
        !string(raw.body, 200000)
      )
        fail(`${slot.title}需要独立、非空的正文`);
      const body = String(raw.body);
      if (contract.format === "json") {
        try {
          JSON.parse(body);
        } catch {
          fail(`${slot.title}不是有效JSON`);
        }
      }
      if (
        contract.format === "html" &&
        !/<(?:!doctype\s+html|html|article|main|section|table|div|p|h[1-6])(?:\s|>)/i.test(body)
      )
        fail(`${slot.title}不是有效HTML正文`);
      return {
        slotId: id,
        contractRevision: contract.revision,
        kind: contract.kind,
        format: contract.format,
        body,
        contentHash: hashText(body),
        bytes: new TextEncoder().encode(body).length,
        verifiedAt: at,
      };
    }
    if (
      raw.body !== undefined ||
      (!string(raw.attachmentId, 240) && !string(raw.path, 4000)) ||
      (raw.attachmentId !== undefined && raw.path !== undefined) ||
      (raw.name !== undefined && !string(raw.name, 500))
    )
      fail(`${slot.title}需要文件路径或已登记的附件引用`);
    const f = files.find((f) =>
      raw.attachmentId !== undefined ? f.attachmentId === raw.attachmentId : f.path === raw.path,
    );
    if (f && raw.name !== undefined && raw.name !== f.name) fail("文件名称与实际文件不符");
    if (
      !f ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes <= 0 ||
      !/^[a-f0-9]{64}$/i.test(f.sha256) ||
      !Number.isFinite(Date.parse(f.verifiedAt))
    )
      fail(`${slot.title}附件未经可信字节回读验证`, "DELIVERY_FILE_UNVERIFIED");
    const ext = f.name.split(".").at(-1)?.toLowerCase();
    if (contract.format !== "any" && ext !== contract.format)
      fail(`${slot.title}要求 ${contract.format} 文件`);
    return {
      slotId: id,
      contractRevision: contract.revision,
      kind: contract.kind,
      format: contract.format,
      attachmentId: f.attachmentId,
      fileName: f.name,
      contentHash: f.sha256,
      bytes: f.bytes,
      verifiedAt: f.verifiedAt,
      ...(f.textBody !== undefined ? { textBody: f.textBody } : {}),
    };
  });
}
export function validateDeliveryAcceptance(
  snapshot: Snapshot,
  key: string,
  artifact: CollaborationArtifact,
  checks: unknown,
): void {
  const slots = currentDeliverySlots(snapshot, key).filter(
    (s) => s.contract && (s.contract.required || receiptForSlot(artifact, s)),
  );
  if (!slots.length) return;
  if (!plain(checks)) fail("请逐件核对交付验收条件", "DELIVERY_REVIEW_REQUIRED");
  for (const slot of slots) {
    if (!receiptForSlot(artifact, slot))
      fail(`${slot.title}尚无当前版本的验证交付`, "INCOMPLETE_DELIVERY");
    const values = checks[slot.id];
    if (
      !Array.isArray(values) ||
      values.length !== slot.contract!.criteria.length ||
      !values.every((v) => v === true)
    )
      fail(`${slot.title}的验收条件尚未全部通过`, "DELIVERY_REVIEW_REQUIRED");
  }
  if (Object.keys(checks).some((id) => !slots.some((s) => s.id === id)))
    fail("验收包含不属于本次交付的项目");
}
const signature = (s: DeliverySlotDraft) =>
  stableContent({
    title: s.title,
    taskKey: s.taskKey,
    description: s.description,
    parentId: s.parentId,
    contributionIds: s.contributionIds ?? [],
    contract: s.contract ? { ...s.contract, revision: 0 } : undefined,
  });
/** Called while materializing an approved direction. Backend assigns stable identity and revision. */
export function materializeDeliverySlots(
  planId: string,
  previous: GoalPlanVersion | undefined,
  drafts: DeliverySlotDraft[],
  bindings: GoalTaskBinding[],
): DeliverySlot[] {
  return drafts.map((draft) => {
    const target = bindings.find(
      (b) =>
        b.draftKey === draft.taskKey ||
        b.key === draft.taskKey ||
        b.draftKey === `plan-${planId}-${draft.taskKey}`,
    );
    if (!target) fail("交付件引用了未采用的任务");
    const old = previous?.slots.find(
      (s) => !s.retired && (s.definitionId === draft.id || s.id === draft.id),
    );
    const id = old?.id ?? `slot-${hashText(`${planId}:${draft.id}`).slice(0, 24)}`;
    const parentId = draft.parentId
      ? (previous?.slots.find((s) => s.definitionId === draft.parentId)?.id ??
        `slot-${hashText(`${planId}:${draft.parentId}`).slice(0, 24)}`)
      : undefined;
    const normalized = { ...draft, taskKey: target.key, parentId };
    const contract = readDeliveryContract(
      draft.contract ?? defaultDeliveryContract(draft.description),
    );
    const oldAssembly = old && previous?.tasks.find((b) => b.assembly?.slotId === old.id)?.assembly;
    const comparableOld =
      old && oldAssembly
        ? {
            ...old,
            taskKey: oldAssembly.sourceTaskKeys[0] ?? old.taskKey,
            contributionIds: draft.contributionIds ?? [],
          }
        : old;
    contract.revision = old?.contract
      ? signature(comparableOld!) === signature({ ...normalized, contract })
        ? old.contract.revision
        : old.contract.revision + 1
      : 1;
    return {
      ...normalized,
      id,
      definitionId: draft.id,
      contract,
      planId,
      taskId: target.taskId,
      workItemId: target.workItemId,
    };
  });
}
