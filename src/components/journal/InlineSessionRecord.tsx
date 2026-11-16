import { useState } from "react";
import type { CSSProperties } from "react";
import { sessionView, subAgentTree, waitingHeadline, waitingQuestion } from "../../data/derive";
import { clockTime, formatDuration, formatTokens, lastSentence, span } from "../../data/format";
import type { Session, SubAgentRecord } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { StatusPill } from "../ui/StatusPill";
import { AgentLogo } from "../ui/AgentLogo";
import { RunProgress } from "./RunProgress";
import { SessionLog } from './SessionLog';
import { usePreferences } from '../../state/preferences';

export function stepText(session: Session) {
  const s = session.step;
  if (!s) return null;
  // completed 表示源端回报的“已完成步数”
  if (s.total) return `已完成 ${s.completed ?? 0}/${s.total} 步 · ${s.label}`;
  return `阶段 · ${s.label}`;
}

export function sourceText(session: Session, agentName: string, timeZone?:string) {
  if (session.origin === "observed") {
    const client = session.client ?? `${agentName} 客户端`;
    if (!session.mergedAt) return `${client} · 自动记入`;
    return session.linkedAsHistory
      ? `${client} · ${clockTime(session.mergedAt,timeZone)} 关联为历史`
      : `${client} · ${clockTime(session.mergedAt,timeZone)} 合并`;
  }
  return "";
}

/**
 * 原任务下的执行记录，三层结构：
 * 运行层（Agent · 步骤 · token · 打开会话）→ 回复层（最新回复时间 + 末句，可展开，历史轮次入口）
 * → 次级来源行与子代理树。来源信息不会挤掉步骤、token 和最新回复。
 */
