import assert from "node:assert/strict";
import { createDeliveryFixture } from "./delivery-map.fixture";
import {
  deliveryPresentation,
  deliverySlotEntry,
  deliverySlotKey,
} from "../src/data/deliveryPresentation";
import { createEmptySnapshot } from "../src/data/projectStorage";
import type { Session } from "../src/data/types";
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  },
});
async function main() {
  const { snapshot, binding, historic } = await createDeliveryFixture();
  const before = JSON.stringify(snapshot),
    view = deliveryPresentation(snapshot);
  assert.equal(view.total, 4);
  assert.equal(view.filled, 2);
  assert.equal(view.accepted, 1);
  assert.deepEqual(
    view.slots.map((slot) => slot.state),
    ["candidate", "accepted", "empty", "changes_requested"],
  );
  assert.equal(view.assembly, "partial");
  const airport = view.slots[0];
  assert.equal(
    deliverySlotEntry(snapshot, airport)!.record.text,
    airport.artifact!.body,
    "reader retains the exact submitted body",
  );
  assert.equal(
    deliverySlotEntry(snapshot, view.slots[2]),
    null,
    "unfilled hotel has no invented result",
  );
  assert.equal(
    deliverySlotEntry(snapshot, view.slots[3])!.record.text,
    view.slots[3].artifact!.body,
    "returned original remains readable",
  );
  assert.equal(view.history.length, 0, "project map contains final deliveries only");
  assert.equal(
    deliveryPresentation(snapshot, { taskId: historic }).history.length,
    1,
    "unmapped records remain in their own task",
  );
  const route = binding("routes"),
    leaf = binding("airport");
  assert.equal(
    deliveryPresentation(snapshot, { taskId: route.taskId }).slots.length,
    1,
    "task scope excludes other tasks",
  );
  assert.equal(
    deliveryPresentation(snapshot, { taskId: leaf.taskId, workItemId: leaf.workItemId }).slots
      .length,
    1,
  );
  assert.equal(
    deliveryPresentation(snapshot, { taskId: leaf.taskId, workItemId: "missing-child" }).slots
      .length,
    0,
    "invalid child cannot broaden its scope",
  );
  assert.equal(deliveryPresentation(snapshot, { taskId: "missing-task" }).history.length, 0);
  assert.equal(
    deliveryPresentation(createEmptySnapshot({ id: "other", name: "其他项目" })).slots.length,
    0,
    "another snapshot never borrows the current project map",
  );
  const stale = structuredClone(snapshot);
  stale.collaboration!.tasks[airport.taskKey].requiresRevalidation = true;
  const staleView = deliveryPresentation(stale);
  assert.equal(staleView.slots[0].state, "stale");
  assert.equal(staleView.filled, 1, "outdated artifacts do not fill current deliveries");
  assert(staleView.slots[0].artifact, "outdated source remains readable");
  const orphan = structuredClone(snapshot);
  delete orphan.tasks[historic];
  assert.equal(
    deliveryPresentation(orphan).history.length,
    0,
    "deleted task history never broadens project scope",
  );
  assert.equal(
    Object.values(orphan.outputs).some((item) => item.title === "旧版路线记录"),
    true,
    "underlying historic output is retained",
  );
  assert.notEqual(
    deliverySlotKey(airport),
    deliverySlotKey({ ...airport, planId: "other-plan" }),
    "slot identity includes plan",
  );
  assert.equal(
    JSON.stringify(snapshot),
    before,
    "reading all scopes must not alter ledger or blackboard",
  );

  // Strict per-item contracts must not duplicate the artifact summary or share files.
  const strict = structuredClone(snapshot),
    sourcePlan = Object.values(strict.collaboration!.goalPlans!)[0].at(-1)!;
  const sourceSlot = sourcePlan.slots[0],
    artifact = strict.collaboration!.artifacts.find((item) => item.id === airport.artifact!.id)!;
  const contract = {
    revision: 1,
    kind: "text" as const,
    format: "markdown",
    required: true,
    criteria: ["核对内容"],
  };
  sourceSlot.contract = contract;
  const second = {
    ...sourceSlot,
    id: "second-item",
    title: "第二件正文",
    contract: { ...contract },
  };
  sourcePlan.slots.push(second);
  artifact.attachments = [{ id:"supporting-image", name:"现场图.png", type:"image/png", size:1 }];
  artifact.deliveryReceipts = [sourceSlot, second].map((item, i) => ({
    slotId: item.id,
    contractRevision: 1,
    kind: "text" as const,
    format: "markdown",
    body: `独立正文${i + 1}`,
    contentHash: `hash${i}`,
    bytes: 12,
    verifiedAt: artifact.createdAt,
  }));
  const strictView = deliveryPresentation(strict);
  assert.equal(deliverySlotEntry(strict, strictView.slots[0])?.record.text, "独立正文1");
  assert.deepEqual(deliverySlotEntry(strict, strictView.slots[0])?.record.attachments, []);
  assert.equal(deliverySlotEntry(strict, strictView.slots[0])?.inlineAttachments?.[0].id, "supporting-image");
  assert.equal(deliverySlotEntry(strict, strictView.slots.at(-1)!)?.record.text, "独立正文2");
  const childPlan = {
    ...structuredClone(sourcePlan),
    id: "task-own-plan",
    scope: "task" as const,
    taskId: sourceSlot.taskId,
    slots: [{ ...second, id: "child-output", planId: "task-own-plan" }],
  };
  strict.collaboration!.goalPlans!["task-own-plan"] = [childPlan];
  assert.equal(
    deliveryPresentation(strict).slots.some((item) => item.id === "child-output"),
    false,
    "task outputs do not inflate project totals",
  );
  assert.equal(
    deliveryPresentation(strict, { taskId: sourceSlot.taskId }).slots.some(
      (item) => item.id === "child-output",
    ),
    true,
    "task map includes its own outputs",
  );
  artifact.deliveryReceipts = [];
  assert.equal(
    deliverySlotEntry(strict, { ...sourceSlot, state: "candidate", artifact }),
    null,
    "missing receipt cannot repeat artifact body",
  );
  assert.equal(
    JSON.stringify(snapshot),
    before,
    "strict test projection never changes original fixture",
  );

  const directory = createEmptySnapshot({ id: "directory", name: "业务成果目录" });
  const taskTemplate = snapshot.tasks[route.taskId];
  for (const id of ["business-a", "business-b", "business-c", "business-d", "goal-assembly-final", "planning:project-direction"])
    directory.tasks[id] = { ...structuredClone(taskTemplate), id, title: id, sessionIds: [] };
  const originalDirectory = JSON.stringify(directory);
  assert.equal(deliveryPresentation(directory).tasks.length, 5, "five execution tasks plus a planning scaffold produce five task maps");
  assert(!deliveryPresentation(directory).tasks.some(task => task.taskId.startsWith("planning:")));
  assert(deliveryPresentation(directory).tasks.some(task => task.taskId === "goal-assembly-final"), "system assembly is real execution work");
  assert.equal(JSON.stringify(directory), originalDirectory, "filtering a results directory preserves planning facts and history");

  const directionTemplate = Object.values(snapshot.ideaPlans!)[0];
  directory.ideaPlans = {
    project: { ...structuredClone(directionTemplate), id: "project", scope: "project", taskId: "" },
    own: { ...structuredClone(directionTemplate), id: "own", scope: "task", taskId: "business-a" },
  };
  directory.tasks["legacy-planner"] = { ...structuredClone(taskTemplate), id: "legacy-planner", title: "旧项目方向对话", sessionIds: ["legacy-session"] };
  const discussionSession = (id: string, taskId: string, planId: string) => ({ id, taskId, runtime: { taskId, planId, purpose: "discussion" } }) as Session;
  directory.sessions["legacy-session"] = discussionSession("legacy-session", "legacy-planner", "project");
  directory.sessions["own-session"] = discussionSession("own-session", "business-a", "own");
  const projected = deliveryPresentation(directory).tasks;
  assert.equal(projected.length, 5, "legacy project-discussion scaffolds do not inflate task result counts");
  assert(!projected.some(task => task.taskId === "legacy-planner"));
  assert(projected.some(task => task.taskId === "business-a"), "discussing a real task's own direction does not hide that task");
  console.log(
    "delivery presentation: partial/empty/accepted/returned/stale, exact text, task-child-project scope, history and immutable truth passed",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
