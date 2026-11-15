import { VIEW_LABEL, VIEW_TONE } from "../../data/derive";
import type { TaskView } from "../../data/derive";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

/** 每个状态独立的小图标 + 文字，不只靠颜色表达；无循环动画。 */
const VIEW_ICON: Partial<Record<TaskView, IconName>> = {
  submitting: "send",
  acknowledged: "inbox",
  unknown: "help-circle",
  rejected: "x-circle",
  running: "play",
  paused: "pause",
  cancelled: "close",
  waiting_reply: "reply",
  waiting_permission: "lock",
  failed: "x-circle",
  archived: "check",
  done: "check-circle",
};

export function StatusPill({
  view,
  label,
  quiet = false,
}: {
  view: TaskView;
  label?: string;
  /** 安静样式：只有图标和文字，无底色（用于完成等低优先级状态） */
  quiet?: boolean;
}) {
  const tone = VIEW_TONE[view];
  const icon = VIEW_ICON[view];
  return (
    // key 让文字切换时触发 160ms 交叉淡入（M06）
    <span
      key={view}
      className={`qd-pill tone-${tone} ${quiet || tone === "done" ? "is-quiet" : ""}`}
      data-view={view}
    >
      {icon && <Icon name={icon} size={12} className="qd-pill-icon" />}
      {label ?? VIEW_LABEL[view]}
    </span>
  );
}
