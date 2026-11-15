import { changedLines, countOpen } from "../../data/ideas";
import { rootPlanOf } from "../../data/ideaEngine";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { TaskProgress } from "./TaskProgress";

/** 日记中的事项：只回写关键决定、方案入口与执行摘要；完整问答留在源 Agent 会话 */
export function IdeaBlock({ taskId, methodOnly = false }: { taskId: string; methodOnly?: boolean }) {
  const { snap, openWorkspace } = useWorkdeck();
  const plan = rootPlanOf(snap, taskId);
  const orch = snap.orchestrations?.[taskId];
  if (!plan) return null;
  const doc = plan.adopted?.doc ?? plan.draft;
  const decisions = (doc.sections.find((s) => s.id === "s-fixed")?.lines ?? []).filter((l) => l.state === "fixed").map((l) => l.text);
  const items = Object.values(orch?.items ?? {}).filter((w) => w.status !== "cancelled");
  const done = items.filter((w) => w.status === "done").length;
  const mine = items.filter((w) => w.owner === "me" && w.status !== "done").length;
  const agentRun = items.filter((w) => w.executorId && w.status === "running").length;
  const agentWait = items.filter((w) => w.owner === "agent" && !w.executorId && w.status !== "done").length;
  const none = items.filter((w) => w.owner === "unassigned" && !w.executorId && w.status !== "done").length;
  const pending = !!plan.adopted && changedLines(plan.adopted.doc, plan.draft).size > 0;

  return (
    <div className="qd-idea">
      <p className="qd-idea-line">
        <Icon name="message" size={14} />
        <span>
          方案 · 草稿 v{plan.draftVersion} · {countOpen(plan.draft)} 项待定
          {plan.adopted ? ` · 已采用 v${plan.adopted.version}` : ""}
        </span>
        <button type="button" className="qd-link" onClick={() => openWorkspace(taskId, { view: "plan" })}>
          查看方案
        </button>
      </p>
      {decisions.length > 0 && <p className="qd-idea-decisions">{decisions.slice(0, 4).join(" · ")}</p>}
      {!methodOnly && items.length > 0 && (
        <p className="qd-idea-line">
          <Icon name="check-square" size={14} />
          <span>
            任务 {done}/{items.length} 完成
            {mine ? ` · 我 ${mine}` : ""}
            {agentRun ? ` · Agent 运行 ${agentRun}` : ""}
            {agentWait ? ` · 待委派 ${agentWait}` : ""}
            {none ? ` · 未安排 ${none}` : ""}
          </span>
          <button type="button" className="qd-link" onClick={() => openWorkspace(taskId, { view: "tasks" })}>
            任务
          </button>
        </p>
      )}
      {!methodOnly && orch && items.length > 0 && <TaskProgress o={orch} />}
      {pending && <p className="qd-idea-warn">此修订尚未应用到任务</p>}
    </div>
  );
}
