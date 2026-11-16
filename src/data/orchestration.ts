import { fromMinutes, toMinutes, span, clockTime } from "./format";
import type { Attempt, Executor, Orchestration, Snapshot, WorkItem, WorkStatus } from "./types";

// 主任务编排推导：日记、执行栏、螺旋与菜单栏摘要共用，保证同一 taskId、同一口径。

export const WORK_LABEL: Record<WorkStatus, string> = {
  not_started: "未开始",
  queued: "排队",
  paused: "已暂停",
  running: "执行中",
  waiting_reply: "等你回复",
  waiting_permission: "等待权限",
  blocked: "等待前置",
  failed: "失败",
  review: "待验收",
  done: "已完成",
  cancelled: "已取消",
};

export const WORK_TONE: Record<WorkStatus, "run" | "wait" | "muted" | "error" | "review" | "done"> = {
  not_started: "muted",
  queued: "muted",
  paused: "muted",
  running: "run",
  waiting_reply: "wait",
  waiting_permission: "wait",
  blocked: "muted",
  failed: "error",
  review: "review",
  done: "done",
  cancelled: "muted",
};

export type WorkFilter = "all" | "running" | "mine" | "blocked" | "failed";

export const FILTERS: { key: WorkFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "mine", label: "等我" },
  { key: "blocked", label: "等待前置" },
  { key: "failed", label: "失败" },
];

export const isPending = (s: WorkStatus) =>
  s === "waiting_reply" || s === "waiting_permission" || s === "failed";
const isActive = (s: WorkStatus) => s === "running";
const isClosed = (s: WorkStatus) => s === "done" || s === "cancelled";

export function matchFilter(item: WorkItem, f: WorkFilter) {
  if (f === "all") return true;
  if (f === "running") return isActive(item.status);
  if (f === "mine") return item.status === "waiting_reply" || item.status === "waiting_permission";
  if (f === "blocked") return item.status === "blocked";
  return item.status === "failed";
}

/** 行内“谁来做”：执行者优先，否则按负责人（我 / Agent 待委派 / 未安排） */
export function whoLabel(o: Orchestration, w: WorkItem, agentName?: (id: string) => string | undefined) {
  if (w.executorId && o.executors[w.executorId]) return o.executors[w.executorId].label;
  if (w.owner === "me") return "我";
  if (w.owner === "agent")
    return `Agent · 待委派${w.suggestedAgentId && agentName ? `（建议 ${agentName(w.suggestedAgentId) ?? ""}）` : ""}`;
  if (w.owner === "unassigned") return "未安排";
  return "";
}

export function orchOf(snap: Snapshot, taskId: string | null | undefined) {
  return taskId ? (snap.orchestrations?.[taskId] ?? null) : null;
}

export function childrenOf(o: Orchestration, parentId: string) {
  return o.itemOrder.map((id) => o.items[id]).filter((w) => w && w.parentTaskId === parentId);
}

export function topItems(o: Orchestration) {
  return childrenOf(o, o.taskId);
}

/** 主任务 → … → 该子任务 */
export function pathOf(o: Orchestration, id: string): WorkItem[] {
  const path: WorkItem[] = [];
  let cur: WorkItem | undefined = o.items[id];
  while (cur) {
    path.unshift(cur);
    cur = o.items[cur.parentTaskId];
  }
  return path;
}

export function executorPath(o: Orchestration, executorId: string): Executor[] {
  const path: Executor[] = [];
  let cur: Executor | undefined = o.executors[executorId];
  while (cur) {
    path.unshift(cur);
    cur = cur.parentExecutorId ? o.executors[cur.parentExecutorId] : undefined;
  }
  return path;
}

export function subtreeIds(o: Orchestration, id: string): string[] {
  return [id, ...childrenOf(o, id).flatMap((c) => subtreeIds(o, c.id))];
}

export function attemptsOf(o: Orchestration, item: WorkItem): Attempt[] {
  return item.attemptIds.map((a) => o.attempts[a]).filter(Boolean);
}

export function latestAttempt(o: Orchestration, item: WorkItem): Attempt | null {
  const list = attemptsOf(o, item);
  return list[list.length - 1] ?? null;
}

