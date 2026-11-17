import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkdeckProvider, useWorkdeck } from "../src/state/WorkdeckContext";
import { SampleWorkdeckDataSource } from "../src/data/repository";
import {
  previewDeliveryChange,
  applyDeliveryChange,
  type DeliveryChangeInput,
} from "../src/data/deliveryChanges";
import { saveOutputFile } from "../src/data/outputFiles";
import { createDeliveryFixture } from "./delivery-map.fixture";
import { DeliveryMap } from "../src/components/results/DeliveryMap";
import { ResultsBoard } from "../src/components/results/ResultsBoard";
import "../src/index.css";
import "../src/quiet.css";

// Browser-only synthetic fixture: an isolated profile, in-memory source, no runtime or native host.
const fixture = await createDeliveryFixture();
const snapshot = fixture.snapshot;
const plan = snapshot.collaboration!.goalPlans![fixture.planId].at(-1)!;
const airport = plan.slots[0];
const artifact = snapshot.collaboration!.artifacts.find((item) => item.key === airport.taskKey)!;
airport.contract = {
  revision: 1,
  kind: "text",
  format: "markdown",
  required: true,
  criteria: ["路线来源可打开", "注明费用范围"],
};
const taskPlan = {
  ...structuredClone(plan),
  id: "task-output-plan",
  scope: "task" as const,
  standalone: true,
  taskId: airport.taskId,
  slots: [
    {
      ...airport,
      id: "own-task-output",
      planId: "task-output-plan",
      title: "任务独立资料",
      contributionIds: undefined,
    },
  ],
};
airport.contributionIds = ["own-task-output"];
snapshot.collaboration!.goalPlans!["task-output-plan"] = [taskPlan];
artifact.deliveryReceipts = [airport, taskPlan.slots[0]].map((slot, index) => ({
  slotId: slot.id,
  contractRevision: 1,
  kind: "text" as const,
  format: "markdown",
  body: index === 0 ? "项目最终路线正文" : "任务独立资料正文",
  contentHash: `fixture-${index}`,
  bytes: 24,
  verifiedAt: artifact.createdAt,
}));
const html =
  "<!doctype html><html><body><h1>独立文件交付验收</h1><p>这是写入本地附件存储的 HTML 文件。</p></body></html>";
const file = await saveOutputFile(
  snapshot.project.id,
  new File([html], "route-guide.html", { type: "text/html" }),
);
const unrelated = await saveOutputFile(
  snapshot.project.id,
  new File(["other"], "unrelated.txt", { type: "text/plain" }),
);
const fileSlot = {
  ...airport,
  id: "own-file-output",
  planId: taskPlan.id,
  title: "独立图文文件",
  contributionIds: undefined,
  contract: { ...airport.contract!, kind: "file" as const, format: "html" },
};
taskPlan.slots.push(fileSlot);
artifact.attachments = [file, unrelated];
artifact.deliveryReceipts.push({
  slotId: fileSlot.id,
  contractRevision: 1,
  kind: "file",
  format: "html",
  attachmentId: file.id,
  fileName: file.name,
  contentHash: "fixture-file",
  bytes: file.size,
  verifiedAt: artifact.createdAt,
});
const fixedScope = `task:${airport.taskId}:work:${airport.workItemId}`;
const publishedItems = [taskPlan.slots[0], fileSlot].map((slot) => ({
  slotId: slot.id,
  title: slot.title,
  contract: structuredClone(slot.contract!),
  artifactId: artifact.id,
  receipt: structuredClone(
    artifact.deliveryReceipts!.find((receipt) => receipt.slotId === slot.id)!,
  ),
}));
publishedItems[0].receipt.body = "正式 v1 的固定正文";
const fixedVersion = {
  id: "fixture-published-v1",
  bundleId: "fixture-published",
  version: 1,
  revisionId: "fixture-revision-1",
  at: artifact.createdAt,
  reviewNote: "隔离样例已发布",
  hash: "fixture-published-hash",
  title: "任务已发布交付",
  sourcePins: [
    {
      artifactId: artifact.id,
      artifactHash: artifact.hash,
      taskKey: airport.taskKey,
      taskId: airport.taskId,
      taskTitle: "路线任务",
      title: artifact.title,
      specRevision: 1,
      reviewId: "fixture-review",
      conditionsHash: "fixture",
    },
  ],
  sections: [],
  deliveryPublication: {
    scopeKey: fixedScope,
    contentFingerprint: "fixture-v1",
    items: publishedItems,
  },
};
const nextVersion = {
  ...structuredClone(fixedVersion),
  id: "fixture-published-v2",
  version: 2,
  revisionId: "fixture-revision-2",
};
nextVersion.deliveryPublication.items[0].receipt.body = "正式 v2 的固定正文";
snapshot.integration = {
  schema: 1,
  sequence: 0,
  bundles: {
    "fixture-published": {
      id: "fixture-published",
      title: "任务已发布交付",
      version: 2,
      publishedVersionId: nextVersion.id,
      createdAt: artifact.createdAt,
      deliveryScopeKey: fixedScope,
    },
  },
  drafts: {},
  revisions: [],
  versions: [fixedVersion, nextVersion],
  events: [],
  receipts: {},
};
const source = new SampleWorkdeckDataSource({ snapshot, onPersist: () => {} });
const calls: DeliveryChangeInput[] = [],
  previews: DeliveryChangeInput[] = [];
