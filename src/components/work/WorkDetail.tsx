import { useState } from 'react';
import { canRetryDispatch, rejectedAdmissionStopped } from '../../data/dispatchRecovery';
import { TaskProgressTrail } from '../journal/TaskProgressTrail';
import { workItemPresentation } from '../../data/workItemPresentation';
import { ProgressIndicator } from '../journal/RunProgress';
import '../journal/discussion-snippets.css';
import { discussionQuestion } from '../../data/discussionSnippets';
import { TaskAttachmentsPanel } from "../workspace/TaskAttachments";
import { TaskIcon } from "../ui/TaskIcon";
import { TaskOutputButton } from "../outputs/OutputDialog";
import { AddSubtask } from "../outputs/OutputAssets";
import {
  attemptsOf,
  itemTiming,
  itemTokens,
  latestAttempt,
  pathOf,
} from "../../data/orchestration";
import { formatTokens, clockTime } from "../../data/format";
import type { Orchestration, WorkItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { StepTrack, WorkIcon } from "./WorkStatus";
import { DispatchButton } from "../journal/DispatchButton";
import { deliveryPresentation } from "../../data/deliveryPresentation";
import { rootPlanOf } from "../../data/ideaEngine";
import type { Owner } from "../../data/types";
import { SessionLog } from '../journal/SessionLog';
import { usePreferences } from '../../state/preferences';

const OWNERS: { key: Owner; label: string }[] = [
  { key: "me", label: "我" },
  { key: "agent", label: "Agent" },
  { key: "unassigned", label: "未安排" },
];

const KIND: Record<string, string> = { initial: "首次", retry: "重试", resume: "恢复", reassign: "更换执行者" };
const ATTEMPT_STATUS: Record<string, string> = {
  queued:"排队中",
  paused:"已暂停",
  running: "执行中",
  waiting_reply: "等你回复",
  waiting_permission: "等待权限",
  done: "完成",
  failed: "失败",
  interrupted: "中断",
  cancelled: "已取消",
};

/** 选中子任务的栏内详情：显示状态原因、时间、token、步骤与执行历史 */
export function WorkDetail({
  o,
  item,
  inWorkspace = false,
  onSelect,
}: {
  o: Orchestration;
  item: WorkItem;
  inWorkspace?: boolean;
  onSelect?: (id: string) => void;
}) {
  const { snap, api, toast, agentOf, selectWork, locateWorkItem, openAttemptSource, patchWorkspace, openWorkspace } = useWorkdeck();
  const {preferences}=usePreferences();
  const [retrying, setRetrying] = useState(false);
  const plan = rootPlanOf(snap, o.taskId);
  const display = workItemPresentation(snap, o, item);
  const agent = agentOf(display.entry?.agentId ?? o.mainAgentId ?? item.suggestedAgentId ?? "");
  const suggestedAgent = snap.agents.find(value => value.id === item.suggestedAgentId);
  const path = pathOf(o, item.id);
  const timing = itemTiming(o, item);
  const tokens = itemTokens(o, item.id);
  const attempt = latestAttempt(o, item);
  const attempts = attemptsOf(o, item);
  const sourceSession=(display.entry?.sessionId ? snap.sessions[display.entry.sessionId] : undefined) ?? (attempt&&(snap.sessions[attempt.sessionId]??snap.sessions[attempt.parentSessionId??'']??Object.values(snap.sessions).find(s=>attempt.source&&s.source?.connectionId===attempt.source.connectionId&&s.source.sessionId===attempt.source.sessionId)));
  const retryable = canRetryDispatch(sourceSession);
  const retry = async () => {
    if (!sourceSession || retrying) return;
    setRetrying(true);
    try { const result = await api.retryDispatch(sourceSession.id); toast(result.message ?? (result.ok ? '已重新派发' : '未能重新派发'), result.ok ? 'info' : 'error'); }
    catch (error) { toast(error instanceof Error ? error.message : '重试失败', 'error'); }
    finally { setRetrying(false); }
  };
  const deps = item.dependsOnTaskIds.map((d) => o.items[d]).filter(Boolean);
  const waiting = display.state === "waiting_reply" || display.state === "waiting_permission";

  const deliveries = deliveryPresentation(snap, { taskId: o.taskId, workItemId: item.id });
  const resultEntry = <button type="button" className="qd-btn ghost small" onClick={() => openWorkspace(o.taskId, { view: "results", selected: item.id, itemId: item.id, focus: true })}>
    <Icon name="box" size={14} />任务成果汇总{deliveries.total ? ` · ${deliveries.accepted}/${deliveries.total} 已认可` : deliveries.history.length ? ` · ${deliveries.history.length} 份交付` : ""}<Icon name="arrow-right" size={13} />
  </button>;

  const chip = (original: WorkItem) => {
    const presentation = workItemPresentation(snap, o, original);
    const w = { ...original, status: presentation.state };
    return (
    <button
      key={w.id}
      type="button"
      className="qd-dep-chip"
      onClick={() => (onSelect ? onSelect(w.id) : selectWork(o.taskId, w.id))}
      aria-label={`选择 ${w.title}（${presentation.label}）`}
    >
      <WorkIcon status={w.status} size={12} />
      <TaskIcon snapshot={snap} taskId={o.taskId} workItemId={w.id} size={16} />
      {w.title}
      <small>{presentation.label}</small>
    </button>
  );
  };

  const timeText = !timing
    ? "尚未开始"
    : timing.live
      ? `${clockTime(timing.start, snap.project.timeZone)} 起 · ${Math.round(timing.minutes)}m`
      : `${clockTime(timing.start, snap.project.timeZone)}—${clockTime(timing.end, snap.project.timeZone)} · ${Math.round(timing.minutes)}m`;
  const tokenText =
    tokens.records === 0
      ? "—"
      : !o.capabilities.tokens
        ? "token 尚未接入"
        : `${formatTokens(tokens.total)}${tokens.total !== tokens.own ? `（含下级 ${formatTokens(tokens.total - tokens.own).replace(" token", "")}）` : ""}${tokens.unknown ? " · 部分未同步" : ""}`;

  const refine = async () => {
    await api.openLocalPlan(o.taskId, item.id);
    patchWorkspace({ view: "plan", itemId: item.id, scope: "root", mode: "doc", pane: "main" });
  };
  const outdated = item.source && plan?.adopted && item.source.planId === plan.id && item.source.version < plan.adopted.version;
  const refineBtn = plan && inWorkspace && item.status !== "cancelled" && (
    <button type="button" className="qd-btn ghost small" onClick={refine}>
      <Icon name="message" size={13} />
      查看方案与讨论结论
    </button>
  );
  const notes = (
    <>
      <TaskAttachmentsPanel key={`${snap.project.id}:${o.taskId}:${item.id}`} taskId={o.taskId} workItemId={item.id} />
      {item.status === "cancelled" && item.statusReason && (
        <p className="qd-callout tone-muted">
          <Icon name="close" size={14} />
          <span>{item.statusReason}</span>
        </p>
      )}
      {item.reviewNote && (
        <p className="qd-callout tone-waiting">
          <Icon name="alert" size={14} />
          <span>{item.reviewNote}</span>
        </p>
      )}
    </>
  );
  const sourceRow = item.source && (
    <div>
      <dt>来源</dt>
      <dd>
        {item.source.planId === plan?.id ? "方案" : "局部方案"} v{item.source.version}
        {outdated ? `（方案已到 v${plan!.adopted!.version}）` : ""}
      </dd>
    </div>
  );

  // 没有执行记录：人工 / 未安排 / Agent 待委派 —— 不显示 token、会话与步骤占位
  if (attempts.length === 0) {
    const owner = item.owner ?? "unassigned";
    return (
      <div className="qd-work-detail" role="region" aria-label={`${item.title} 详情`}>
        {path.length > 1 && <p className="qd-detail-crumbs">{path.map((x) => x.title).join(" › ")}</p>}
        <TaskProgressTrail snapshot={snap} scope={{ taskId: o.taskId, workItemId: item.id }} />
        {notes}
        <dl className="qd-detail-dl">
          <div>
            <dt>负责人</dt>
            <dd className="qd-owner-row">
              <span className="qd-seg qd-owner-seg" role="radiogroup" aria-label={`负责人：${item.title}`}>
                {OWNERS.map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    role="radio"
                    aria-checked={owner === x.key}
                    className={owner === x.key ? "is-on" : ""}
                    disabled={item.status === "done" || item.status === "cancelled"}
                    onClick={() => api.setWorkOwner(o.taskId, item.id, x.key)}
                  >
                    {x.label}
                  </button>
                ))}
              </span>
              {owner === "agent" && suggestedAgent && <small>建议 {suggestedAgent.name}</small>}
            </dd>
          </div>
          {item.expected && (
            <div>
              <dt>预期结果</dt>
              <dd>{item.expected}</dd>
            </div>
          )}
          {sourceRow}
          {item.status === "done" && item.completedAt && (
            <div>
              <dt>完成</dt>
              <dd>
                {clockTime(item.completedAt, snap.project.timeZone)} · {owner === "me" ? "我" : "已标记"}
              </dd>
            </div>
          )}
          {deps.length > 0 && (
            <div>
              <dt>等待</dt>
              <dd className="qd-dep-list">{deps.map(chip)}</dd>
            </div>
          )}
        </dl>
        <div className="qd-detail-actions">
          {owner === "me" && item.status === "not_started" && (
            <button type="button" className="qd-btn ghost small" onClick={() => api.setWorkStatus(o.taskId, item.id, "running")}>
              开始
            </button>
          )}
          {owner === "me" && (item.status === "not_started" || item.status === "running" || item.status === "blocked") && (
            <button
              type="button"
              className="qd-btn primary small"
              onClick={() => api.setWorkStatus(o.taskId, item.id, "done")}
            >
              <Icon name="check" size={13} />
              标记完成
            </button>
          )}
          {item.status === "done" && (
            <button type="button" className="qd-btn ghost small" onClick={() => api.setWorkStatus(o.taskId, item.id, "not_started")}>
              重新打开
            </button>
          )}
          {owner === "agent" && item.status === "not_started" && (
            <span className="qd-detail-dispatch">
              委派
              <DispatchButton
                label={item.title}
                onDispatch={async (agentId) => {
                  const r = await api.dispatchWork(o.taskId, item.id, agentId);
                  toast(r.message ?? "", r.ok ? "info" : "error");
                }}
              />
            </span>
          )}
          {owner === "agent" && item.status === "blocked" && <span className="qd-detail-note">前置完成后可委派</span>}
          {owner === "unassigned" && item.status !== "cancelled" && <span className="qd-detail-note">选择负责人后再推进</span>}
          {resultEntry}
          <TaskOutputButton taskId={o.taskId} itemId={item.id} /><AddSubtask taskId={o.taskId} parentId={item.id} />
          {refineBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="qd-work-detail" role="region" aria-label={`${item.title} 详情`}>
      {path.length > 1 && <p className="qd-detail-crumbs">{path.map((x) => x.title).join(" › ")}</p>}

      {display.progress && <ProgressIndicator progress={display.progress} agentName={agent.name} color={agent.color} compact />}
      {waiting && (
        <div className="qd-detail-ask">
          <p className="qd-detail-ask-q">{discussionQuestion(display.detail || (display.state === "waiting_permission" ? "执行需要你的授权" : "执行需要你的回复"))}</p>
          {item.waiting?.impact && <p className="qd-detail-ask-impact">{item.waiting.impact}</p>}
          {attempt && (
            <button type="button" className="qd-btn primary small" onClick={() => openAttemptSource(o.taskId, attempt.id)}>
              {display.state === "waiting_permission" ? "查看授权" : display.awaitingCompletion ? "补充并继续" : "回复"}
              <Icon name="external" size={13} />
            </button>
          )}
        </div>
      )}
      {display.awaitingCompletion && !waiting && <div className="qd-detail-ask" role="status">
        <p className="qd-detail-ask-q">{display.detail}</p>
        {attempt && <button type="button" className="qd-btn primary small" onClick={() => openAttemptSource(o.taskId, attempt.id)}>补充并继续<Icon name="external" size={13} /></button>}
      </div>}
      {display.state === "failed" && (
        <p className="qd-callout tone-error">
          <Icon name="x-circle" size={14} />
          <span>{display.detail ?? "执行失败"}</span>
        </p>
      )}

      {sourceSession?.dispatchPhase === 'rejected' && <div className="qd-detail-ask" role="status">
        <p>Agent 尚未受理这次派发，没有创建源会话。原记录和任务要求已保留。</p>
        {retryable ? <button type="button" className="qd-btn primary small" disabled={retrying} onClick={() => void retry()}>{retrying ? '正在重新派发…' : '重新派发此任务'}</button> : <button type="button" className="qd-btn ghost small" onClick={() => void api.reconcile(sourceSession.id).then(result => toast(result.message ?? '已核对派发记录', result.ok ? 'info' : 'error')).catch(error => toast(String(error), 'error'))}>核对派发记录</button>}
      </div>}
      {retryable && !rejectedAdmissionStopped(sourceSession) && <button type="button" className="qd-btn primary small" disabled={retrying} onClick={() => void retry()}>{retrying ? '正在重新派发…' : '重试已停止的任务'}</button>}
      <TaskProgressTrail snapshot={snap} scope={{ taskId: o.taskId, workItemId: item.id }} />
      {notes}
      <div className="qd-detail-actions">{resultEntry}</div>
      <details className="qd-work-disclosure">
        <summary>执行记录与用量</summary>
        <dl className="qd-detail-dl">
          {sourceRow}
          <div>
            <dt>时间 · token</dt>
            <dd>
              {timeText} · {tokenText}
            </dd>
          </div>
          {attempt?.step?.total ? (
            <div>
              <dt>步骤</dt>
              <dd>
                {attempt.step.completed ?? 0}/{attempt.step.total} · {attempt.step.label}
                <StepTrack step={attempt.step} color={agent.color} label={item.title} status={display.state} />
              </dd>
            </div>
          ) : null}
          {deps.length > 0 && (
            <div>
              <dt>等待</dt>
              <dd className="qd-dep-list">{deps.map(chip)}</dd>
            </div>
          )}
          {attempts.length > 1 && (
            <div>
              <dt>执行 {attempts.length} 次</dt>
              <dd>
                <ol className="qd-attempts">
                  {attempts.map((a, i) => (
                    <li key={a.id}>
                      {i + 1}. {KIND[a.kind]} · {clockTime(a.startedAt, snap.project.timeZone)}
                      {a.endedAt ? `—${clockTime(a.endedAt, snap.project.timeZone)}` : " 起"} · {a.tokens == null ? "—" : formatTokens(a.tokens)} ·{" "}
                      {ATTEMPT_STATUS[a.status]}
                      {a.note && <small>{a.note}</small>}
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          )}
        </dl>

        {sourceSession&&<SessionLog session={sourceSession} source={attempt?.source??sourceSession.source} density={preferences.logDensity} timeZone={snap.project.timeZone}/>}
      </details>

      <div className="qd-detail-actions">
        {!inWorkspace && (
          <button type="button" className="qd-btn ghost small" onClick={() => locateWorkItem(o.taskId, item.id)}>
            定位到日记
          </button>
        )}
        {attempt && !waiting && (
          <button
            type="button"
            className="qd-btn ghost small"
            title={attempt.sourceLink}
            onClick={() => openAttemptSource(o.taskId, attempt.id)}
          >
            {sourceSession?.dispatchPhase === 'rejected' ? '查看派发问题' : '回到原会话'}
            <Icon name="external" size={13} />
          </button>
        )}
        <TaskOutputButton taskId={o.taskId} itemId={item.id} /><AddSubtask taskId={o.taskId} parentId={item.id} />
        {refineBtn}
      </div>
    </div>
  );
}
