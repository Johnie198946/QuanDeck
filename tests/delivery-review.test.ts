import assert from "node:assert/strict";
import { createDeliveryFixture } from "./delivery-map.fixture";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import { deriveDeliveryMap } from "../src/data/goalDelivery";
import { deliveryReview, deliveryReviewCommand } from "../src/data/deliveryReview";
import {
  reviewChecklist,
  reviewCheckSelected,
  updateReviewChecks,
} from "../src/components/outputs/reviewChecklist";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
async function main() {
  const taskCriteria = ["范围已核对", "网页可打开", "图片完整", "链接有效", "来源完整"];
  const itemCriteria = ["来源完整", "网页可打开", "链接有效", "图片完整"];
  const grouped = reviewChecklist(taskCriteria, [{ id: "only-file", criteria: itemCriteria }]);
  assert.equal(
    grouped.taskRows.length + grouped.itemRows["only-file"].length,
    5,
    "five task checks plus four duplicate item checks display only five checks",
  );
  assert.equal(grouped.taskRows[0].text, "范围已核对", "task-only acceptance remains independent");
  let taskChecks = taskCriteria.map(() => false),
    itemChecks = itemCriteria.map(() => false);
  const sourceRow = grouped.itemRows["only-file"][0];
  taskChecks = updateReviewChecks(taskChecks, sourceRow.taskIndexes, true);
  itemChecks = updateReviewChecks(itemChecks, sourceRow.itemIndexes, true);
  assert.deepEqual(
    taskChecks,
    [false, false, false, false, true],
    "shared row maps original task position, not visible position",
  );
  assert.deepEqual(
    itemChecks,
    [true, false, false, false],
    "shared row maps original file position",
  );
  assert(reviewCheckSelected(sourceRow, taskChecks, itemChecks));
  assert(
    !reviewCheckSelected(
      sourceRow,
      taskCriteria.map(() => false),
      itemChecks,
    ),
    "resetting task review visibly resets a shared row",
  );
  taskChecks = updateReviewChecks(taskChecks, sourceRow.taskIndexes, false);
  itemChecks = updateReviewChecks(itemChecks, sourceRow.itemIndexes, false);
  assert(
    taskChecks.every((value) => !value) && itemChecks.every((value) => !value),
    "unchecking clears both acceptance positions",
  );
  for (const row of [...grouped.taskRows, ...grouped.itemRows["only-file"]]) {
    taskChecks = updateReviewChecks(taskChecks, row.taskIndexes, true);
    itemChecks = updateReviewChecks(itemChecks, row.itemIndexes, true);
  }
  assert.deepEqual(taskChecks, [true, true, true, true, true]);
  assert.deepEqual(
    itemChecks,
    [true, true, true, true],
    "backend receives both complete original arrays",
  );
  const multiple = reviewChecklist(
    ["网页可打开"],
    [
      { id: "a", criteria: ["网页可打开"] },
      { id: "b", criteria: ["网页可打开"] },
    ],
  );
  assert.equal(multiple.taskRows.length, 1);
  assert(!multiple.hasSharedChecks);
  assert.deepEqual(
    multiple.itemRows.a[0].taskIndexes,
    [],
    "multiple-file checks never grant task acceptance",
  );
  assert(
    !reviewCheckSelected(multiple.itemRows.b[0], [true], [false]),
    "another file still requires its own check",
  );
  const optional = reviewChecklist(
    ["网页可打开"],
    [
      { id: "a", criteria: ["网页可打开"] },
      { id: "unsubmitted-optional", criteria: ["网页可打开"], canShare: false },
    ],
  );
  assert(
    !optional.hasSharedChecks,
    "an unsubmitted optional second file still prevents single-file grouping",
  );
  const emptyOptional = reviewChecklist(
    ["网页可打开"],
    [{ id: "only-optional", criteria: ["网页可打开"], canShare: false }],
  );
  assert.equal(
    emptyOptional.taskRows.length,
    1,
    "missing optional delivery cannot hide task criteria",
  );
  const exact = reviewChecklist(
    ["  原文相同  ", "原文相同。"],
    [{ id: "one", criteria: ["原文相同"] }],
  );
  assert.deepEqual(
    exact.itemRows.one[0].taskIndexes,
    [0],
    "only trim-equivalent text is merged, not punctuation or semantic similarity",
  );
  assert.equal(exact.taskRows[0].text, "原文相同。");
  const duplicates = reviewChecklist(["相同", "相同"], [{ id: "one", criteria: ["相同", "相同"] }]);
  assert.equal(duplicates.itemRows.one.length, 1);
  assert.deepEqual(duplicates.itemRows.one[0].taskIndexes, [0, 1]);
  assert.deepEqual(
    duplicates.itemRows.one[0].itemIndexes,
    [0, 1],
    "repeated identical conditions preserve every original acceptance index",
  );
  await createDeliveryFixture();
  const api = new LocalWorkdeckDataSource();
  let snapshot = await api.load();
  const slot = deriveDeliveryMap(snapshot).slots.find((slot) => slot.state === "candidate")!,
    artifactId = slot.artifact!.id;
  let view = deliveryReview(snapshot, artifactId)!;
  assert(view.reviewable);
  assert(view.task.workItemId, "fixture is an actual child task");
  assert.throws(
    () =>
      deliveryReviewCommand(
        snapshot,
        artifactId,
        "accepted",
        view.spec!.criteria.map(() => false),
        "not checked",
      ),
    /逐条确认/,
  );
  assert.throws(
    () =>
      deliveryReviewCommand(
        snapshot,
        artifactId,
        "accepted",
        view.spec!.criteria.map(() => true),
        "",
      ),
    /说明/,
  );
  const stale = structuredClone(snapshot);
  stale.collaboration!.artifacts.find((a) => a.id === artifactId)!.expiresAt =
    "2000-01-01T00:00:00.000Z";
  assert(!deliveryReview(stale, artifactId)!.fresh);
  assert.throws(
    () =>
      deliveryReviewCommand(
        stale,
        artifactId,
        "accepted",
        view.spec!.criteria.map(() => true),
        "checked",
      ),
    /失效/,
  );
  assert.equal(
    deliveryReviewCommand(
      stale,
      artifactId,
      "needs_changes",
      view.spec!.criteria.map(() => false),
      "refresh source",
    ).payload!.verdict,
    "needs_changes",
  );
  const mismatched = structuredClone(snapshot);
  mismatched.collaboration!.submissions.find((s) => s.id === view.submission!.id)!.specRevision++;
  assert(!deliveryReview(mismatched, artifactId)!.reviewable);
  const command = deliveryReviewCommand(
    snapshot,
    artifactId,
    "accepted",
    view.spec!.criteria.map(() => true),
    "逐条对照正文与来源，确认符合要求",
  );
  assert.equal(command.taskId, slot.taskId);
  assert.equal(command.workItemId, slot.workItemId);
  const accepted = await api.collaborate(command);
  assert(accepted.ok, accepted.message);
  snapshot = await api.load();
  assert(deliveryReview(snapshot, artifactId)!.accepted);
  assert.equal(snapshot.collaboration!.tasks[slot.taskKey].status, "done");
  assert.notEqual(
    snapshot.collaboration!.tasks[slot.taskId].status,
    "done",
    "reviewing child never completes parent",
  );
  const reviews = snapshot.collaboration!.reviews.length;
  assert((await api.collaborate(command)).ok, "same command is idempotent");
  assert.equal((await api.load()).collaboration!.reviews.length, reviews);
  const task = (await api.createTaskWithAttachments("当前候选版本", [], snapshot.project.id))
    .taskId!;
  await api.saveTaskOutput({
    taskId: task,
    title: "第一稿",
    body: "第一版真实正文",
    status: "published",
  });
  snapshot = await api.load();
  let record = snapshot.collaboration!.tasks[task];
  const original = snapshot.collaboration!.submissions.find(
    (s) => s.id === record.latestSubmissionId,
  )!.artifactId;
  view = deliveryReview(snapshot, original)!;
  const oldCommand = deliveryReviewCommand(
    snapshot,
    original,
    "accepted",
    view.spec!.criteria.map(() => true),
    "旧版已核对",
  );
  await api.saveTaskOutput({
    taskId: task,
    title: "第二稿",
    body: "新的正文",
    status: "published",
  });
  assert(!(await api.collaborate(oldCommand)).ok, "version CAS rejects outdated review");
  snapshot = await api.load();
  assert(!deliveryReview(snapshot, original)!.reviewable);
  record = snapshot.collaboration!.tasks[task];
  const current = snapshot.collaboration!.submissions.find(
    (s) => s.id === record.latestSubmissionId,
  )!.artifactId;
  view = deliveryReview(snapshot, current)!;
  const returned = await api.collaborate(
    deliveryReviewCommand(
      snapshot,
      current,
      "needs_changes",
      view.spec!.criteria.map(() => false),
      "补齐具体来源",
    ),
  );
  assert(returned.ok, returned.message);
  snapshot = await api.load();
  assert.equal(snapshot.collaboration!.tasks[task].status, "ready");
  assert.equal(snapshot.collaboration!.reviews.at(-1)!.note, "补齐具体来源");
  console.log(
    "Delivery review: exact child scope, criteria/note, freshness, current submission, spec/version guard, return and idempotence passed",
  );
}
void main();
