import { useEffect } from "react";
import { formatDuration } from "../../data/format";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { timelinePlanTotals, planRanges, rangeMinutes, timeInZone, dayBounds, planFinished } from "../../data/timeline";
import { TaskScheduleButton } from "./TaskScheduleButton";

/** 完整计划与真实执行区间对照。 */
export function ScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snap, hoverPlan, setHoverPlan, locateTask, selectWork } = useWorkdeck();
  const totals = timelinePlanTotals(snap);
  const zone = snap.project.timeZone ?? "Asia/Shanghai";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`qd-sheet-layer ${open ? "is-open" : ""}`}
      aria-hidden={!open}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="qd-sheet" role="dialog" aria-modal="true" aria-label="完整日程">
        <header className="qd-panel-head">
          <h2>完整日程 · {snap.dateLabel}</h2>
          <button type="button" className="qd-icon-btn" onClick={onClose} aria-label="关闭日程">
            <Icon name="close" size={18} />
          </button>
        </header>
        <dl className="qd-sheet-totals">
          <div>
            <dt>计划总量</dt>
            <dd>{formatDuration(totals.planned)}</dd>
          </div>
          <div>
            <dt>实际墙钟</dt>
            <dd>{formatDuration(totals.actual)}</dd>
          </div>
          <div>
            <dt>偏差</dt>
            <dd>
              {totals.actual - totals.planned > 0 ? "+" : "−"}
              {formatDuration(Math.abs(totals.actual - totals.planned))}
            </dd>
          </div>
          <div>
            <dt>未完成</dt>
            <dd>{totals.unfinished}</dd>
          </div>
        </dl>
        <table className="qd-plan-table">
          <thead>
            <tr>
              <th scope="col">计划</th>
              <th scope="col">事项</th>
              <th scope="col">类型</th>
              <th scope="col">实际</th>
            </tr>
          </thead>
          <tbody>
            {snap.plans.map((p) => {
              const ranges = planRanges(p, snap);
              const actual = rangeMinutes(ranges);
              return (
                <tr
                  key={p.id}
                  className={hoverPlan === p.id ? "is-hover" : ""}
                  onMouseEnter={() => setHoverPlan(p.id)}
                  onMouseLeave={() => setHoverPlan(null)}
                >
                  <td className="qd-num">
                    {p.start} · {p.minutes}m
                  </td>
                  <td>
                    {p.taskId ? (
                      <button
                        type="button"
                        className="qd-link"
                        onClick={() => {
                          onClose();
                          locateTask(p.taskId!);
                          if (p.workItemId) selectWork(p.taskId!, p.workItemId);
                        }}
                      >
                        {p.title}
                      </button>
                    ) : (
                      p.title
                    )}
                    {p.taskId && <TaskScheduleButton taskId={p.taskId} itemId={p.workItemId} compact />}
                  </td>
                  <td>{p.kind === "fixed" ? "固定" : "弹性"}</td>
                  <td className="qd-num">
                    {ranges.length
                      ? `${ranges.map(([a, b]) => `${timeInZone(a,zone)}—${b === dayBounds(snap.date,zone)[1] ? "24:00" : timeInZone(b,zone)}`).join("，")} · ${formatDuration(actual)}${planFinished(p,snap) ? " · 完成" : ""}`
                      : "未开始"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="qd-panel-note">
          实际按关联任务的执行时间与手动记录计算；并行区间合并，不等于个人工时。
          Agent 等待回复或权限时停止计时，恢复后另记一段。时区：{zone}。
        </p>
      </section>
    </div>
  );
}
