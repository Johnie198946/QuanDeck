import assert from "node:assert/strict";
import { directionDeliverables } from "../src/data/directionDeliverables";
import { createEmptySnapshot } from "../src/data/projectStorage";
import { ensureCollaboration } from "../src/data/collaboration";
import type { GoalPlanVersion, DeliverySlot } from "../src/data/goalDelivery";
import type { IdeaPlan, DiscussionConclusion } from "../src/data/types";

const snapshot = createEmptySnapshot({ id: "p", name: "方向与交付范围" });
const state = ensureCollaboration(snapshot);
const slot = (id: string, key: string, planId: string): DeliverySlot => ({
  id,
  title: id,
  taskKey: key,
  taskId: key.split("::")[0],
  workItemId: key.split("::")[1],
  planId,
});
const goal = (id: string, scope: "project" | "task", slots: DeliverySlot[]): GoalPlanVersion => ({
  id,
  title: id,
  scope,
  taskId: "A",
  version: 1,
  draftVersion: 1,
  at: "",
  slots,
  tasks: [],
});
const old = goal("contribution", "task", [slot("old-version", "A", "contribution")]);
const current = goal("contribution", "task", [
  slot("A-own", "A", "contribution"),
  slot("A-child", "A::child", "contribution"),
  slot("B-own", "B", "contribution"),
  {
    ...slot("A-retired", "A", "contribution"),
    retired: { at: "", reason: "已取消", replacementIds: [] },
  },
]);
const final = goal("project-output", "project", [
  slot("project-final", "assembly", "project-output"),
]);
state.goalPlans = { contribution: [old, current], "project-output": [final] };
const direction = {
  id: "different-task-direction-id",
  taskId: "A",
  itemId: null,
  scope: "task",
  draftVersion: 2,
} as IdeaPlan;
const titles = (plan: IdeaPlan) =>
  directionDeliverables(snapshot, plan).current.map((slot) => slot.title);
assert.deepEqual(
  titles(direction),
  ["A-own"],
  "task direction finds the canonical contribution plan without matching discussion plan ID",
);
assert.deepEqual(
  titles({ ...direction, itemId: "child" }),
  ["A-child"],
  "child direction never includes parent, sibling or project final outputs",
);
assert.deepEqual(
  titles({ ...direction, scope: "project" }),
  ["project-final"],
  "project direction reads only final outputs",
);
assert.deepEqual(
  titles({ ...direction, taskId: "assembly" }),
  ["project-final"],
  "assembly task direction sees its own project-final output",
);
assert.deepEqual(
  titles({ ...direction, taskId: "missing" }),
  [],
  "unrelated tasks cannot leak into an empty task direction",
);
const proposal = {
  id: "discussion",
  scopeId: "root",
  adopted: false,
  deliverables: [{ id: "proposal", title: "new-proposal", taskKey: "A" }],
} as DiscussionConclusion;
direction.discussion = { agentId: "codex", conclusions: [proposal] };
assert.deepEqual(
  titles(direction),
  ["A-own"],
  "a discussion proposal cannot replace registered requirements",
);
assert.equal(directionDeliverables(snapshot, direction).proposed?.[0].title, "new-proposal");
proposal.deliverables = [];
assert.deepEqual(
  directionDeliverables(snapshot, direction).proposed,
  [],
  "explicit empty proposals remain visible as pending removal",
);
delete proposal.deliverables;
assert.equal(
  directionDeliverables(snapshot, direction).proposed,
  undefined,
  "omitting a new delivery proposal retains canonical outputs",
);
proposal.deliverables = [{ id: "old-discussion", title: "stale title", taskKey: "A" }];
proposal.adopted = true;
assert.equal(directionDeliverables(snapshot, direction).proposed, undefined);
assert.deepEqual(
  titles(direction),
  ["A-own"],
  "later canonical changes win over adopted discussion text",
);
console.log(
  "Direction delivery list: exact task scope, standalone/contribution plans, project finals, retired/history filtering and separate proposals passed",
);
