import { discussionSummary, discussionQuestion } from './discussionSnippets';
import type { Session, Snapshot, Task } from "./types";
import { supersededStoppedSession } from "./sessionHistory";

// 任务与会话的展示状态推导（PRD V0.5 §5）。
// 一轮结束、100% 或单个会话归档都不等于任务完成。

export type SessionView =
  | "submitting"
  | "acknowledged"
  | "unknown"
  | "rejected"
  | "running"
  | "waiting_reply"
  | "waiting_permission"
  | "failed"
  | "paused"
  | "cancelled"
  | "archived";

export type TaskView = SessionView | "todo" | "done";

/** Parallel branches may still run while one source request needs user attention. */
export function pendingSessionStatus(s: Session): 'waiting_permission' | 'waiting_reply' | null {
  const pending = Object.values(s.runtime?.requests ?? (s.runtime?.request ? { [s.runtime.request.id]: s.runtime.request } : {}));
  return pending.some(request => request.kind === 'permission') ? 'waiting_permission' : pending.length ? 'waiting_reply' : null;
}

export function sessionView(s: Session): SessionView {
  if (s.status === "paused" || s.status === "cancelled") return s.status;
  if (s.dispatchPhase === "submitting") return "submitting";
  if (s.dispatchPhase === "rejected") return "rejected";
  if (s.dispatchPhase === "unknown") return "unknown";
  const pending = pendingSessionStatus(s);
  if (pending && !['archived', 'failed'].includes(s.status)) return pending;
  if (s.status === "queued" || s.status === "pending") return "acknowledged";
  return s.status as SessionView;
}

const PRIORITY: SessionView[] = [
  "waiting_permission",
  "waiting_reply",
  "unknown",
  "rejected",
  "failed",
  "running",
  "acknowledged",
  "submitting",
  "paused",
  "cancelled",
];

export function taskSessions(snap: Snapshot, task: Task) {
  return task.sessionIds.map((id) => snap.sessions[id]).filter(Boolean);
}

export function taskView(snap: Snapshot, task: Task): TaskView {
  if (task.completion) return "done";
  const views: SessionView[] = taskSessions(snap, task)
    .filter(session => !session.linkedAsHistory && !supersededStoppedSession(snap, session))
    .map(sessionView)
    .filter((v) => v !== "archived");
  for (const p of PRIORITY) if (views.includes(p)) return p;
  return "todo";
}

export function taskCounts(snap: Snapshot, task: Task) {
  const views = taskSessions(snap, task).map(sessionView);
  return {
    running: views.filter((v) => v === "running").length,
    queued: views.filter((v) => v === "acknowledged").length,
    waiting: views.filter((v) => v === "waiting_reply" || v === "waiting_permission").length,
    archived: views.filter((v) => v === "archived").length,
    total: views.length,
  };
}

export const VIEW_LABEL: Record<TaskView, string> = {
  todo: "待办",
  submitting: "已委派 · 提交中",
  acknowledged: "排队中",
  unknown: "已委派 · 受理未知",
  rejected: "委派失败",
  running: "运行中",
  waiting_reply: "待回复",
  waiting_permission: "待权限",
  failed: "执行失败",
  paused: "已暂停",
  cancelled: "已取消",
  archived: "已归档",
  done: "已完成",
};

export type Tone = "neutral" | "pending" | "running" | "waiting" | "error" | "done";

export const VIEW_TONE: Record<TaskView, Tone> = {
  todo: "neutral",
  submitting: "pending",
  acknowledged: "pending",
  unknown: "waiting",
  rejected: "error",
  running: "running",
  waiting_reply: "waiting",
  waiting_permission: "waiting",
  failed: "error",
  paused: "neutral",
  cancelled: "neutral",
  archived: "neutral",
  done: "done",
};

export function isActive(v: SessionView) {
  return v !== "archived" && v !== "cancelled";
}

export function isWaiting(v: TaskView) {
  return v === "waiting_reply" || v === "waiting_permission";
}

export function needsAttention(v: TaskView) {
  return v === "failed" || v === "rejected" || v === "unknown";
}

export function isInFlight(v: TaskView) {
  return v === "running" || v === "acknowledged" || v === "submitting";
}

/** 子代理按真实父级排成树：parentId 缺省挂在会话下，否则挂在对应子代理下一层 */
export function subAgentTree<T extends { id: string; parentId?: string }>(list: T[]) {
  const ids = new Set(list.map((x) => x.id));
  const roots = list.filter((x) => !x.parentId || !ids.has(x.parentId));
  const childrenOf = (id: string) => list.filter((x) => x.parentId === id);
  return { roots, childrenOf };
}

/** 等待卡第一行：类型 · 摘要 */
export function waitingHeadline(s: Session) {
  const kind = s.status === "waiting_permission" ? "待权限" : "待回复";
  return s.waitingReason ? `${kind} · ${discussionSummary(s.waitingReason)}` : kind;
}

/** 优先源端问题；讨论协议只展示待补充问题，原始回复留在源会话。 */
export function waitingQuestion(s: Session) {
  const text = s.waitingQuestion ?? s.rounds[s.rounds.length - 1]?.reply;
  return text == null ? null : discussionQuestion(text);
}
