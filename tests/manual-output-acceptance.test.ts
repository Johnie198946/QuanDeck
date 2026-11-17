import assert from "node:assert/strict";
import { SampleWorkdeckDataSource } from "../src/data/repository";
import { createEmptySnapshot } from "../src/data/projectStorage";
import { checkedTaskAcceptance } from "./manual-acceptance.fixture";
import type { SaveTaskOutputInput } from "../src/data/types";

async function main() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = new SampleWorkdeckDataSource({
    snapshot: createEmptySnapshot({ id: "acceptance-test", name: "Explicit human checks" }),
    onPersist: () => {},
    verifyOutputAttachments: async () => {
      await gate;
      return [
        {
          attachmentId: "file",
          name: "guide.html",
          bytes: 20,
          sha256: "a".repeat(64),
          verifiedAt: new Date().toISOString(),
        },
      ];
    },
  });
  const created = await source.collaborate({
    projectId: "acceptance-test",
    type: "create_task",
    idempotencyKey: "create",
    payload: {
      title: "人工核对",
      goal: "提交完整结果",
      criteria: ["核对来源", "核对预算"],
      owner: "me",
    },
  });
  assert(created.ok, created.message);
  const taskId = created.resourceId!;
  const input: SaveTaskOutputInput = {
    taskId,
    title: "完整交付",
    body: "可核对正文",
    complete: true,
  };
  const original = source.peek();
  const checked = checkedTaskAcceptance(original, taskId);
  for (const fields of [
    {},
    { taskSpecRevision: checked.taskSpecRevision },
    { ...checked, taskChecks: [true] },
    { ...checked, taskChecks: [true, false] },
    { ...checked, taskChecks: [true, true, true] },
    { ...checked, taskSpecRevision: checked.taskSpecRevision + 1 },
    { ...checked, taskChecks: [1, true] as unknown as boolean[] },
  ]) {
    const result = await source.saveTaskOutput({ ...input, ...fields });
    assert(
      !result.ok,
      "missing, incomplete, extra, stale or non-boolean checks must reject completion",
    );
    assert.deepEqual(
      source.peek(),
      original,
      "rejected completion must not write an output, submission or review",
    );
  }
  assert(
    (await source.saveTaskOutput({ ...input, complete: false })).ok,
    "candidate submission needs no completion checks",
  );
  assert.notEqual(source.peek().collaboration!.tasks[taskId].status, "done");
  const accepted = await source.saveTaskOutput({ ...input, ...checked });
  assert(accepted.ok, accepted.message);
  assert.deepEqual(source.peek().collaboration!.reviews.at(-1)!.criteria, [
    { text: "核对来源", passed: true },
    { text: "核对预算", passed: true },
  ]);

  const fileTask = (
    await source.collaborate({
      projectId: "acceptance-test",
      type: "create_task",
      idempotencyKey: "file-task",
      payload: {
        title: "附件回读期间更新要求",
        goal: "校验版本竞态",
        criteria: ["核对旧要求"],
        owner: "me",
      },
    })
  ).resourceId!;
  const change = await source.applyDeliveryChange("acceptance-test", {
    planId: `delivery:${fileTask}`,
    taskId: fileTask,
    expectedVersion: 0,
    idempotencyKey: "file-slot",
    reason: "校验附件",
    operations: [
      {
        type: "add",
        slot: {
          id: "web",
          title: "网页",
          taskKey: fileTask,
          contract: {
            revision: 1,
            kind: "file",
            format: "html",
            required: true,
            criteria: ["可打开"],
          },
        },
      },
    ],
  });
  assert(change.ok, change.message);
  const slot = change.slots[0];
  const pending = source.saveTaskOutput({
    taskId: fileTask,
    title: "HTML",
    body: "完整网页",
    complete: true,
    ...checkedTaskAcceptance(source.peek(), fileTask),
    attachments: [{ id: "file", name: "guide.html", type: "text/html", size: 20 }],
    deliveryItems: [{ slotId: slot.id, contractRevision: 1, attachmentId: "file" }],
    deliveryChecks: { [slot.id]: [true] },
  });
  await Promise.resolve();
  const current = source.peek().collaboration!.tasks[fileTask];
  const revised = await source.collaborate({
    projectId: "acceptance-test",
    taskId: fileTask,
    expectedVersion: current.version,
    type: "revise_task",
    idempotencyKey: "new-requirement",
    payload: { goal: "新的核对范围", criteria: ["核对新要求"], reason: "用户修改了要求" },
  });
  assert(revised.ok, revised.message);
  const afterRevision = source.peek();
  release();
  await assert.rejects(pending, /任务验收条件已变化/);
  assert.deepEqual(
    source.peek(),
    afterRevision,
    "a change during trusted file verification aborts the whole save",
  );
  console.log(
    "Manual completion: explicit checks, exact requirements revision, immutable review evidence, and async verification race passed",
  );
}
void main();