export function latestRound(o: Orchestration, item: WorkItem) {
  const list = attemptsOf(o, item);
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i].rounds[list[i].rounds.length - 1];
    if (r) return r;
  }
  return null;
}

/** 按唯一执行记录（attempt）汇总子树 token；不叠加父会话已含的子代理总量 */
export function itemTokens(o: Orchestration, id: string) {
  let total = 0;
  let unknown = false;
  let records = 0;
  for (const wid of subtreeIds(o, id)) {
    for (const a of attemptsOf(o, o.items[wid])) {
      records++;
      if (a.tokens == null) unknown = true;
      else total += a.tokens;
    }
  }
  const own = attemptsOf(o, o.items[id]).reduce((s, a) => s + (a.tokens ?? 0), 0);
  return { total, own, unknown, records };
}

export function dependents(o: Orchestration, id: string) {
  return o.itemOrder.map((x) => o.items[x]).filter((w) => w.dependsOnTaskIds.includes(id));
}

export function minutesBetween(a: string, b: string) {
  return Math.max(0, span(a, b));
}

/** 子任务的时间：已结束显示起止与耗时；运行中按同步时刻计算已运行，不外推 */
export function itemTiming(o: Orchestration, item: WorkItem) {
  const list = attemptsOf(o, item);
  if (!list.length) return null;
  const start = list[0].startedAt;
  const last = list[list.length - 1];
  if (last.endedAt && (isClosed(item.status) || item.status === "paused" || item.status === "failed"))
    return { start, end: last.endedAt, minutes: minutesBetween(start, last.endedAt), live: false };
  return { start, end: null, minutes: minutesBetween(start, o.syncedAt), live: true };
}

/** 行内“当前步骤 / 最新活动” */
export function activityText(o: Orchestration, item: WorkItem) {
  const a = latestAttempt(o, item);
  if (item.status === "done") return a?.endedAt ? `完成于 ${clockTime(a.endedAt)}` : item.completedAt ? `完成于 ${clockTime(item.completedAt)}` : "已完成";
  if (item.status === "paused") return item.statusReason ?? "已暂停，回到原会话继续";
  if (item.status === "queued") return "排队中，等待执行资源";
  if (item.status === "cancelled") return item.statusReason ?? "已取消";
  if (item.status === "blocked") {
    const waitFor = item.dependsOnTaskIds.map((d) => o.items[d]).filter((d) => d && !isClosed(d.status));
    return waitFor.length ? `等待：${waitFor.map((d) => d.title).join("、")}` : "等待前置";
  }
  if (item.status === "waiting_reply" || item.status === "waiting_permission")
    return `${WORK_LABEL[item.status]} · ${clockTime(item.waiting?.since ?? a?.startedAt)} 起`;
  if (item.status === "failed") return item.statusReason ?? "执行失败";
  if (a?.step?.total) return `已完成 ${a.step.completed ?? 0}/${a.step.total} 步 · ${a.step.label}`;
  if (a?.step) return `阶段 · ${a.step.label}`;
  if (a) return `最新活动 ${clockTime(latestRound(o, item)?.at ?? a.startedAt)}`;
  // 没有执行记录（人工 / 未安排 / 待委派）：显示预期结果
  if (item.expected) return item.expected;
  return WORK_LABEL[item.status];
}

export interface OrchSummary {
  total: number;
  done: number;
  running: number;
  queued: number;
  paused: number;
  mine: number;
  blocked: number;
  failed: number;
  pending: WorkItem[];
  subAgents: number;
  nestedAgents: number;
  elapsed: number;
  tokens: { value: number | null; recorded: number; coordination: number | null; partial: boolean };
  overall: { status: WorkStatus; label: string; reason: string | null };
}

