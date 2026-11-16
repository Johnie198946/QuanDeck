import type { CSSProperties } from "react";
import { waitingHeadline, waitingQuestion } from "../../data/derive";
import { formatTokens, clockTime } from "../../data/format";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { StatusPill } from "../ui/StatusPill";
import { AgentLogo } from "../ui/AgentLogo";
import { RunProgress } from "../journal/RunProgress";
import { orchOf, summarize } from "../../data/orchestration";
import { WorkPill } from "../work/WorkStatus";
import { stepText } from "../journal/InlineSessionRecord";
import type { ExecutionItem } from "./useExecutions";

/**
 * 执行栏条目。等待项问题优先：任务名 → 类型 · 摘要 → 完整原始问题 → 回源会话；
 * 影响与可选项收在详情里，没有源端依据不写断言。其他条目保持一行半的安静摘要。
 */
export function ExecutionRow({ item }: { item: ExecutionItem; emphasis?: boolean }) {
  const { snap, agentOf, locateTask, openSourceSession, api, toast, selectWork } = useWorkdeck();
  const { session, view } = item;
  const agent = agentOf(session.agentId);
  const style = { "--agent": agent.color } as CSSProperties;
  const locate = () =>
    item.taskId ? locateTask(item.taskId) : toast("外部会话，已在日记中");

  // 主任务编排：显示子任务数量与整体状态（不是工作量百分比），点击进入该任务范围
  const o = orchOf(snap, item.taskId);
  if (o && session.id === o.mainSessionId) {
    const sum = summarize(snap, o);
    return (
      <article className="qd-exec view-running is-orch" style={style}>
        <button
          type="button"
          className="qd-exec-main"
          onClick={() => selectWork(o.taskId, null)}
          aria-label={`进入主任务范围：${item.title}`}
        >
          <span className="qd-exec-title">{item.title}</span>
          <span className="qd-exec-meta">
            <span className="qd-exec-seg">
              <AgentLogo agent={agent} size={16} />
              {agent.name}
            </span>
            <span className="qd-exec-seg">
              {sum.done}/{sum.total} 完成 · {sum.running} 运行
            </span>
          </span>
          {sum.overall.status !== "running" && (
            <span className="qd-exec-foot">
              <WorkPill status={sum.overall.status} label={sum.overall.label} />
            </span>
          )}
        </button>
        <Icon name="chevron-right" size={16} className="qd-exec-go" />
      </article>
    );
  }

  if (view === "waiting_reply" || view === "waiting_permission") {
    const question = waitingQuestion(session);
    return (
      <article className={`qd-wait-card view-${view}`} style={style}>
        <button
          type="button"
          className="qd-wait-card-title"
          onClick={locate}
          aria-label={`在日记中定位：${item.title}`}
        >
          {item.title}
        </button>
        <p className="qd-wait-card-kind">
          <Icon name={view === "waiting_permission" ? "lock" : "reply"} size={14} />
          <strong>{waitingHeadline(session)}</strong>
        </p>
        {question && <p className="qd-wait-card-question">{question}</p>}
        <div className="qd-wait-card-actions">
          <button
            type="button"
            className="qd-link"
            onClick={() => openSourceSession(session.id)}
          >
            {view === "waiting_permission" ? "去授权" : "去回复"}
            <Icon name="external" size={14} />
          </button>
          <span className="qd-wait-card-agent">
            <AgentLogo agent={agent} size={16} />
            {agent.name}
          </span>
        </div>
      </article>
    );
  }

  const isProblem = view === "rejected" || view === "failed" || view === "unknown";
  // 运行摘要分两层：Agent · 步数 / 当前阶段，窄栏不会逐字断开或把分隔符挤到行首
  const segments: string[] =
    isProblem || !session.step || view === "submitting" || view === "acknowledged"
      ? []
      : session.step.total
        ? [`已完成 ${session.step.completed ?? 0}/${session.step.total} 步`]
        : ["阶段"];
  const stage = isProblem
    ? null
    : view === "submitting"
      ? "提交中，等待源端受理"
      : view === "acknowledged"
        ? "源端已受理，等待开始"
        : (session.step?.label ?? stepText(session) ?? "阶段未提供");

  return (
    <article className={`qd-exec view-${view}`} style={style}>
      <button
        type="button"
        className="qd-exec-main"
        onClick={locate}
        aria-label={`在日记中定位：${item.title}`}
      >
        <span className="qd-exec-title">{item.title}</span>
        <span className="qd-exec-meta">
          <span className="qd-exec-seg">
            <AgentLogo agent={agent} size={16} />
            {agent.name}
          </span>
          {segments.map((s) => (
            <span key={s} className="qd-exec-seg">
              {s}
            </span>
          ))}
        </span>
        {stage && <span className="qd-exec-stage">{stage}</span>}
        <RunProgress session={session} compact />
        {isProblem && <span className="qd-exec-reason">{session.failure}</span>}
        <span className="qd-exec-foot">
          {view !== "running" && <StatusPill view={view} />}
          <span>{clockTime(session.lastActivity, snap.project.timeZone)}</span>
          {session.tokens != null && <span>{formatTokens(session.tokens)}</span>}
        </span>
      </button>
      {view === "unknown" && (
        <button
          type="button"
          className="qd-btn ghost small"
          onClick={async () => {
            const r = await api.reconcile(session.id);
            toast(r.message ?? "", r.ok ? "info" : "error");
          }}
        >
          对账
        </button>
      )}
      {view === "rejected" && (
        <button
          type="button"
          className="qd-btn ghost small"
          onClick={() => api.retryDispatch(session.id)}
        >
          重试
        </button>
      )}
      {view === "submitting" && (
        <button
          type="button"
          className="qd-btn ghost small"
          onClick={async () => {
            const r = await api.cancelDispatch(session.id);
            toast(r.message ?? "", r.ok ? "info" : "error");
          }}
        >
          撤回
        </button>
      )}
      {view === "failed" && (
        <button
          type="button"
          className="qd-btn ghost small"
          onClick={() => openSourceSession(session.id)}
        >
          查看会话
          <Icon name="external" size={14} />
        </button>
      )}
    </article>
  );
}
