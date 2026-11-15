import type { CSSProperties } from "react";
import { sessionView } from "../../data/derive";
import type { Session } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";

const MAX_SEGMENTS = 12;

/**
 * 运行进度轨道（约 4px），任务行与执行栏共用同一数据源：
 * - 源端给出 completed/total：分段条，已完成段填充，当前段（第 completed+1 段）轻流动；
 * - 只有阶段文字：不定长流动条 + 当前阶段，不估算百分比或剩余时间；
 * - 仅当源端回执带真实百分比时显示确定百分比。
 * 待回复／待权限停止流动并标注；失败停止并保留已有进度；已归档不显示。
 */
export function RunProgress({ session, compact = false }: { session: Session; compact?: boolean }) {
  const { agentOf } = useWorkdeck();
  const view = sessionView(session);
  const waiting = view === "waiting_reply" || view === "waiting_permission";
  const failed = view === "failed";
  if (view !== "running" && !waiting && !failed) return null;

  const agent = agentOf(session.agentId);
  const step = session.step;
  const percent = session.percent ?? null;
  const total = step?.total ?? null;
  const done = Math.min(step?.completed ?? 0, total ?? 0);
  const mode: "percent" | "steps" | "unknown" =
    percent != null ? "percent" : total ? "steps" : "unknown";
  // 等待且没有可核验总量：旁边的等待提示已说明状态，不再画一条静止的空轨道
  if (waiting && mode === "unknown") return null;
  const state = waiting ? "paused" : failed ? "stopped" : "flowing";
  const stage = step?.label ?? "阶段未提供";

  const stateText = waiting
    ? view === "waiting_permission"
      ? "已暂停，待权限"
      : "已暂停，待回复"
    : failed
      ? "已停止，执行失败"
      : "运行中";
  const valueText =
    mode === "percent"
      ? `源端报告 ${Math.round(percent!)}%，当前：${stage}，${stateText}`
      : mode === "steps"
        ? `已完成 ${done}/${total} 步，当前：${stage}，${stateText}`
        : `总量未知，当前阶段：${stage}，${stateText}`;

  const aria =
    mode === "unknown"
      ? {}
      : mode === "percent"
        ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(percent!) }
        : { "aria-valuemin": 0, "aria-valuemax": total!, "aria-valuenow": done };

  const segs = mode === "steps" ? Math.min(total!, MAX_SEGMENTS) : 0;
  // 步数超过上限时按比例映射到 12 段，仍只填充已完成部分
  const filled = mode === "steps" ? Math.floor((done / total!) * segs) : 0;
  const current = mode === "steps" && done < total! ? filled : -1;

  const caption = mode === "percent" ? `源端 ${Math.round(percent!)}%` : null;

  return (
    <span
      className={`qd-progress is-${state} mode-${mode} ${compact ? "is-compact" : ""}`}
      style={{ "--agent": agent.color } as CSSProperties}
    >
      <span
        className="qd-progress-track"
        role="progressbar"
        aria-label={`${agent.name} 运行进度`}
        aria-valuetext={valueText}
        {...aria}
      >
        {mode === "steps" &&
          Array.from({ length: segs }, (_, i) => (
            <span
              key={i}
              className={`qd-seg-cell ${i < filled ? "is-done" : ""} ${i === current ? "is-current" : ""}`}
            />
          ))}
        {mode === "percent" && (
          <span className="qd-progress-fill" style={{ width: `${Math.max(0, Math.min(100, percent!))}%` }} />
        )}
        {mode === "unknown" && <span className="qd-progress-band" />}
      </span>
      {(failed || (!compact && mode === "percent")) && (
        <span className="qd-progress-caption">
          {failed ? (
            <>
              <Icon name="x-circle" size={12} />
              已停止{mode === "steps" && ` · 已完成 ${done}/${total} 步`}
            </>
          ) : (
            caption
          )}
        </span>
      )}
    </span>
  );
}
