import { TaskOutputButton } from "../outputs/OutputDialog";
import { AddSubtask } from "../outputs/OutputAssets";
import { useState } from "react";
import {
  attemptsOf,
  itemTiming,
  itemTokens,
  latestAttempt,
  latestRound,
  pathOf,
  WORK_LABEL,
} from "../../data/orchestration";
import { formatTokens, lastSentence } from "../../data/format";
import type { Orchestration, WorkItem } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { StepTrack, WorkIcon } from "./WorkStatus";
import { DispatchButton } from "../journal/DispatchButton";
import { rootPlanOf } from "../../data/ideaEngine";
import type { Owner } from "../../data/types";

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
  const { snap, api, toast, agentOf, selectWork, locateWorkItem, openAttemptSource, patchWorkspace } = useWorkdeck();
  const plan = rootPlanOf(snap, o.taskId);
  const [full, setFull] = useState(false);
  const agent = agentOf(o.mainAgentId ?? item.suggestedAgentId ?? "claude");
  const path = pathOf(o, item.id);
  const timing = itemTiming(o, item);
  const tokens = itemTokens(o, item.id);
  const round = latestRound(o, item);
  const attempt = latestAttempt(o, item);
  const attempts = attemptsOf(o, item);
  const deps = item.dependsOnTaskIds.map((d) => o.items[d]).filter(Boolean);
  const waiting = item.status === "waiting_reply" || item.status === "waiting_permission";

  const chip = (w: WorkItem) => (
    <button
      key={w.id}
      type="button"
      className="qd-dep-chip"
      onClick={() => (onSelect ? onSelect(w.id) : selectWork(o.taskId, w.id))}
      aria-label={`选择 ${w.title}（${WORK_LABEL[w.status]}）`}
    >
      <WorkIcon status={w.status} size={12} />
      {w.title}
      <small>{WORK_LABEL[w.status]}</small>
    </button>
  );

  const timeText = !timing
    ? "尚未开始"
    : timing.live
      ? `${timing.start} 起 · ${timing.minutes}m`
      : `${timing.start}—${timing.end} · ${timing.minutes}m`;
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
              {owner === "agent" && item.suggestedAgentId && <small>建议 {agentOf(item.suggestedAgentId)?.name}</small>}
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
                {item.completedAt} · {owner === "me" ? "我" : "已标记"}
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
          <TaskOutputButton taskId={o.taskId} itemId={item.id} /><AddSubtask taskId={o.taskId} parentId={item.id} />
          {refineBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="qd-work-detail" role="region" aria-label={`${item.title} 详情`}>
      {path.length > 1 && <p className="qd-detail-crumbs">{path.map((x) => x.title).join(" › ")}</p>}

      {waiting && item.waiting && (
        <div className="qd-detail-ask">
          <p className="qd-detail-ask-q">{item.waiting.question}</p>
          {item.waiting.impact && <p className="qd-detail-ask-impact">{item.waiting.impact}</p>}
          {attempt && (
            <button type="button" className="qd-btn primary small" onClick={() => openAttemptSource(o.taskId, attempt.id)}>
              回源会话
              <Icon name="external" size={13} />
            </button>
          )}
        </div>
      )}
      {item.status === "failed" && (
        <p className="qd-callout tone-error">
          <Icon name="x-circle" size={14} />
          <span>{item.statusReason ?? "执行失败"}</span>
        </p>
      )}

      {notes}
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
              <StepTrack step={attempt.step} color={agent.color} label={item.title} status={item.status} />
            </dd>
          </div>
        ) : null}
        {round && !waiting && (
          <div>
            <dt>最新回复 · {round.at}</dt>
            <dd>
              {round.reply !== lastSentence(round.reply) ? (
                <button type="button" className="qd-detail-reply" aria-expanded={full} onClick={() => setFull((v) => !v)}>
                  “{full ? round.reply : lastSentence(round.reply)}”
                </button>
              ) : (
                `“${round.reply}”`
              )}
            </dd>
          </div>
        )}
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
                    {i + 1}. {KIND[a.kind]} · {a.startedAt}
                    {a.endedAt ? `—${a.endedAt}` : " 起"} · {a.tokens == null ? "—" : formatTokens(a.tokens)} ·{" "}
                    {ATTEMPT_STATUS[a.status]}
                    {a.note && <small>{a.note}</small>}
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        )}
      </dl>

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
            回到原会话
            <Icon name="external" size={13} />
          </button>
        )}
        <TaskOutputButton taskId={o.taskId} itemId={item.id} /><AddSubtask taskId={o.taskId} parentId={item.id} />
        {refineBtn}
      </div>
    </div>
  );
}
