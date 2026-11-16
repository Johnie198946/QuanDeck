import { useEffect, useState, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { MarkdownMessage } from "../runtime/RichMessage";
import { clockTime } from "../../data/format";
import { latestConclusion, safeDiscussionUrl } from "../../data/discussion";
import { rootPlanOf } from "../../data/ideaEngine";
import type { IdeaPlan } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { useConfiguredAgents } from "../../integration/configuredAgents";
import { AgentConnectionSetup } from "../deck/AgentConnectionSetup";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { DiscussionCanvas } from '../discussion/DiscussionCanvas';
import type { DiscussionFeedbackInput } from '../../data/discussionVisual';
import type { CanvasFeedback, FeedbackReceipt } from '../discussion/BlockFeedback';
import { desktopHost } from '../../integration/desktop';
import { gateway } from '../../integration/gateway';
import { DiscussionHandoff, RecordDiscussionConclusion } from "./DiscussionDialogs";

/** 对话留在源 Agent；这里仅呈现结论、来源与显式采用操作。 */
export function DiscussionSummary({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, workspace, patchWorkspace, openSourceSession } = useWorkdeck();
  const [dialog, setDialog] = useState<"handoff" | "record" | null>(null);
  const { agents } = useConfiguredAgents(snap.agents);
  const [connecting, setConnecting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedConclusionId, setSelectedConclusionId] = useState<string | null>(null);
  const scope = workspace?.scope ?? "root";
  const root = rootPlanOf(snap, plan.taskId);
  const section = plan.draft.sections.find((s) => s.id === scope);
  const crumbs = [
    root?.title ?? plan.title,
    plan.itemId ? plan.title : null,
    section?.title,
  ].filter(Boolean);
  const agent =
    agents.find(a => a.id === plan.discussion?.agentId) ?? agents.find(a => a.id === snap.defaultAgent) ?? agents[0];
  const history = (plan.discussion?.conclusions ?? []).filter((c) => c.scopeId === scope);
  useEffect(() => {
    const select = (event: Event) => {
      const detail = (event as CustomEvent<{planId: string; conclusionId: string}>).detail;
      if (detail?.planId === plan.id && plan.discussion?.conclusions.some(c => c.id === detail.conclusionId)) setSelectedConclusionId(detail.conclusionId);
    };
    window.addEventListener("quandeck:select-conclusion", select);
    return () => window.removeEventListener("quandeck:select-conclusion", select);
  }, [plan.id, plan.discussion?.conclusions]);
  const latest = latestConclusion(plan, scope);
  const result = history.find((c) => c.id === selectedConclusionId) ?? latest;
  const sourceAgent = result && snap.agents.find((a) => a.id === result.agentId);
  const sourceUrl = result?.sourceUrl ? safeDiscussionUrl(result.sourceUrl) : null;
  const sourceSession = result?.sourceRef
    ? Object.values(snap.sessions).find(session => session.source?.connectionId === result.sourceRef!.connectionId && session.source.sessionId === result.sourceRef!.sessionId)
    : plan.discussion?.sessionId ? snap.sessions[plan.discussion.sessionId] : undefined;
  const isPreviousAgent = !!agent && !!result && result.agentId !== agent.id;
  const openDialog = async (kind: "handoff" | "record") => {
    if (!agent || selecting) return;
    setSelecting(true);
    try {
      const selected = await api.setDiscussionAgent(plan.id, agent.id);
      if (!selected.ok) throw new Error(selected.message ?? "讨论目标未保存");
      setDialog(kind);
    } catch (error) { toast(error instanceof Error ? error.message : "无法选择 Agent，请重试。", "error"); }
    finally { setSelecting(false); }
  };


  const visualContext: CanvasFeedback | undefined = result ? {
    binding: { projectId: snap.project.id, taskId: plan.taskId, planId: plan.id, conclusionId: result.id, sourceMessageId: result.sourceMessageId, draftVersion: plan.draftVersion },
    feedback: snap.collaboration?.discussionFeedback?.filter(item => item.binding.conclusionId === result.id),
    disabled: result.id !== latest?.id,
    onOpenSource: sourceSession?.source ? async () => {
      try { const receipt = await gateway.openSource({ ...sourceSession.source!, mode: api.mode === 'sample' ? 'sample' : 'live', sessionId: sourceSession.source!.sessionId, destination: 'native' }); toast(receipt.message, receipt.status === 'unavailable' ? 'error' : 'info'); }
      catch (cause) { toast(cause instanceof Error ? cause.message : '暂时无法打开源会话', 'error'); }
    } : undefined,
    unavailableReason: result.id !== latest?.id ? '这是历史方案，请对最新方案反馈。' : undefined,
    onFeedback: async (input: DiscussionFeedbackInput): Promise<FeedbackReceipt> => {
      const host = desktopHost();
      if (host && sourceSession?.runtime?.runId) return host.controlRun(sourceSession.runtime.runId, 'discussion_feedback', input);
      return api.recordDiscussionFeedback(input);
    },
  } : undefined;
  return (
    <section className="qd-conclusions" aria-label="讨论结论" data-discussion-conclusion={result?.id}>
      <header className="qd-conclusions-head">
        <div className="qd-conclusions-title">
          <h2>讨论结论</h2>
          <Icon name="inbox" size={18} />
        </div>
        <p className="qd-conclusions-scope">{crumbs.join(" › ")}</p>
        {scope !== "root" && (
          <button
            type="button"
            className="qd-link"
            onClick={() => patchWorkspace({ scope: "root" })}
          >
            查看整体结论
          </button>
        )}
        {agent && (
          <div className="qd-discussion-agent">
            <AgentLogo agent={agent} size={28} />
            <label>
              <span>讨论 Agent</span>
              <select
                aria-label="选择讨论 Agent"
                value={agent.id}
                onChange={async (e) => {
                  const r = await api.setDiscussionAgent(plan.id, e.target.value);
                  toast(r.message ?? "", r.ok ? "info" : "error");
                }}
              >
                {agents.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!agent && <button type="button" className="qd-btn ghost small" onClick={() => setConnecting(true)}>配置讨论 Agent</button>}
        <p className="qd-conclusions-boundary">只确定方向与执行逻辑；任务负责产出具体结果。</p>
        {plan.discussion?.syncStatus === 'pending' && <p className="qd-conclusions-note" role="status">等待 Agent 返回本轮结论</p>}
        {plan.discussion?.syncStatus === 'failed' && <p className="qd-conclusions-note" role="status">本次讨论未同步，请查看源会话</p>}
      </header>

      <div className="qd-conclusions-content">
        {history.length > 1 && (
          <label className="qd-conclusion-history">
            结论记录 · {history.length}
            <select
              aria-label="查看结论记录"
              value={result?.id ?? ""}
              onChange={(e) =>
                setSelectedConclusionId(e.target.value === latest?.id ? null : e.target.value)
              }
            >
              {[...history].reverse().map((c, i) => (
                <option key={c.id} value={c.id}>
                  {i === 0 ? "最新" : "历史"} · {clockTime(c.recordedAt, snap.project.timeZone)} · {c.summary.slice(0, 24)}
                </option>
              ))}
            </select>
          </label>
        )}
        {result ? (
          <>
            <div className="qd-conclusions-provenance">
              <span className="qd-tag">{result.source === "sample" ? "示例结论" : result.source === 'agent' ? 'Agent 回传' : "手动记录"}</span>
              <span>
                {sourceAgent?.name ?? result.agentId} · {clockTime(result.recordedAt, snap.project.timeZone)}
              </span>
            </div>
            {isPreviousAgent && (
              <p className="qd-conclusions-note">
                以下保留原 Agent 的结论；{agent?.name} 尚无新结论。
              </p>
            )}
            <section className="qd-conclusion-section">
              <h3>本轮重点</h3>
              <button type="button" className="qd-conclusion-preview" onClick={() => setShowDetails(true)} aria-label="查看本轮方案详情"><span>{result.summary}</span><small>{result.visualBlocks?.length ? `图文方案 · ${result.visualBlocks.length} 个内容块` : '查看完整详情'} <Icon name="arrow-right" size={13} /></small></button>
            </section>
            {!!result.confirmed.length && <details className="qd-conclusion-section is-adoption"><summary><Icon name="check-circle" size={15} />已记录要点 · {result.confirmed.length}</summary><ul className="qd-conclusion-points">{result.confirmed.map((text, i) => <li key={i}><MarkdownMessage text={text} runId={sourceSession?.runtime?.runId ?? ''} /></li>)}</ul></details>}
            {!!result.open.length && !result.adopted && <details className="qd-conclusion-section is-open"><summary><Icon name="help-circle" size={15} />可补充的信息 · {result.open.length}</summary><ul className="qd-conclusion-points">{result.open.map((text, i) => <li key={i}><MarkdownMessage text={text} runId={sourceSession?.runtime?.runId ?? ''} /></li>)}</ul></details>}

          </>
        ) : (
          <div className="qd-conclusions-empty">
            <Icon name="inbox" size={28} />
            <h3>还没有讨论结论</h3>
            <p>只需明确方向；已明确的任务可直接交给 Agent 执行。</p>
          </div>
        )}
      </div>

      <footer className="qd-conclusions-foot">
        {result && <button type="button" className="qd-btn ghost" onClick={() => setShowDetails(true)}>在这里查看详情 <Icon name="chevron-right" size={15} /></button>}
        {sourceSession && <button type="button" className="qd-btn primary" onClick={() => openSourceSession(sourceSession.id)}>在 {sourceAgent?.short ?? agent?.short ?? 'Agent'} 中查看<Icon name="external" size={15} /></button>}
        {!sourceSession && sourceUrl && (
          <a className="qd-btn primary" href={sourceUrl} target="_blank" rel="noopener noreferrer">
            在 {sourceAgent?.short ?? "Agent"} 中查看
            <Icon name="external" size={15} />
          </a>
        )}
        <button
          type="button"
          className={sourceUrl || sourceSession ? "qd-link" : "qd-btn primary"}
          disabled={!agent || selecting}
          onClick={() => void openDialog("handoff")}
        >
          <Icon name="plane" size={15} />
          {sourceUrl || sourceSession ? "继续讨论另一部分" : "交给 Agent 讨论"}
        </button>
        {!sourceUrl && !sourceSession && !snap.runtimeConnections?.[agent?.id ?? ''] && <p>选择已连接的 Agent 开始讨论。</p>}
        <button
          type="button"
          className="qd-link"
          disabled={!agent || selecting}
          onClick={() => void openDialog("record")}
        >
          <Icon name="pencil" size={13} />
          记录 Agent 结论
        </button>
      </footer>
      {showDetails && result && <ConclusionDetails result={result} runId={sourceSession?.runtime?.runId ?? ''} context={visualContext} onClose={() => setShowDetails(false)} />}
      {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
      {agent && dialog === "handoff" && (
        <DiscussionHandoff
          plan={plan}
          scope={scope}
          agent={agent}
          onClose={() => setDialog(null)}
        />
      )}
      {agent && dialog === "record" && (
        <RecordDiscussionConclusion
          plan={plan}
          scope={scope}
          agent={agent}
          onClose={() => {
            setSelectedConclusionId(null);
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

function ConclusionDetails({ result, runId, context, onClose }: { result: NonNullable<IdeaPlan['discussion']>['conclusions'][number]; runId: string; context?: CanvasFeedback; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  return createPortal(<dialog ref={dialog} className="qd-conclusion-reader" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>方案详情</h2><button type="button" className="qd-icon-btn" aria-label="关闭方案详情" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div><MarkdownMessage text={result.summary} runId={runId} />{result.visualBlocks && <DiscussionCanvas blocks={result.visualBlocks} context={context} />}{result.confirmed.length > 0 && <section className="qd-answer-section"><h3>已记录要点</h3><MarkdownMessage text={result.confirmed.map(t => `- ${t}`).join('\n')} runId={runId} /></section>}{result.open.length > 0 && <section className="qd-answer-section"><h3>{result.adopted ? '原讨论中的补充项' : '可补充的信息'}</h3><MarkdownMessage text={result.open.map(t => `- ${t}`).join('\n')} runId={runId} /></section>}</div>
  </dialog>, document.body);
}
