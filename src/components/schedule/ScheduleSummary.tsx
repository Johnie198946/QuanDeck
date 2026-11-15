import { useState } from "react";
import type { FormEvent } from "react";
import { formatDuration, toMinutes } from "../../data/format";
import type { PlanItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { AgentSwatch } from "../ui/AgentBadge";
import { Icon } from "../ui/Icon";
import { Spiral } from "./Spiral";
import { orchOf } from "../../data/orchestration";
import { timelinePlanTotals, planFinished } from "../../data/timeline";
import { TaskScheduleButton } from "./TaskScheduleButton";

export function ScheduleSummary({ onExpand }: { onExpand: () => void }) {
  const { snap, api, hoverPlan, setHoverPlan, toast, scope, subtasksOpen, workspace, locateTask, selectWork, closeWorkspace } = useWorkdeck();
  // 聚焦主任务（执行栏任务范围或日记展开子任务）时，螺旋显示子任务并行细轨道
  const focusOrch = orchOf(
    snap,
    scope?.taskId ??
      (workspace?.view === "tasks" ? workspace.taskId : null) ??
      Object.keys(subtasksOpen).find((k) => subtasksOpen[k]) ??
      null,
  );
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: "",
    start: "21:15",
    minutes: 20,
    kind: "flexible" as PlanItem["kind"],
  });
  const nowMin = toMinutes(snap.now);
  const totals = timelinePlanTotals(snap);
  const upcoming = snap.plans
    .filter((p) => !planFinished(p, snap) && toMinutes(p.start) >= nowMin)
    .slice(0, 2);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await api.addPlan({
      title: form.title.trim(),
      start: form.start,
      minutes: Number(form.minutes) || 15,
      kind: form.kind,
    });
    toast(`已添加计划：${form.start} ${form.title.trim()}`);
    setForm({ ...form, title: "" });
    setAdding(false);
  };

  return (
    <aside className="qd-schedule" aria-label="今日日程摘要">
      <div className="qd-date">
        <h2>{snap.dateLabel}</h2>
      </div>

      <section className="qd-rhythm">
        <h3 className="qd-section-title">今日节奏</h3>
        <div className="qd-dial">
          <Spiral
            snap={snap}
            hoverPlan={hoverPlan}
            size={184}
            focusTaskId={focusOrch?.taskId}
            onLocate={(taskId, itemId) => { closeWorkspace(); locateTask(taskId); if (itemId) selectWork(taskId, itemId); }}
            onPlan={(id) => { setHoverPlan(id); onExpand(); }}
          />
        </div>
        <ul className="qd-dial-legend" aria-label="图例">
          <li>
            <span className="qd-key plan" aria-hidden="true" />
            计划
          </li>
          <li>
            <span className="qd-key actual" aria-hidden="true" />
            实际
          </li>
          {snap.agents
            .filter(
              (a) => a.tracked && snap.activity.some((iv) => iv.agentId === a.id),
            )
            .map((a) => (
              <li key={a.id}>
                <AgentSwatch agent={a} size={8} />
                {a.short}
              </li>
            ))}
        </ul>
        {focusOrch && <p className="qd-timeline-focus">{focusOrch.label} · 点击色段查看任务</p>}
        <dl className="qd-plan-totals">
          <div>
            <dt>计划</dt>
            <dd>{formatDuration(totals.planned)}</dd>
          </div>
          <div>
            <dt title="关联任务与手动记录的时间并集，并行不重复累计">实际</dt>
            <dd>{formatDuration(totals.actual)}</dd>
          </div>
        </dl>
        <p className="qd-timeline-context" title={`时区：${snap.project.timeZone ?? "Asia/Shanghai"}；并行区间取并集`}>全天 · 并行时段已合并</p>
      </section>

      <section className="qd-upcoming">
        <h3 className="qd-section-title">接下来</h3>
        {upcoming.length === 0 ? (
          <p className="qd-muted">今天没有剩余计划。</p>
        ) : (
          <ul>
            {upcoming.map((p) => (
              <li
                key={p.id}
                tabIndex={0}
                onMouseEnter={() => setHoverPlan(p.id)}
                onMouseLeave={() => setHoverPlan(null)}
                onFocus={() => setHoverPlan(p.id)}
                onBlur={() => setHoverPlan(null)}
                className={hoverPlan === p.id ? "is-hover" : ""}
              >
                <span className="qd-up-time">{p.start}</span>
                {p.taskId ? <button type="button" className="qd-up-title qd-link" onClick={() => {
                  closeWorkspace(); locateTask(p.taskId!); if (p.workItemId) selectWork(p.taskId!, p.workItemId);
                }}>{p.title}</button> : <span className="qd-up-title">{p.title}</span>}
                <span className="qd-up-kind">{p.kind === "fixed" ? "固定" : "弹性"}</span>
                <span className="qd-up-dur">
                  <Icon name="clock" size={14} />
                  {p.minutes}m
                </span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="qd-text-btn" onClick={onExpand}>
          展开日程
          <Icon name="arrow-right" size={15} />
        </button>
      </section>

      <section className="qd-add-plan">
        <TaskScheduleButton />
        {adding ? (
          <form onSubmit={submit} className="qd-plan-form">
            <input
              autoFocus
              placeholder="计划名称"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              aria-label="计划名称"
            />
            <div className="qd-plan-form-row">
              <input
                type="time"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                aria-label="开始时间"
              />
              <input
                type="number"
                min={5}
                step={5}
                value={form.minutes}
                onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                aria-label="预计分钟"
              />
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as PlanItem["kind"] })}
                aria-label="类型"
              >
                <option value="flexible">弹性</option>
                <option value="fixed">固定</option>
              </select>
            </div>
            <div className="qd-plan-form-actions">
              <button type="button" className="qd-btn ghost small" onClick={() => setAdding(false)}>
                取消
              </button>
              <button type="submit" className="qd-btn primary small" disabled={!form.title.trim()}>
                添加
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="qd-add-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} />
            添加计划
          </button>
        )}
      </section>
    </aside>
  );
}
