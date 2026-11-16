import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  activityText,
  childrenOf,
  whoLabel,
  latestRound,
  pathOf,
  summarize,
  topItems,
  latestAttempt,
  WORK_LABEL,
} from "../../data/orchestration";
import { formatDuration, formatTokens, lastSentence, clockTime } from "../../data/format";
import type { Orchestration, WorkItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { WorkIcon } from "../work/WorkStatus";
import { TaskProgress } from "./TaskProgress";
import { TaskScheduleButton } from "../schedule/TaskScheduleButton";

// 行内只在图标与活动文字不足以说明时才写状态词
const SHOW_LABEL = new Set(["failed", "queued", "not_started", "cancelled"]);

/**
 * 主任务执行摘要（日记中的同一条主任务记录）：
 * 默认只显示摘要与需要人处理的事项；“展开子任务”后为轻量缩进列表，选择与执行栏联动。
 */
export function OrchestrationBlock({ o }: { o: Orchestration }) {
  const { snap, agentOf, scope, selectWork, subtasksOpen, setSubtasksOpen, openSourceSession, openAttemptSource } = useWorkdeck();
  const sum = summarize(snap, o);
  const agent = agentOf(o.mainAgentId!);
  const main = snap.sessions[o.mainSessionId!];
  const lastMain = main?.rounds[main.rounds.length - 1];
  const open = !!subtasksOpen[o.taskId];
  const selected = scope?.taskId === o.taskId ? scope.itemId : null;
  const [nestedOpen, setNestedOpen] = useState<Record<string, boolean>>({});

  // 选中深层子任务时，自动展开到它的路径
  useEffect(() => {
    if (!selected || !o.items[selected]) return;
    const ancestors = pathOf(o, selected).slice(0, -1);
    if (ancestors.length) setNestedOpen((m) => ({ ...m, ...Object.fromEntries(ancestors.map((a) => [a.id, true])) }));
  }, [selected, o]);

  const tokenText = !o.capabilities.tokens
    ? "token 尚未接入"
    : `${formatTokens(sum.tokens.value)}${sum.tokens.partial ? "（部分未同步）" : ""}`;

  const row = (w: WorkItem, depth: number) => {
    const kids = childrenOf(o, w.id);
    const kidsOpen = !!nestedOpen[w.id];
    const round = latestRound(o, w);
    const attempt = latestAttempt(o, w);
    const isSel = selected === w.id;
    return (
      <li key={w.id}>
        <div
          className={`qd-subtask status-${w.status} ${isSel ? "is-selected" : ""}`}
          data-work-row={w.id}
          tabIndex={-1}
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
            className="qd-subtask-main"
            aria-pressed={isSel}
            onClick={() => selectWork(o.taskId, w.id)}
          >
            <span className="qd-subtask-title qd-task-name"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={w.id} size={18} /><span>{w.title}</span></span>
            <span className="qd-subtask-meta">
              {SHOW_LABEL.has(w.status) && <span>{WORK_LABEL[w.status]}</span>}
              <span>{whoLabel(o, w, (id) => agentOf(id)?.name)}</span>
              <span>{activityText(o, w).replace("完成于 ", "")}</span>
              {kids.length > 0 && !kidsOpen && <span>{kids.length} 项下级</span>}
            </span>
            {round && w.status !== "done" && (
              <span className="qd-subtask-reply">
                {clockTime(round.at, snap.project.timeZone)} · “{lastSentence(round.reply)}”
              </span>
            )}
          </button>
          <TaskScheduleButton taskId={o.taskId} itemId={w.id} compact />
          {attempt && <button type="button" className="qd-icon-btn qd-subtask-source"
            aria-label={`打开 ${w.title} 的 Agent 会话`} title="打开这次执行的 Agent 会话"
            onClick={() => openAttemptSource(o.taskId, attempt.id)}><Icon name="external" size={15} /></button>}
        </div>
        {kids.length > 0 && kidsOpen && (
          <ul className="qd-subtasks is-nested" aria-label={`${w.title} 的下级子任务`}>
            {kids.map((k) => row(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="qd-orch" style={{ "--agent": agent.color } as CSSProperties} data-orch={o.taskId}>
      {o.mainAgentId && o.mainSessionId && <div className="qd-run">
        <span className="qd-run-seg qd-run-agent">
          <AgentLogo agent={agent} size={18} />
          {agent.name}
        </span>
        <span className="qd-run-seg" title={`${o.startedAt} 起，截至 ${o.syncedAt} 同步；并行分支不累加`}>
          已用 {formatDuration(sum.elapsed)}
        </span>
        <span
          className="qd-run-seg"
          title={`子任务记录 ${formatTokens(sum.tokens.recorded)} + 主协调 ${formatTokens(sum.tokens.coordination)}，按执行记录去重`}
        >
          {tokenText}
        </span>
        <button type="button" className="qd-link qd-run-seg" onClick={() => openSourceSession(o.mainSessionId!)}>
          打开会话
          <Icon name="external" size={12} />
        </button>
      </div>}

      <TaskProgress o={o} />

      {lastMain && (
        <p className="qd-orch-reply">
          <span>{clockTime(lastMain.at, snap.project.timeZone)}</span>“{lastSentence(lastMain.reply)}”
        </p>
      )}

      {sum.overall.reason && sum.overall.status !== "running" && (
        <p className={`qd-orch-reason tone-${sum.overall.status === "review" ? "review" : "wait"}`}>
          <Icon name={sum.overall.status === "review" ? "check-square" : "alert"} size={14} />
          {sum.overall.reason}
        </p>
      )}

      {sum.pending.length > 0 && (
        <ul className="qd-orch-pending" aria-label="需要你处理的子任务">
          {sum.pending.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => selectWork(o.taskId, w.id)} aria-label={`查看 ${w.title}`}>
                <span className="qd-orch-pending-kind">
                  <WorkIcon status={w.status} size={13} />
                  {WORK_LABEL[w.status]} · {w.title}
                </span>
                <span className="qd-orch-pending-q">{w.waiting?.question ?? w.statusReason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="qd-orch-actions">
        <button
          type="button"
          className="qd-fold"
          aria-expanded={open}
          onClick={() => setSubtasksOpen(o.taskId, !open)}
        >
          <Icon name="chevron-right" size={13} className="qd-fold-icon" />
          子任务 {sum.total}
        </button>
      </div>
      <div className={`qd-collapse ${open ? "is-open" : ""}`}>
        <div className="qd-collapse-inner">
          {open && (
            <ul className="qd-subtasks" aria-label={`${o.label} 的子任务`}>
              {topItems(o).map((w) => row(w, 0))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