export function InlineSessionRecord({
  session,
  showStatus,
  taskDone,
  hideSource = false,
}: {
  session: Session;
  showStatus: boolean;
  taskDone: boolean;
  hideSource?: boolean;
}) {
  const { agentOf, api, toast, openSourceSession, snap } = useWorkdeck();
  const {preferences}=usePreferences();
  const timeZone=snap.project.timeZone;
  const [replyOpen, setReplyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(!taskDone);
  const [busy, setBusy] = useState(false);
  const agent = agentOf(session.agentId);
  const view = sessionView(session);
  const latest = session.rounds[session.rounds.length - 1];
  const history = session.rounds.slice(0, -1);
  const step = stepText(session);
  const ended = session.status === "archived" && session.startedAt && session.endedAt;
  const waiting = view === "waiting_reply" || view === "waiting_permission";
  const hasSource = view !== "submitting" && view !== "rejected" && view !== "unknown";
  const question = waiting ? waitingQuestion(session) : null;
  const tree = subAgentTree(session.subAgents);
  const doneSubs = session.subAgents.filter((s) => s.status === "done").length;

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.message) toast(r.message, r.ok ? "info" : "error");
  };

  const renderSub = (sa: SubAgentRecord) => {
    const children = tree.childrenOf(sa.id);
    return (
      <li key={sa.id} className={`qd-sub status-${sa.status}`}>
        <div className="qd-sub-row">
          <span className="qd-sub-check" aria-hidden="true">
            {sa.status === "done" && <Icon name="check" size={11} />}
          </span>
          <span className="qd-sub-main">
            <span className="qd-sub-title">{sa.title}</span>
            <span className="qd-sub-meta">
              <span>{{ queued: "排队中", running: "运行中", paused: "已暂停", cancelled: "已取消", done: "完成", failed: "失败" }[sa.status]}</span>
              <span>
                {clockTime(sa.start,timeZone)}
                {sa.end ? `—${clockTime(sa.end,timeZone)} · ${formatDuration(span(sa.start, sa.end))}` : " 起"}
              </span>
              <span>{formatTokens(sa.tokens)}</span>
            </span>
          </span>
          <button type="button" className="qd-link" onClick={() => openSourceSession(sa.sessionRef)}>
            子会话
            <Icon name="external" size={12} />
          </button>
        </div>
        {sa.source&&<SessionLog session={session} source={sa.source} density={preferences.logDensity} timeZone={timeZone}/>}
        {children.length > 0 && <ul className="qd-sub-list is-nested">{children.map(renderSub)}</ul>}
      </li>
    );
  };

  return (
    <div
      className={`qd-record view-${view}`}
      data-record={session.id}
      style={{ "--agent": agent.color } as CSSProperties}
    >
      {/* 运行层 */}
      <div className="qd-run">
        <span className="qd-run-seg qd-run-agent">
          <AgentLogo agent={agent} size={18} />
          {agent.name}
        </span>
        {showStatus && <StatusPill view={view} />}
        {ended ? (
          <span className="qd-run-seg">
            {clockTime(session.startedAt,timeZone)}—{clockTime(session.endedAt,timeZone)} ·{" "}
            {formatDuration(span(session.startedAt!, session.endedAt!))}
          </span>
        ) : (
          step && <span className="qd-run-seg is-strong">{step}</span>
        )}
        {hasSource && <span className="qd-run-seg">{formatTokens(session.tokens)}</span>}
        {hasSource && (
          <button
            type="button"
            className="qd-link qd-run-seg"
            onClick={() => openSourceSession(session.id)}
          >
            打开会话
            <Icon name="external" size={12} />
          </button>
        )}
      </div>

      <RunProgress session={session} />

      {view === "submitting" && (
        <p className="qd-record-note">
          提交中
          <button
            type="button"
            className="qd-link"
            disabled={busy}
            onClick={() => run(() => api.cancelDispatch(session.id))}
          >
            撤回
          </button>
        </p>
      )}
      {view === "acknowledged" && (
        <p className="qd-record-note">
          已受理，等待开始
        </p>
      )}

      {waiting && (
        <div className="qd-wait-inline">
          <div className="qd-wait-inline-head">
            <Icon name={view === "waiting_permission" ? "lock" : "reply"} size={14} />
            <strong>{waitingHeadline(session)}</strong>
            <button
              type="button"
              className="qd-link"
              onClick={() => openSourceSession(session.id)}
            >
              {view === "waiting_permission" ? "去授权" : "去回复"}
              <Icon name="external" size={12} />
            </button>
          </div>
          {question && question !== latest?.reply && <p className="qd-wait-question">{question}</p>}
        </div>
      )}

      {(view === "rejected" || view === "unknown" || view === "failed") && (
        <div
          className={`qd-callout ${view === "unknown" ? "tone-waiting" : "tone-error"}`}
          role="status"
        >
          <Icon name={view === "unknown" ? "help-circle" : "x-circle"} size={15} />
          <span>{session.failure}</span>
          {view === "rejected" && (
            <button
              type="button"
              className="qd-callout-action"
              disabled={busy}
              onClick={() => run(() => api.retryDispatch(session.id))}
            >
              <Icon name="refresh" size={14} />
              重试委派
            </button>
          )}
          {view === "unknown" && (
            <button
              type="button"
              className="qd-callout-action"
              disabled={busy}
              onClick={() => run(() => api.reconcile(session.id))}
            >
              <Icon name="refresh" size={14} />
              {busy ? "对账中…" : "对账"}
            </button>
          )}
          {view === "failed" && (
            <button
              type="button"
              className="qd-callout-action"
              onClick={() => openSourceSession(session.id)}
            >
              查看源会话
              <Icon name="external" size={13} />
            </button>
          )}
        </div>
      )}

      {/* 回复层 */}
      {latest ? (
        <div className="qd-reply-row">
          <button
            type="button"
            className={`qd-reply ${replyOpen ? "is-open" : ""}`}
            aria-expanded={replyOpen}
            onClick={() => setReplyOpen((v) => !v)}
            title={replyOpen ? "收起完整回复" : "展开完整回复"}
          >
            <span className="qd-reply-label">
              {clockTime(latest.at,timeZone)}
              {lastSentence(latest.reply) !== latest.reply && !waiting && (
                <span className="qd-reply-toggle">{replyOpen ? "收起" : "全文"}</span>
              )}
            </span>
            <span className="qd-reply-text">
              “{replyOpen || waiting ? latest.reply : lastSentence(latest.reply)}”
            </span>
          </button>
          {history.length > 0 && (
            <div className="qd-history">
              <button
                type="button"
                className="qd-fold"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((v) => !v)}
              >
                <Icon name="chevron-right" size={13} className="qd-fold-icon" />
                历史轮次 {history.length}
              </button>
              <div className={`qd-collapse ${historyOpen ? "is-open" : ""}`}>
                <ol className="qd-collapse-inner qd-round-list">
                  {history.map((r, i) => (
                    <li key={r.id}>
                      <span className="qd-round-at">
                        第 {i + 1} 轮 · {clockTime(r.at,timeZone)}
                      </span>
                      <p>{r.reply}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {session.subAgents.length > 0 && (
        <div className="qd-subtree">
          <button
            type="button"
            className="qd-fold"
            aria-expanded={treeOpen}
            onClick={() => setTreeOpen((v) => !v)}
          >
            <Icon name="chevron-right" size={13} className="qd-fold-icon" />
            子代理 {session.subAgents.length}
            <span className="qd-meta-soft">
              {doneSubs} 完成
              {doneSubs < session.subAgents.length &&
                ` · ${session.subAgents.length - doneSubs} 进行中`}
            </span>
          </button>
          <div className={`qd-collapse ${treeOpen ? "is-open" : ""}`}>
            <div className="qd-collapse-inner">
              <ul className="qd-sub-list">{tree.roots.map(renderSub)}</ul>
            </div>
          </div>
        </div>
      )}

      <SessionLog session={session} density={preferences.logDensity} timeZone={timeZone}/>
      {/* 次级来源行 */}
      {!hideSource && session.origin === "observed" && (
        <p className="qd-source">
          <Icon name="link" size={12} />
          {sourceText(session, agent.name,timeZone)}
        </p>
      )}
    </div>
  );
}