export function summarize(snap: Snapshot, o: Orchestration): OrchSummary {
  const task = snap.tasks[o.taskId];
  const tops = topItems(o);
  const all = o.itemOrder.map((id) => o.items[id]);
  const pending = all.filter((w) => isPending(w.status));
  const execs = Object.values(o.executors);
  const direct = execs.filter((e) => e.parentExecutorId === o.mainExecutorId).length;
  const nested = execs.filter((e) => e.parentExecutorId && e.parentExecutorId !== o.mainExecutorId).length;

  let recorded = 0;
  let partial = false;
  for (const a of Object.values(o.attempts)) {
    if (a.tokens == null) partial = true;
    else recorded += a.tokens;
  }
  if (o.coordinationTokens == null) partial = true;
  const value = recorded + (o.coordinationTokens ?? 0);

  const blockedTitles = tops.filter((w) => w.status === "blocked").map((w) => w.title);
  let overall: OrchSummary["overall"];
  if (task?.completion) overall = { status: "done", label: "已完成", reason: null };
  else if (tops.length > 0 && tops.every((w) => w.status === "cancelled"))
    overall = { status:"cancelled", label:"已取消", reason:null };
  else if (tops.length > 0 && tops.every((w) => isClosed(w.status)))
    overall = {
      status: "review",
      label: "待验收 · 子任务已全部结束",
      reason: "子任务结束不等于主任务完成：等主 Agent 汇总测试，或由你确认后完成。",
    };
  else if (all.some((w) => isActive(w.status)))
    overall = {
      status: "running",
      label: pending.length ? `进行中 · ${pending.length} 项待处理` : "进行中",
      reason: null,
    };
  else if (pending.length) {
    const first = pending[0];
    overall = {
      status: first.status,
      label: `等待 · ${pending.length} 项待处理`,
      reason: `所有可推进分支都在等待：${pending.map((w) => `${w.title}（${WORK_LABEL[w.status]}）`).join("、")}${
        blockedTitles.length ? `，挡住${blockedTitles.join("、")}` : ""
      }。`,
    };
  } else if (all.some((w) => w.status === "queued")) {
    overall = { status:"queued", label:"排队中", reason:"等待执行资源，尚未开始运行。" };
  } else if (all.some((w) => w.status === "paused")) {
    overall = { status:"paused", label:"已暂停", reason:"回到原会话继续。" };
  } else if (all.some((w) => w.status === "not_started")) {
    const n = all.filter((w) => w.status === "not_started").length;
    overall = { status: "not_started", label: `待推进 · ${n} 项未开始`, reason: null };
  } else
    overall = {
      status: "blocked",
      label: "等待前置",
      reason: blockedTitles.length ? `${blockedTitles.join("、")}在等前置任务完成。` : null,
    };

  return {
    total: tops.length,
    done: tops.filter((w) => w.status === "done").length,
    running: all.filter((w) => isActive(w.status)).length,
    queued: all.filter((w) => w.status === "queued").length,
    paused: all.filter((w) => w.status === "paused").length,
    mine: all.filter((w) => w.status === "waiting_reply" || w.status === "waiting_permission").length,
    blocked: tops.filter((w) => w.status === "blocked").length,
    failed: all.filter((w) => w.status === "failed").length,
    pending,
    subAgents: direct,
    nestedAgents: nested,
    elapsed: minutesBetween(o.startedAt, o.syncedAt),
    tokens: { value, recorded, coordination: o.coordinationTokens, partial },
    overall,
  };
}

/** 并行轨道：按时间区间贪心分配车道，并行的子任务不会被串成连续工时 */
export function parallelLanes(o: Orchestration) {
  const spans = o.itemOrder
    .map((id) => o.items[id])
    .flatMap((w) =>
      attemptsOf(o, w).map((a) => ({
        id: w.id,
        attemptId: a.id,
        start: a.startedAt,
        end: a.endedAt ?? o.syncedAt,
        live: !a.endedAt,
      })),
    )
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const laneEnds: number[] = [];
  return spans.map((s) => {
    const st = toMinutes(s.start);
    let lane = laneEnds.findIndex((end) => end <= st);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = Math.max(toMinutes(s.end), st + 1);
    return { ...s, lane };
  });
}

/** 执行栏／菜单栏使用的待处理子任务（未完成主任务） */
export function pendingWork(snap: Snapshot) {
  const out: { orch: Orchestration; item: WorkItem }[] = [];
  for (const o of Object.values(snap.orchestrations ?? {})) {
    if (snap.tasks[o.taskId]?.completion) continue;
    for (const id of o.itemOrder) if (isPending(o.items[id].status)) out.push({ orch: o, item: o.items[id] });
  }
  return out;
}

export const clock = (m: number) => fromMinutes(m);
