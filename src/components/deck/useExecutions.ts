import { isWaiting, needsAttention, sessionView, taskView } from "../../data/derive";
import type { TaskView } from "../../data/derive";
import type { Session, Snapshot } from "../../data/types";

export interface ExecutionItem {
  key: string;
  taskId: string | null;
  title: string;
  view: TaskView;
  session: Session;
}

/** 当前执行：每个未归档会话一项，按“等待 → 异常 → 运行”分组。日记、执行栏共用同一推导。 */
export function collectExecutions(snap: Snapshot) {
  const items: ExecutionItem[] = [];
  for (const s of Object.values(snap.sessions)) {
    const agent = snap.agents.find((a) => a.id === s.agentId);
    if (!agent?.tracked) continue;
    const v = sessionView(s);
    if (v === "archived" || v === "cancelled") continue;
    const task = s.taskId ? snap.tasks[s.taskId] : null;
    if (task && taskView(snap, task) === "done") continue;
    items.push({ key: s.id, taskId: s.taskId, title: task?.title ?? s.title, view: v, session: s });
  }
  return {
    waiting: items.filter((i) => isWaiting(i.view)),
    attention: items.filter((i) => needsAttention(i.view)),
    running: items.filter((i) => i.view === "running"),
    queued: items.filter((i) => i.view === "acknowledged"),
    paused: items.filter((i) => i.view === "paused"),
  };
}
