import assert from "node:assert/strict";
import { SampleWorkdeckDataSource } from "../src/data/repository";
import { createEmptySnapshot } from "../src/data/projectStorage";
import { deriveTaskHandoffs } from "../src/data/taskHandoff";
import { queryProjectLessons } from "../src/data/projectMemoryNotes";
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
    checked,
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
  assert(!(await source.saveTaskOutput({...input, body:"  ", complete:false})).ok);
  const draft = await source.saveTaskOutput({...input,complete:false,status:"draft"});
  assert(draft.ok && draft.outputId);
  assert.equal(source.peek().collaboration!.submissions.length,0);
  assert.equal(deriveTaskHandoffs(source.peek(),[taskId]).length,0);
  assert(!source.peek().tasks[taskId].completion);
  const pendingCandidate = await source.saveTaskOutput({...input,complete:false,id:draft.outputId,status:"published"});
  assert(pendingCandidate.ok,pendingCandidate.message);
  const candidateState = source.peek(), candidate = candidateState.collaboration!.tasks[taskId];
  assert.equal(candidate.status,"in_review");
  assert(!candidateState.tasks[taskId].completion);
  assert(!candidate.acceptedArtifactId);
  assert.equal(deriveTaskHandoffs(candidateState,[taskId])[0].reviewStatus,"unreviewed");
  assert.equal(candidateState.collaboration!.reviews.length,0);
  assert.equal(queryProjectLessons(candidateState,taskId).length,0);
  const artifact = candidateState.collaboration!.artifacts.at(-1)!;
  const memory = await source.collaborate({projectId:"acceptance-test",type:"record_memory_note",idempotencyKey:"no-lesson-from-candidate",
    payload:{status:"confirmed",situation:"本任务",action:"核对",outcome:"完成",limitation:"本项目",artifactId:artifact.id,artifactHash:artifact.hash}});
  assert.equal(memory.code,"MEMORY_SOURCE_CHANGED");
  const review = (id:string,checks:boolean[]) => source.collaborate({projectId:"acceptance-test",taskId,type:"review",
    idempotencyKey:id,expectedVersion:candidate.version,payload:{submissionId:candidate.latestSubmissionId,verdict:"accepted",checks,note:"独立核对已提交内容与来源"}});
  assert(!(await review("missing-criterion",[true,false])).ok);
  const accepted = await review("accepted",[true,true]);
  assert(accepted.ok,accepted.message);
  assert(source.peek().tasks[taskId].completion);
  assert.equal(deriveTaskHandoffs(source.peek(),[taskId])[0].reviewStatus,"accepted");
  assert(!(await source.saveTaskOutput({...input,id:draft.outputId,complete:false,status:"draft"})).ok);
  assert(!(await source.saveTaskOutput({...input,complete:false})).ok);
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
    status: "published",
    taskSpecRevision:checkedTaskAcceptance(source.peek(), fileTask).taskSpecRevision,
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
  await assert.rejects(pending, /验收条件已变化/);
  assert.deepEqual(
    source.peek(),
    afterRevision,
    "a change during trusted file verification aborts the whole save",
  );
  const dependent = (await source.collaborate({projectId:"acceptance-test",type:"create_task",idempotencyKey:"dependent",
    payload:{title:"依赖交付",goal:"汇总前置工作",owner:"me",criteria:["前置内容已验收"],dependencies:[fileTask]}})).resourceId!;
  assert((await source.saveTaskOutput({taskId:dependent,title:"已有汇总草案",body:"依赖材料尚未完成",status:"published"})).ok);
  const unready = source.peek().collaboration!.tasks[dependent];
  const blocked = await source.collaborate({projectId:"acceptance-test",taskId:dependent,type:"review",expectedVersion:unready.version,
    idempotencyKey:"blocked-review",payload:{submissionId:unready.latestSubmissionId,verdict:"accepted",checks:[true],note:"核对前置条件"}});
  assert.equal(blocked.code,"DEPENDENCIES_NOT_READY");
  assert(!source.peek().tasks[dependent].completion);
  const parent = (await source.createTaskWithAttachments("汇总两个章节",[],"acceptance-test")).taskId!;
  const child = (await source.addManualSubtask(parent,parent,"补齐住宿章节")).itemId!;
  const parentCandidate = await source.saveTaskOutput({taskId:parent,title:"汇总初稿",body:"已有交通内容",status:"published"});
  assert(parentCandidate.ok);
  const parentState = source.peek(), parentTask = parentState.collaboration!.tasks[parent];
  const premature = await source.collaborate({projectId:"acceptance-test",taskId:parent,type:"review",expectedVersion:parentTask.version,
    idempotencyKey:"check-incomplete-parent",payload:{submissionId:parentTask.latestSubmissionId,verdict:"accepted",
      checks:checkedTaskAcceptance(parentState,parent).taskChecks,note:"检查父任务有独立候选时能否过早完成"}});
  assert.equal(premature.code,"CHILDREN_NOT_DONE");
  const after = source.peek();
  assert(!after.tasks[parent].completion);
  assert.equal(after.collaboration!.tasks[parent].status,"in_review");
  assert.notEqual(after.orchestrations![parent].items[child].status,"done");
  assert.equal(deriveTaskHandoffs(after,[parent])[0].reviewStatus,"unreviewed");
  console.log("Manual delivery: drafts, independent candidate review, legacy completion rejection, memory lineage, dependencies and verification race passed");
}
void main();
