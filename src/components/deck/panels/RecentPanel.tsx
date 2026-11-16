import { businessTasks } from '../../../data/businessTasks';
import { useState } from "react";
import { useWorkdeck } from "../../../state/WorkdeckContext";
import { taskView } from "../../../data/derive";
import { TaskTree } from "../../results/TaskTree";
import "../../results/results.css";

export function RecentPanel() {
  const { snap, openWorkspace, setRailPanel } = useWorkdeck();
  const [filter, setFilter] = useState("all");
  const ids = businessTasks(snap)
    .filter(task => filter === "all" || (filter === "done" ? taskView(snap, task) === "done" : taskView(snap, task) !== "done"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(task => task.id);
  return <div className="qd-recent-tasks">
    <div className="qd-chips" role="group" aria-label="最近任务筛选">{[["all", "全部"], ["active", "未完成"], ["done", "已完成"]].map(([key,label]) => <button type="button" key={key} className={`qd-chip ${filter === key ? "is-on" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    <TaskTree snap={snap} taskIds={ids} onSelect={(taskId,itemId) => { setRailPanel(null); openWorkspace(taskId, { view: "results", selected: itemId, focus: true }); }} />
  </div>;
}
