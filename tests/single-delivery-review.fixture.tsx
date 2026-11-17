import { createRoot } from "react-dom/client";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import { applyDeliveryChange } from "../src/data/deliveryChanges";
import { defaultDeliveryContract } from "../src/data/deliveryContract";
import { saveOutputFile } from "../src/data/outputFiles";
import { WorkdeckProvider } from "../src/state/WorkdeckContext";
import { DeliveryReview } from "../src/components/results/DeliveryReview";
import { OutputDialog } from "../src/components/outputs/OutputDialog";
import { applyCollaboration } from "../src/data/collaboration";

/** Browser-only synthetic candidate. This exercises UI mapping, not native file verification. */
export async function mountSingleDeliveryReviewFixture(mode: "review" | "manual", count = 1) {
  const api = new LocalWorkdeckDataSource();
  const projectId = (await api.createProject({ name: `单件核对隔离验收 ${mode} ${count}` }))
    .projectId!;
  const taskId = (await api.createTaskWithAttachments("整合网页", [], projectId)).taskId!;
  const taskCriteria = ["范围已核对", "网页可打开", "图片完整", "链接有效", "来源完整"];
  const itemCriteria = ["来源完整", "网页可打开", "链接有效", "图片完整"];
  let snapshot = await api.load();
  const revision = await api.collaborate({
    projectId,
    taskId,
    type: "revise_task",
    expectedVersion: snapshot.collaboration!.tasks[taskId].version,
    idempotencyKey: crypto.randomUUID(),
    payload: { goal: "整合网页", criteria: taskCriteria, reason: "隔离验收五条任务条件" },
  });
  if (!revision.ok) throw Error(revision.message);
  api.mutateRuntimeProject(projectId, (s) => {
    const result = applyDeliveryChange(s, {
      planId: `delivery:${taskId}`,
      taskId,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      reason: "隔离验收清单",
      operations: Array.from({ length: count }, (_, index) => ({
        type: "add" as const,
        slot: {
          id: `file-${index}`,
          title: `网页${index + 1}`,
          taskKey: taskId,
          contract: {
            ...defaultDeliveryContract(),
            kind: "file" as const,
            format: "html",
            criteria: itemCriteria,
          },
        },
      })),
    });
    if (!result.ok) throw Error(result.message);
  });
  snapshot = await api.load();
  const slots = snapshot.collaboration!.goalPlans![`delivery:${taskId}`].at(-1)!.slots;
  const attachments = await Promise.all(
    slots.map((_, index) =>
      saveOutputFile(
        projectId,
        new File(
          ["<!doctype html><html><body>隔离测试网页</body></html>"],
          `guide-${index + 1}.html`,
          { type: "text/html" },
        ),
      ),
    ),
  );
  const outputInput = {
    projectId,
    taskId,
    title: "网页候选",
    body: "独立文件候选",
    status: "published" as const,
    attachments,
    deliveryItems: slots.map((slot, index) => ({
      slotId: slot.id,
      contractRevision: slot.contract!.revision,
      attachmentId: attachments[index].id,
    })),
  };
  // Native file verification intentionally has no browser production fallback.
  // Feed synthetic verified metadata only to this isolated fixture's domain setup.
  api.mutateRuntimeProject(projectId, (s) => {
    const result = applyCollaboration(s, {
      projectId, taskId, type: "submit", expectedVersion: s.collaboration!.tasks[taskId].version,
      idempotencyKey: crypto.randomUUID(),
      payload: { title: outputInput.title, body: outputInput.body, deliveryItems: outputInput.deliveryItems, unresolved: [], nextSteps: [] },
    }, { kind: "human", verifiedDeliveryFiles: attachments.map((file) => ({
      attachmentId: file.id, path: file.name, name: file.name, bytes: file.size,
      sha256: "a".repeat(64), verifiedAt: new Date().toISOString(),
    })) });
    if (!result.ok) throw Error(result.message);
  });
  snapshot = await api.load();
  const artifact = snapshot.collaboration!.artifacts.at(-1)!;
  const output = snapshot.outputs![artifact.outputId!];
  const captured: unknown[] = [];
  api.collaborate = async (input) => {
    captured.push(structuredClone(input));
    return { ok: true };
  };
  api.saveTaskOutput = async (input) => {
    captured.push(structuredClone(input));
    return { ok: true, outputId: "captured" };
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    <WorkdeckProvider source={api} fallback={<p>加载隔离核对表单</p>}>
      {mode === "review" ? (
        <DeliveryReview artifactId={artifact.id} />
      ) : (
        <OutputDialog taskId={taskId} output={output} onClose={() => root.render(null)} />
      )}
    </WorkdeckProvider>,
  );
  (window as unknown as { singleDeliveryReviewFixture: unknown }).singleDeliveryReviewFixture = {
    captured,
    slots,
  };
}
