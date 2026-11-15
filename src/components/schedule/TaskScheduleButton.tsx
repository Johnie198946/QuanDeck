import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import { formatDuration } from "../../data/format";
import { pathOf } from "../../data/orchestration";
import { planRanges, rangeMinutes } from "../../data/timeline";
import type { PlanItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import "./schedule-editor.css";

/** One entry point shared by journal rows, subtask rows and the schedule panel. */
export function TaskScheduleButton({ taskId, itemId, compact = false }: {
  taskId?: string;
  itemId?: string;
  compact?: boolean;
}) {
  const { snap } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const linked = taskId && snap.plans.find(p => p.taskId === taskId && p.workItemId === itemId);
  const title = itemId && taskId ? snap.orchestrations?.[taskId]?.items[itemId]?.title : taskId ? snap.tasks[taskId]?.title : "已有任务";
  return <>
    <button type="button" className={compact ? "qd-icon-btn qd-schedule-trigger" : "qd-text-btn qd-schedule-trigger"}
      aria-label={`${linked ? "调整日程" : "安排日程"}：${title}`} title={linked ? `${linked.start} · ${linked.minutes} 分钟，点击调整` : "安排到日程"}
      onClick={e => { e.stopPropagation(); setOpen(true); }}>
      <Icon name="calendar" size={15}/>{!compact && <span>{linked ? linked.start : "安排日程"}</span>}
    </button>
    {open && createPortal(<TaskScheduleDialog initialTaskId={taskId} initialItemId={itemId} onClose={() => setOpen(false)}/>, document.body)}
  </>;
}

function TaskScheduleDialog({ initialTaskId, initialItemId, onClose }: {
  initialTaskId?: string; initialItemId?: string; onClose: () => void;
}) {
  const { snap, api, toast } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [taskId, setTaskId] = useState(initialTaskId ?? Object.keys(snap.tasks)[0] ?? "");
  const [itemId, setItemId] = useState(initialItemId ?? "");
  const existing = snap.plans.find(p => p.taskId === taskId && (p.workItemId ?? "") === itemId);
  const [start, setStart] = useState(existing?.start ?? snap.now);
  const [minutes, setMinutes] = useState(existing?.minutes ?? snap.tasks[taskId]?.estimate ?? 30);
  const [kind, setKind] = useState<PlanItem["kind"]>(existing?.kind ?? "flexible");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = snap.tasks[taskId];
  const orchestration = snap.orchestrations?.[taskId];
  const item = itemId ? orchestration?.items[itemId] : undefined;
  const actual = existing ? rangeMinutes(planRanges(existing, snap)) : 0;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); trigger?.focus(); };
  }, []);

  const changeScope = (nextTaskId: string, nextItemId: string) => {
    setTaskId(nextTaskId); setItemId(nextItemId); setError("");
    const plan = snap.plans.find(p => p.taskId === nextTaskId && (p.workItemId ?? "") === nextItemId);
    setStart(plan?.start ?? snap.now);
    setMinutes(plan?.minutes ?? snap.tasks[nextTaskId]?.estimate ?? 30);
    setKind(plan?.kind ?? "flexible");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!task || busy) return;
    setBusy(true); setError("");
    try {
      await api.addPlan({ taskId, ...(itemId ? { workItemId: itemId } : {}), title: item?.title ?? task.title, start, minutes, kind });
      toast(`${existing ? "已调整" : "已安排"}日程：${start} · ${item?.title ?? task.title}`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  };

  return <dialog ref={dialog} className="qd-schedule-dialog" aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <header><div><span className="qd-schedule-kicker">{snap.dateLabel}</span><h2 id={titleId}>{existing ? "调整日程" : "安排到日程"}</h2></div>
      <button type="button" className="qd-icon-btn" aria-label="关闭日程安排" disabled={busy} onClick={onClose}><Icon name="close" size={18}/></button>
    </header>
    <form onSubmit={submit}>
      <label>关联任务<select aria-label="关联任务" value={taskId} onChange={e => changeScope(e.target.value, "")} disabled={busy} required>
        {Object.values(snap.tasks).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select></label>
      {orchestration && orchestration.itemOrder.length > 0 && <label>安排范围<select aria-label="安排范围" value={itemId} onChange={e => changeScope(taskId, e.target.value)} disabled={busy}>
        <option value="">整个任务</option>
        {orchestration.itemOrder.map(id => orchestration.items[id]).filter(Boolean).map(w => <option key={w.id} value={w.id}>
          {pathOf(orchestration,w.id).map(part => part.title).join(" / ")}
        </option>)}
      </select></label>}
      <div className="qd-schedule-fields">
        <label>开始时间<input aria-label="开始时间" type="time" required value={start} onChange={e => setStart(e.target.value)} disabled={busy}/></label>
        <label>预计分钟<input aria-label="预计分钟" type="number" min={1} max={1440} step={1} required value={minutes} onChange={e => setMinutes(Number(e.target.value))} disabled={busy}/></label>
        <label>安排方式<select aria-label="安排方式" value={kind} onChange={e => setKind(e.target.value as PlanItem["kind"])} disabled={busy}><option value="flexible">弹性</option><option value="fixed">固定</option></select></label>
      </div>
      <p className="qd-schedule-explanation">日程与原任务保持关联。{itemId ? "这项子任务及其下级" : "整个任务及其子任务"}的实际执行时间会同步到时间线。</p>
      {existing && <p className="qd-schedule-existing"><Icon name="link" size={14}/>已关联同一条日程{actual > 0 ? ` · 实际 ${formatDuration(actual)}` : ""}，保存会更新安排。</p>}
      {error && <p className="qd-dialog-error" role="alert">{error}</p>}
      {!task && <p role="status">先在日记里写下一项待办，再安排时间。</p>}
      <footer><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="qd-btn primary" disabled={busy || !task}>{busy ? "保存中…" : "保存安排"}</button></footer>
    </form>
  </dialog>;
}
