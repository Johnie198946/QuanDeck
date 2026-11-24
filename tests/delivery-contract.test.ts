import assert from "node:assert/strict";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import {
  applyCollaboration,
  buildContextPackage,
  type CollaborationActor,
} from "../src/data/collaboration";
import {
  defaultDeliveryContract,
  materializeDeliverySlots,
  validateDeliveryItems,
  validateDeliveryAcceptance,
  type VerifiedDeliveryFile,
} from "../src/data/deliveryContract";
import {
  applyDeliveryChange,
  previewDeliveryChange,
  type DeliveryChangeInput,
} from "../src/data/deliveryChanges";
import {
  deriveDeliveryMap,
  goalDeliveryReadiness,
  type GoalPlanVersion,
} from "../src/data/goalDelivery";
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
function command(
  s: Snapshot,
  taskId: string,
  type: "submit" | "review",
  payload: Record<string, unknown>,
  actor: CollaborationActor = { kind: "human" },
) {
  return applyCollaboration(
    s,
    {
      projectId: s.project.id,
      taskId,
      type,
      expectedVersion: s.collaboration!.tasks[taskId].version,
      idempotencyKey: `command-${++sequence}`,
      payload,
    },
    actor,
  );
}
async function main() {
  const api = new LocalWorkdeckDataSource(),
    projectId = (await api.createProject({ name: "逐件交付契约回归" })).projectId!;
  const taskId = (await api.createTaskWithAttachments("交付代码和说明", [], projectId)).taskId!;
  const otherId = (await api.createTaskWithAttachments("其他任务", [], projectId)).taskId!;
  const s = await api.load(),
    planId = `delivery:${taskId}`,
    contract = defaultDeliveryContract("正文完整可核对");
  const initial: DeliveryChangeInput = {
    planId,
    taskId,
    expectedVersion: 0,
    idempotencyKey: "initial",
    reason: "先定义两个必须交付件",
    operations: [
      { type: "add", slot: { id: "guide", title: "说明", taskKey: taskId, contract } },
      {
        type: "add",
        slot: {
          id: "code",
          title: "代码",
          taskKey: taskId,
          contract: { ...contract, kind: "file", format: "js" },
        },
      },
    ],
  };
  const before = JSON.stringify(s),
    preview = previewDeliveryChange(s, initial);
  assert(preview.ok, preview.message);
  assert.equal(JSON.stringify(s), before, "preview must never mutate ledger");
  const applied = applyDeliveryChange(s, initial);
  assert(applied.ok, applied.message);
  assert.equal(applied.version, 1);
  assert.equal(s.ideaPlans?.[planId], undefined, "defining delivery does not approve a direction");
  assert(applyDeliveryChange(s, initial).replayed);
  assert.equal(
    s.collaboration!.goalPlans![planId].length,
    1,
    "initial command and retry persist one immutable version",
  );
  const [guide, code] = applied.slots;
  assert.equal(validateDeliveryItems(s, taskId, undefined).length, 0);
  assert.throws(
    () =>
      validateDeliveryItems(s, otherId, [
        { slotId: guide.id, contractRevision: 1, body: "wrong owner" },
      ]),
    /不属于/,
  );
  assert.throws(
    () =>
      validateDeliveryItems(s, taskId, [
        { slotId: guide.id, contractRevision: 2, body: "wrong revision" },
      ]),
    /变化/,
  );
  assert.throws(
    () =>
      validateDeliveryItems(s, taskId, [
        { slotId: guide.id, contractRevision: 1, body: "ok", verified: true },
      ]),
    /只允许/,
  );
  assert.throws(
    () =>
      validateDeliveryItems(s, taskId, [
        { slotId: guide.id, contractRevision: 1, body: "x" },
        { slotId: guide.id, contractRevision: 1, body: "x" },
      ]),
    /重复/,
  );
  assert.throws(
    () =>
      validateDeliveryItems(s, taskId, [{ slotId: code.id, contractRevision: 1, path: "code.js" }]),
    /回读/,
  );
  const file: VerifiedDeliveryFile = {
    attachmentId: "backend-file",
    path: "code.js",
    storagePath: "deliverables/code.js",
    name: "code.js",
    sha256: "a".repeat(64),
    bytes: 12,
    verifiedAt: new Date().toISOString(),
  };
  assert.throws(
    () =>
      validateDeliveryItems(
        s,
        taskId,
        [{ slotId: code.id, contractRevision: 1, path: "code.js", name: "fake.js" }],
        [file],
      ),
    /名称/,
  );
  assert.throws(
    () =>
      validateDeliveryItems(
        s,
        taskId,
        [{ slotId: code.id, contractRevision: 1, attachmentId: "backend-file" }],
        [{ ...file, name: "code.txt" }],
      ),
    /要求/,
  );
  const partial = command(s, taskId, "submit", {
    title: "说明候选",
    body: "只完成说明",
    deliverySlotIds: [guide.id, code.id],
    deliveryItems: [{ slotId: guide.id, contractRevision: 1, body: "真实说明" }],
    unresolved: [],
    nextSteps: [],
  });
  assert(partial.ok, partial.message);
  assert.equal(
    s.collaboration!.tasks[taskId].status,
    "paused",
    "slot claims cannot substitute missing file evidence",
  );
  assert.equal(goalDeliveryReadiness(s, taskId).missingSlots[0].id, code.id);
  assert.equal(deriveDeliveryMap(s, { planId }).filled, 1, "one receipt fills exactly one slot");
  const partialFacts = JSON.stringify(s.collaboration!.artifacts[0]);
  const full = command(
    s,
    taskId,
    "submit",
    {
      title: "完整候选",
      body: "说明与代码",
      deliveryItems: [
        { slotId: guide.id, contractRevision: 1, body: "真实说明" },
        { slotId: code.id, contractRevision: 1, path: "code.js" },
      ],
      unresolved: [],
      nextSteps: [],
    },
    { kind: "human", verifiedDeliveryFiles: [file] },
  );
  assert(full.ok, full.message);
  const artifact = s.collaboration!.artifacts.at(-1)!;
  assert.equal(artifact.deliveryReceipts?.length, 2);
  assert.equal(artifact.deliveryReceipts?.[1].contentHash, file.sha256);
  assert.equal(artifact.attachments?.[0].id, file.attachmentId);
  assert.equal(artifact.attachments?.[0].projectRelativePath, "deliverables/code.js");
  assert.equal(s.outputs![artifact.outputId!].attachments?.[0].projectRelativePath, "deliverables/code.js");
  assert.equal(s.outputs![artifact.outputId!].attachments?.[0].id, file.attachmentId);
  assert.equal(JSON.stringify(s.collaboration!.artifacts[0]), partialFacts);
  assert(goalDeliveryReadiness(s, taskId).complete);
  assert.equal(deriveDeliveryMap(s, { planId }).filled, 2);
  assert.throws(() => validateDeliveryAcceptance(s, taskId, artifact, undefined), /逐件/);
  assert.throws(
    () =>
      validateDeliveryAcceptance(s, taskId, artifact, { [guide.id]: [true], [code.id]: [false] }),
    /全部通过/,
  );
  const task = s.collaboration!.tasks[taskId],
    spec = s.collaboration!.specs.filter((x) => x.key === taskId).at(-1)!;
  const accepted = command(s, taskId, "review", {
    submissionId: task.latestSubmissionId,
    verdict: "accepted",
    note: "逐件核对真实正文与文件",
    checks: spec.criteria.map(() => true),
    deliveryChecks: { [guide.id]: [true], [code.id]: [true] },
  });
  assert(accepted.ok, accepted.message);
  assert.equal(s.collaboration!.reviews.at(-1)!.deliveryChecks?.length, 2);
  const downstream = {
    ...structuredClone(artifact),
    id: "downstream",
    artifactId: "downstream-logical",
    key: otherId,
    sourceIds: [artifact.id],
  };
  s.collaboration!.artifacts.push(downstream);
  s.collaboration!.goalAutomation = {
    parent: {
      planId,
      planVersion: 1,
      draftVersion: 0,
      enabled: true,
      agentId: "codex",
      version: 1,
      at: new Date().toISOString(),
      attempts: {},
    },
  };
  const originalPlan = JSON.stringify(s.collaboration!.goalPlans![planId][0]),
    originalArtifact = JSON.stringify(artifact);
  const change: DeliveryChangeInput = {
    planId,
    expectedVersion: 1,
    idempotencyKey: "change",
    reason: "新增JSON验收要求",
    operations: [
      { type: "update", slotId: guide.id, patch: { contract: { ...contract, format: "json" } } },
    ],
  };
  const impact = previewDeliveryChange(s, change);
  assert(
    impact.invalidatedArtifactIds.includes("downstream"),
    "preview includes transitive downstream evidence",
  );
  assert(impact.affectedTaskKeys.includes(otherId));
  const changed = applyDeliveryChange(s, change);
  assert(changed.ok, changed.message);
  assert.equal(changed.slots[0].id, guide.id);
  assert.equal(changed.slots[0].contract!.revision, 2);
  assert.equal(changed.slots[1].contract!.revision, 1);
  assert.equal(s.collaboration!.freshness[artifact.id], "stale");
  assert.equal(s.collaboration!.freshness.downstream, "stale");
  assert.equal(s.collaboration!.goalAutomation.parent.enabled, false);
  assert(s.collaboration!.tasks[taskId].requiresRevalidation);
  assert.equal(JSON.stringify(s.collaboration!.goalPlans![planId][0]), originalPlan);
  assert.equal(JSON.stringify(artifact), originalArtifact);
  assert.equal(previewDeliveryChange(s, change).code, "VERSION_CONFLICT");
  assert.equal(
    applyDeliveryChange(s, { ...change, reason: "different" }).code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    deriveDeliveryMap(s, { planId }).filled,
    0,
    "contract changes never silently rebind historical receipts",
  );
  assert.throws(
    () =>
      validateDeliveryItems(s, taskId, [
        { slotId: guide.id, contractRevision: 2, body: "not JSON" },
      ]),
    /JSON/,
  );
  const split = applyDeliveryChange(s, {
    planId,
    expectedVersion: 2,
    idempotencyKey: "split",
    reason: "拆为两个输出",
    operations: [
      {
        type: "split",
        slotIds: [guide.id],
        slots: [
          { id: "one", title: "一", taskKey: taskId, contract },
          { id: "two", title: "二", taskKey: taskId, contract },
        ],
      },
    ],
  });
  assert(split.ok, split.message);
  assert.equal(split.slots.find((x) => x.id === guide.id)?.retired?.replacementIds.length, 2);
  assert.equal(
    deriveDeliveryMap(s, { planId }).slots.some((x) => x.id === guide.id),
    false,
    "retired output remains history but not current map",
  );
  const newest = s.collaboration!.goalPlans![planId].at(-1)!,
    active = newest.slots.filter((x) => !x.retired),
    one = active.find((x) => x.definitionId === "one")!;
  const noMutation = JSON.stringify(s);
  const cycle = applyDeliveryChange(s, {
    planId,
    expectedVersion: 3,
    idempotencyKey: "cycle",
    reason: "invalid cycle",
    operations: [{ type: "update", slotId: one.id, patch: { contributionIds: [one.id] } }],
  });
  assert.equal(cycle.code, "INVALID_GRAPH");
  assert.equal(JSON.stringify(s), noMutation, "invalid command has no side effects");
  const merge = applyDeliveryChange(s, {
    planId,
    expectedVersion: 3,
    idempotencyKey: "merge",
    reason: "合并文字输出",
    operations: [
      {
        type: "merge",
        slotIds: active.filter((x) => x.definitionId !== "code").map((x) => x.id),
        slots: [
          {
            id: "merged",
            title: "合并说明",
            taskKey: taskId,
            contract: { ...contract, required: false },
          },
        ],
      },
    ],
  });
  assert(merge.ok, merge.message);
  const optional = merge.slots.find((x) => x.definitionId === "merged")!;
  assert.equal(
    validateDeliveryItems(s, taskId, [
      { slotId: optional.id, contractRevision: 1, body: "可选说明" },
    ])[0].slotId,
    optional.id,
  );
  const snapshotBeforePin = JSON.stringify(s);
  const context = buildContextPackage(s, taskId);
  assert(context.deliveryContracts?.some((x) => x.slotId === code.id));
  assert.match(context.prompt, /固定逐件交付契约/);
  assert.equal(JSON.stringify(s), snapshotBeforePin);
  // Materialization remains stable across a backend assembly task rebinding.
  const bindings = [{ key: taskId, taskId, draftKey: "raw", specRevision: 1 }],
    drafts = [{ id: "stable", title: "稳定输出", taskKey: "raw", contract }];
  const slots = materializeDeliverySlots("stable-plan", undefined, drafts, bindings);
  const p: GoalPlanVersion = {
    id: "stable-plan",
    title: "p",
    taskId,
    scope: "project",
    version: 1,
    draftVersion: 1,
    at: "now",
    slots: slots.map((x) => ({ ...x, taskKey: "assembly-key", contributionIds: ["source-slot"] })),
    tasks: [
      ...bindings,
      {
        key: "assembly-key",
        taskId: "assembly-key",
        draftKey: "assembly",
        specRevision: 1,
        assembly: {
          slotId: slots[0].id,
          contributionIds: ["source-slot"],
          sourceTaskKeys: [taskId],
          revision: 1,
        },
      },
    ],
  };
  assert.equal(
    materializeDeliverySlots("stable-plan", p, drafts, bindings)[0].contract!.revision,
    1,
    "system rebinding does not revise the contract",
  );
  const legacy = structuredClone(s);
  delete legacy.collaboration!.goalPlans;
  legacy.collaboration!.artifacts.forEach((x) => delete x.deliveryReceipts);
  assert.equal(
    goalDeliveryReadiness(legacy, taskId).applicable,
    false,
    "legacy is preserved without fabricated receipts",
  );
  console.log(
    "Delivery contracts: per-item evidence, trusted files, incomplete gates, acceptance, CAS, stable IDs, split/merge, immutable history, context pins and legacy passed",
  );
}
void main();
