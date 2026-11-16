import { deriveProjectActivity } from "../../data/projectActivity";
import { workItemPresentation } from "../../data/workItemPresentation";
import { executionStage } from '../../data/executionProgress';
import { taskExecutionPresentation } from "../../data/taskExecutionPresentation";
import { TaskIcon } from "../ui/TaskIcon";
import { latestAttempt, summarize, topItems } from "../../data/orchestration";
import type { Orchestration } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";

/** Task counts express completed work items, never estimated effort or Agent step percentages. */
export function TaskProgress({ o }: { o: Orchestration }) {
  const { snap, selectWork } = useWorkdeck();
  const sum = summarize(snap, o);
  const attention = taskExecutionPresentation(snap, o.taskId).attention;
  const activity = deriveProjectActivity(snap).entries;
  const displayOf = (item: (typeof o.items)[string]) => workItemPresentation(snap, o, item, activity);
  const stateOf = (item: (typeof o.items)[string]) => displayOf(item).state;
  const incomplete = Object.values(o.items).filter(item => displayOf(item).awaitingCompletion).length;
  const items = topItems(o).filter((item) => item.status !== "cancelled");
  if (!sum.total) return null;
  const active = Object.values(o.items).filter((item) => stateOf(item) === "running");
  const queued = Object.values(o.items).filter((item) => stateOf(item) === "queued").length;
  return (
    <div className="qd-home-progress" aria-label={`${o.label}任务进度`}>
      <div className="qd-home-progress-head">
        <span>一级子任务 <strong>{sum.done}</strong> / {sum.total} 完成</span>
        <span>{attention.length ? attention.map(item => item.label).join(" · ") : active.length > 0 ? `${active.length} 运行` : incomplete ? `${incomplete} 项待补齐` : sum.overall.label}{incomplete > 0 && (attention.length > 0 || active.length > 0) ? ` · ${incomplete} 项待补齐` : ""}{queued > 0 ? ` · ${queued} 排队` : ""}</span>
      </div>
      <div className="qd-home-progress-segments" aria-label="查看各子任务状态">
        {items.map((item) => (
          <button type="button" key={item.id} className={`state-${stateOf(item)}`}
            title={`${item.title} · ${displayOf(item).label}`}
            aria-label={`${item.title}：${displayOf(item).label}`}
            onClick={() => selectWork(o.taskId, item.id)} />
        ))}
      </div>
      {active.length > 0 && (
        <div className="qd-home-progress-now">
          {active.slice(0, 2).map((item) => {
            const attempt = latestAttempt(o, item);
            const step = attempt?.step;
            return <button type="button" key={item.id} title={item.title} onClick={() => selectWork(o.taskId, item.id)}>
              <span className="qd-active-dot" aria-hidden="true" />
              <span className="qd-task-name"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={item.id} size={16}/><span>{item.title}</span></span>
              <small>{step?.total ? `${step.completed ?? 0}/${step.total} 步` : executionStage(step?.label) || "运行中"}</small>
            </button>;
          })}
          {active.length > 2 && <button type="button" className="qd-home-progress-more" onClick={() => selectWork(o.taskId, null)}>另有 {active.length - 2} 项运行</button>}
        </div>
      )}
    </div>
  );
}
