import { TaskIcon } from "../ui/TaskIcon";
import "../ui/task-label.css";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  activityText,
  childrenOf,
  whoLabel,
  FILTERS,
  matchFilter,
  pathOf,
  summarize,
  topItems,
  WORK_LABEL,
} from "../../data/orchestration";
import type { WorkFilter } from "../../data/orchestration";
import { formatDuration, formatTokens } from "../../data/format";
import type { Orchestration, WorkItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { WorkDetail } from "../work/WorkDetail";
import { WorkIcon, WorkPill } from "../work/WorkStatus";

const SEARCH_AT = 12;
// 图标与活动文字不足以说明时才写状态词
const SHOW_LABEL = new Set(["failed", "queued", "not_started", "cancelled"]);

/**
 * 执行栏的主任务范围：面包屑 + 返回；子任务树按阶段组织，已完成分组默认收起；
 * 选中项在行下方展开栏内详情，滚动位置与选择保持不变。
 */
export function TaskScope({
  o,
  embedded = false,
  selectedId,
  onSelect,
}: {
  o: Orchestration;
  /** 事项工作区中复用：无执行栏面包屑，详情在右栏 */
  embedded?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const { snap, agentOf, scope, selectWork, leaveScope, locateTask } = useWorkdeck();
  const sum = summarize(snap, o);
  const agent = o.mainAgentId ? agentOf(o.mainAgentId) : null;
  const task = snap.tasks[o.taskId];
  const selected = embedded ? (selectedId ?? null) : (scope?.itemId ?? null);
  const pick = (id: string | null) => (embedded ? onSelect?.(id) : selectWork(o.taskId, id));
  const items = Object.values(o.items);
  const byOwner = {
    me: items.filter((w) => w.owner === "me" && w.status !== "cancelled").length,
    agent: items.filter((w) => (w.owner === "agent" || w.executorId) && w.status !== "cancelled")
      .length,
    none: items.filter((w) => w.owner === "unassigned" && !w.executorId && w.status !== "cancelled")
      .length,
  };
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [query, setQuery] = useState("");
  const [doneOpen, setDoneOpen] = useState<Record<string, boolean>>({});
  const [nestedOpen, setNestedOpen] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const all = o.itemOrder.map((id) => o.items[id]);

  // 选中（含从日记选中的）深层或已完成子任务：自动展开到它的路径，并滚到可见
  useEffect(() => {
    if (!selected || !o.items[selected]) return;
    const path = pathOf(o, selected);
    const top = path[0];
    setNestedOpen((m) => ({
      ...m,
      ...Object.fromEntries(path.slice(0, -1).map((p) => [p.id, true])),
    }));
    if (top.status === "done" || o.items[selected].status === "done")
      setDoneOpen((m) => ({ ...m, [top.phase]: true }));
    if (filter !== "all" && !matchFilter(o.items[selected], filter)) setFilter("all");
    // 让行和其下的详情一起可见（只在需要时滚动，保留其余滚动位置）
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = rootRef.current?.querySelector<HTMLElement>(`[data-scope-row="${selected}"]`);
        const box = row?.closest<HTMLElement>(".qd-rail-scroll");
        if (!row || !box) return;
        const detail = row.nextElementSibling as HTMLElement | null;
        const r = row.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const bottom = (detail ?? row).getBoundingClientRect().bottom;
        const sticky = 48;
        if (r.top < b.top + sticky) box.scrollTop -= b.top + sticky - r.top;
        else if (bottom > b.bottom)
          box.scrollTop += Math.min(bottom - b.bottom + 8, r.top - b.top - sticky);
      }),
    );
  }, [selected, o]);

  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.key, all.filter((w) => matchFilter(w, f.key)).length]),
  ) as Record<WorkFilter, number>;

  const q = query.trim();
  const visible = (w: WorkItem) => matchFilter(w, filter) && (!q || w.title.includes(q));

  const row = (w: WorkItem, depth: number, flat = false) => {
    const kids = flat ? [] : childrenOf(o, w.id);
    const kidsOpen = !!nestedOpen[w.id];
    const isSel = selected === w.id;
    const crumbs = flat
      ? pathOf(o, w.id)
          .slice(0, -1)
          .map((p) => p.title)
      : [];
    return (
      <li key={w.id} className={`qd-tree-item depth-${Math.min(depth, 3)}`}>
        <div
          className={`qd-tree-row status-${w.status} ${isSel ? "is-selected" : ""}`}
          data-scope-row={w.id}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              className="qd-subtask-fold"
              aria-expanded={kidsOpen}
              aria-label={`${kidsOpen ? "收起" : "展开"} ${w.title} 的 ${kids.length} 项下级子任务`}
              onClick={() => setNestedOpen((m) => ({ ...m, [w.id]: !kidsOpen }))}
            >
              <Icon name="chevron-right" size={13} className="qd-fold-icon" />
            </button>
          ) : (
            <span className="qd-subtask-fold" aria-hidden="true" />
          )}
          <WorkIcon status={w.status} />
          <button
            type="button"
            className="qd-tree-main"
            aria-expanded={isSel}
            onClick={() => pick(isSel && !embedded ? null : w.id)}
          >
            {crumbs.length > 0 && <span className="qd-tree-crumbs">{crumbs.join(" › ")} ›</span>}
            <span className="qd-tree-title"><span className="qd-task-label"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={w.id} size={18} /><span>{w.title}</span></span></span>
            <span className="qd-tree-meta">
              {SHOW_LABEL.has(w.status) && (
                <span className="qd-tree-status">{WORK_LABEL[w.status]}</span>
              )}
              <span>{whoLabel(o, w, (id) => agentOf(id)?.name)}</span>
              {embedded && w.source && <span className="qd-tree-src">v{w.source.version}</span>}
              {w.reviewNote && <span className="qd-tree-review">需复核</span>}
              <span className="qd-tree-activity">{activityText(o, w).replace("完成于 ", "")}</span>
            </span>
          </button>
        </div>
        {isSel && !embedded && <WorkDetail o={o} item={w} />}
        {kids.length > 0 && kidsOpen && (
          <ul className="qd-tree is-nested" aria-label={`${w.title} 的下级子任务`}>
            {kids.map((k) => row(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const phases = o.phases.map((phase) => {
    if (filter !== "all" || q) {
      const matches = all.filter((w) => w.phase === phase && visible(w));
      return { phase, active: matches, done: [] as WorkItem[], flat: true, tops: matches };
    }
    const tops = topItems(o).filter((w) => w.phase === phase);
    return {
      phase,
      active: tops.filter((w) => w.status !== "done" && w.status !== "cancelled"),
      done: tops.filter((w) => w.status === "done" || w.status === "cancelled"),
      flat: false,
      tops,
    };
  });
  const empty = phases.every((p) => p.active.length === 0 && p.done.length === 0);

  return (
    <div
      className="qd-scope"
      ref={rootRef}
      style={{ "--agent": agent?.color ?? "#8a929a" } as CSSProperties}
    >
      {!embedded && (
        <nav className="qd-scope-crumbs" aria-label="执行范围">
          <button
            type="button"
            className="qd-scope-back"
            onClick={leaveScope}
            aria-label="返回全部执行"
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button type="button" className="qd-link" onClick={leaveScope}>
            全部执行
          </button>
          <span aria-hidden="true">›</span>
          <span className="qd-scope-agent">{agent?.name ?? "人工协调"}</span>
          <span aria-hidden="true">›</span>
          <strong aria-current="page">{o.label}</strong>
        </nav>
      )}

      <header className="qd-scope-head">
        {!embedded && (
          <button
            type="button"
            className="qd-scope-title"
            onClick={() => locateTask(o.taskId)}
            title="定位到日记"
          >
            <span className="qd-task-label"><TaskIcon snapshot={snap} taskId={o.taskId} size={22} /><span>{task?.title}</span></span>
          </button>
        )}
        <WorkPill status={sum.overall.status} label={sum.overall.label} />
        {!o.mainAgentId ? (
          <p className="qd-scope-counts">
            {sum.done}/{sum.total} 完成 · 我 {byOwner.me} · Agent {byOwner.agent} · 未安排{" "}
            {byOwner.none}
            {sum.tokens.recorded > 0 && ` · Agent 用量 ${formatTokens(sum.tokens.recorded)}`}
          </p>
        ) : (
          <p
            className="qd-scope-counts"
            title={`${o.startedAt} 起，截至 ${o.syncedAt} 同步，并行不累加 · 子任务记录 ${formatTokens(sum.tokens.recorded)} + 主协调 ${formatTokens(sum.tokens.coordination)}，按执行记录去重`}
          >
            {sum.done}/{sum.total} 完成 · 已用 {formatDuration(sum.elapsed)} ·{" "}
            {o.capabilities.tokens ? formatTokens(sum.tokens.value) : "token 尚未接入"}
          </p>
        )}
        {sum.overall.reason && sum.overall.status !== "running" && (
          <p className="qd-scope-reason">{sum.overall.reason}</p>
        )}
      </header>

      <div className="qd-filters" role="toolbar" aria-label="筛选子任务">
        {FILTERS.filter((f) => f.key === "all" || f.key === filter || counts[f.key] > 0).map(
          (f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              className={filter === f.key ? "is-on" : ""}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span>{counts[f.key]}</span>
            </button>
          ),
        )}
      </div>
      {all.length >= SEARCH_AT && (
        <label className="qd-scope-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按任务名搜索"
            aria-label="按任务名搜索子任务"
          />
        </label>
      )}

      {empty && (
        <p className="qd-muted pad">
          没有符合“{FILTERS.find((f) => f.key === filter)?.label}”的子任务。
        </p>
      )}
      {phases.map((p) =>
        p.active.length === 0 && p.done.length === 0 ? null : (
          <section key={p.phase} className="qd-phase" aria-label={`阶段：${p.phase}`}>
            <h3 className="qd-phase-title">
              {p.phase}
              {!p.flat && (
                <span>
                  {p.done.length}/{p.tops.length} 完成
                </span>
              )}
            </h3>
            <ul className="qd-tree">{p.active.map((w) => row(w, 0, p.flat))}</ul>
            {p.done.length > 0 && (
              <div className="qd-phase-done">
                <button
                  type="button"
                  className="qd-fold"
                  aria-expanded={!!doneOpen[p.phase]}
                  onClick={() => setDoneOpen((m) => ({ ...m, [p.phase]: !m[p.phase] }))}
                >
                  <Icon name="chevron-right" size={13} className="qd-fold-icon" />
                  已完成 {p.done.length}
                </button>
                {doneOpen[p.phase] && (
                  <ul className="qd-tree is-done">{p.done.map((w) => row(w, 0))}</ul>
                )}
              </div>
            )}
          </section>
        ),
      )}
    </div>
  );
}