const fault = new URLSearchParams(location.search).get("fault");
Object.assign(source, {
  async previewDeliveryChange(_projectId: string, input: DeliveryChangeInput) {
    previews.push(structuredClone(input));
    return previewDeliveryChange(source.peek(), input);
  },
  async applyDeliveryChange(_projectId: string, input: DeliveryChangeInput) {
    calls.push(structuredClone(input));
    if (fault === "retry" && calls.length === 1) throw Error("连接暂时中断，草稿已保留");
    let result = previewDeliveryChange(source.peek(), input);
    source.mutateRuntime((state) => {
      result = applyDeliveryChange(state, input);
    });
    return result;
  },
  async previewDeliveryPublication(_projectId: string, scope: { taskId?: string }) {
    return {
      fingerprint: "fixture-scope-version",
      title: scope.taskId ? "任务成果" : snapshot.project.name,
      items: [
        {
          slotId: airport.id,
          title: airport.title,
          state: "candidate",
          required: true,
          format: "markdown",
        },
      ],
      blockers: ["路线成果尚待验收"],
      canPublish: false,
    };
  },
  async publishDelivery() {
    throw Error("此隔离样例没有已验收完整成果，不应触发发布");
  },
});
Object.assign(window, { deliveryUi: { calls, previews, source, fixture } });
function Preview() {
  const { workspace, openWorkspace, closeWorkspace } = useWorkdeck();
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    const show = () => {
      closeWorkspace();
      setEmpty(false);
    };
    window.addEventListener("quandeck:show-results", show);
    return () => window.removeEventListener("quandeck:show-results", show);
  }, [closeWorkspace]);
  return (
    <main
      className="qd-app qd-delivery-fixture"
      style={{
        display: "block",
        maxWidth: 1800,
        margin: "auto",
        padding: 18,
        minWidth: 0,
        overflow: "visible",
      }}
    >
      <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            closeWorkspace();
            setEmpty(false);
          }}
        >
          项目地图
        </button>
        <button
          onClick={() => {
            setEmpty(false);
            openWorkspace(airport.taskId, { view: "results", focus: true });
          }}
        >
          任务地图
        </button>
        <button
          onClick={() => {
            closeWorkspace();
            setEmpty(true);
          }}
        >
          无清单任务
        </button>
      </nav>
      {workspace ? (
        <ResultsBoard />
      ) : (
        <DeliveryMap
          key={empty ? "empty" : "project"}
          scope={empty ? { taskId: fixture.historic } : {}}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <WorkdeckProvider source={source} fallback={<p>读取隔离样例…</p>}>
    <Preview />
  </WorkdeckProvider>,
);
