import { workItemPresentation } from '../../data/workItemPresentation';
import { deriveProjectActivity } from '../../data/projectActivity';
import { DeleteWorkButton } from "../projects/DeleteWorkButton";
import { taskExecutionPresentation } from "../../data/taskExecutionPresentation";
import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  activityText,
  childrenOf,
  whoLabel,
  pathOf,
  summarize,
  topItems,
  latestAttempt,
} from "../../data/orchestration";
import { formatDuration, formatTokens } from "../../data/format";
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
  const { snap, agentOf, scope, selectWork, subtasksOpen, setSubtasksOpen, openSourceSession, openAttemptSource, openTaskDirection, openWorkspace } = useWorkdeck();
  const sum = summarize(snap, o);
  const execution = taskExecutionPresentation(snap, o.taskId);
  const activity = deriveProjectActivity(snap).entries;
  const displayOf = (item: WorkItem) => workItemPresentation(snap, o, item, activity);
  const pending = Object.values(o.items).filter(item => { const display=displayOf(item); return display.awaitingCompletion || ['waiting_permission','waiting_reply','failed'].includes(display.state); });
  const incomplete = pending.some(item => displayOf(item).awaitingCompletion);
  const agent = agentOf(o.mainAgentId!);
  const open = subtasksOpen[o.taskId] ?? true;
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
    const display = workItemPresentation(snap, o, w, activity);
    const state = display.state;
    const kids = childrenOf(o, w.id);
    const kidsOpen = !!nestedOpen[w.id];
    const attempt = latestAttempt(o, w);
    const isSel = selected === w.id;
    return (
      <li key={w.id}>
        <div
          className={`qd-subtask status-${state} ${isSel ? "is-selected" : ""}`}
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
          <WorkIcon status={state} />
          <button
            type="button"
            className="qd-subtask-main"
            aria-pressed={isSel}
            onClick={() => selectWork(o.taskId, w.id)}
          >
            <span className="qd-subtask-title qd-task-name"><TaskIcon snapshot={snap} taskId={o.taskId} workItemId={w.id} size={18} /><span>{w.title}</span></span>
            <span className="qd-subtask-meta">
              {(display.awaitingCompletion || SHOW_LABEL.has(state) || state === "waiting_permission" || state === "waiting_reply") && <span>{display.label}</span>}
              <span>{whoLabel(o, w, (id) => snap.agents.find(agent => agent.id === id)?.name)}</span>
              <span>{display.awaitingCompletion ? display.detail : activityText(o, w).replace("完成于 ", "")}</span>
              {kids.length > 0 && !kidsOpen && <span>{kids.length} 项下级</span>}
            </span>

          </button>
          <button type="button" className="qd-icon-btn" title="子任务方向" aria-label={`查看 ${w.title} 的方向`} onClick={() => void openTaskDirection(o.taskId, w.id)}><Icon name="message" size={15}/></button>
          <button type="button" className="qd-icon-btn" title="子任务成果地图" aria-label={`查看 ${w.title} 的成果地图`} onClick={() => openWorkspace(o.taskId, {view:'results', selected:w.id, itemId:w.id, focus:true})}><Icon name="folder" size={15}/></button>
          <TaskScheduleButton taskId={o.taskId} itemId={w.id} compact />
          <DeleteWorkButton projectId={snap.project.id} taskId={o.taskId} workItemId={w.id} title={w.title} />
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

      {sum.overall.reason && !incomplete && !execution.attention.length && sum.overall.status !== "running" && (
        <p className={`qd-orch-reason tone-${sum.overall.status === "review" ? "review" : "wait"}`}>
          <Icon name={sum.overall.status === "review" ? "check-square" : "alert"} size={14} />
          {sum.overall.reason}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="qd-orch-pending" aria-label="需要你处理的子任务">
          {pending.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => selectWork(o.taskId, w.id)} aria-label={`查看 ${w.title}`}>
                <span className="qd-orch-pending-kind">
                  <WorkIcon status={displayOf(w).state} size={13} />
                  {displayOf(w).label} · {w.title}
                </span>
                <span className="qd-orch-pending-q">{displayOf(w).detail}</span>
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
          拆解路径 · {sum.total} 项子任务
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
