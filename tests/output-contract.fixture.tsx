import { createRoot } from "react-dom/client";
import { LocalWorkdeckDataSource } from "../src/data/repository";
import { WorkdeckProvider } from "../src/state/WorkdeckContext";
import { OutputDialog } from "../src/components/outputs/OutputDialog";
import { applyDeliveryChange } from "../src/data/deliveryChanges";
import { defaultDeliveryContract } from "../src/data/deliveryContract";

/** Synthetic browser-only form fixture. Captures UI input; it does not claim a backend commit. */
export async function mountOutputContractFixture() {
  const api = new LocalWorkdeckDataSource();
  const projectId = (await api.createProject({ name: "手工逐件表单验收" })).projectId!;
  const taskId = (await api.createTaskWithAttachments("提交说明与网页", [], projectId)).taskId!;
  api.mutateRuntimeProject(projectId, (s) => {
    const c = defaultDeliveryContract("内容符合当前要求");
    const result = applyDeliveryChange(s, {
      planId: `delivery:${taskId}`,
      taskId,
      expectedVersion: 0,
      idempotencyKey: "fixture",
      reason: "浏览器表单验收",
      operations: [
        { type: "add", slot: { id: "guide", title: "使用说明", taskKey: taskId, contract: c } },
        {
          type: "add",
          slot: {
            id: "page",
            title: "网页文件",
            taskKey: taskId,
            contract: {
              ...c,
              kind: "file",
              format: "html",
              criteria: ["网页可打开", "图片与内容完整"],
            },
          },
        },
        {
          type: "add",
          slot: {
            id: "optional",
            title: "可选补充",
            taskKey: taskId,
            contract: { ...c, required: false },
          },
        },
      ],
    });
    if (!result.ok) throw Error(result.message);
  });
  const captured: unknown[] = [];
  api.saveTaskOutput = async (input) => {
    captured.push(structuredClone(input));
    return { ok: true, outputId: "captured-input" };
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const mount = () =>
    root.render(
      <WorkdeckProvider source={api} fallback={<p>正在加载验收表单</p>}>
        <OutputDialog key={crypto.randomUUID()} taskId={taskId} onClose={() => root.render(null)} />
      </WorkdeckProvider>,
    );
  mount();
  (window as unknown as { outputContractFixture: unknown }).outputContractFixture = {
    api,
    taskId,
    projectId,
    captured,
    mount,
  };
  return { projectId, taskId };
}
