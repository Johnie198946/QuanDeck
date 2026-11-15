import type { CSSProperties } from "react";
import { WORK_LABEL, WORK_TONE } from "../../data/orchestration";
import type { Step, WorkStatus } from "../../data/types";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";

export const WORK_ICON: Record<WorkStatus, IconName> = {
  not_started: "dot",
  queued: "inbox",
  paused: "pause",
  running: "play",
  waiting_reply: "reply",
  waiting_permission: "lock",
  blocked: "link",
  failed: "x-circle",
  review: "check-square",
  done: "check-circle",
  cancelled: "close",
};

/** 子任务状态：独立小图标 + 文字，不只靠颜色 */
export function WorkPill({ status, label }: { status: WorkStatus; label?: string }) {
  return (
    <span className={`qd-pill tone-${pillTone(status)} ${status === "done" ? "is-quiet" : ""}`} data-work={status}>
      <Icon name={WORK_ICON[status]} size={12} className="qd-pill-icon" />
      {label ?? WORK_LABEL[status]}
    </span>
  );
}

function pillTone(s: WorkStatus) {
  const t = WORK_TONE[s];
  return t === "run" ? "running" : t === "wait" ? "waiting" : t === "error" ? "error" : t === "done" ? "done" : t === "review" ? "review" : "muted";
}

export function WorkIcon({ status, size = 14 }: { status: WorkStatus; size?: number }) {
  return (
    <span className={`qd-work-icon tone-${WORK_TONE[status]}`} aria-hidden="true">
      <Icon name={WORK_ICON[status]} size={size} />
    </span>
  );
}

/** 子任务步骤条：只有源端给出可核验总步骤时使用 */
export function StepTrack({
  step,
  color,
  label,
  status,
}: {
  step: Step;
  color: string;
  label: string;
  status: WorkStatus;
}) {
  const total = step.total ?? 0;
  const done = Math.max(0, Math.min(step.completed ?? 0, total));
  if (!Number.isFinite(total) || total <= 0) return null;
  const segments = Math.min(total, 12);
  const filled = Math.floor(done / total * segments);
  const state =
    status === "running" ? "flowing" : status === "failed" ? "stopped" : status === "done" ? "complete" : "paused";
  return (
    <span className={`qd-progress is-${state} mode-steps is-compact`} style={{ "--agent": color } as CSSProperties}>
      <span
        className="qd-progress-track"
        role="progressbar"
        aria-label={`${label} 步骤`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`已完成 ${done}/${total} 步，当前：${step.label}，${WORK_LABEL[status]}`}
      >
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={`qd-seg-cell ${i < filled ? "is-done" : ""} ${i === filled && done < total ? "is-current" : ""}`}
          />
        ))}
      </span>
    </span>
  );
}
