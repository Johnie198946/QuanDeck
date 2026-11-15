import { useEffect, useState } from "react";
import { latestConclusion, safeDiscussionUrl } from "../../data/discussion";
import { rootPlanOf } from "../../data/ideaEngine";
import type { IdeaPlan } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { useConfiguredAgents } from "../../integration/configuredAgents";
import { AgentConnectionSetup } from "../deck/AgentConnectionSetup";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { DiscussionHandoff, RecordDiscussionConclusion } from "./DiscussionDialogs";

/** 对话留在源 Agent；这里仅呈现结论、来源与显式采用操作。 */
export function DiscussionSummary({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, workspace, patchWorkspace } = useWorkdeck();
  const [dialog, setDialog] = useState<"handoff" | "record" | null>(null);
  const { agents } = useConfiguredAgents(snap.agents);
  const [connecting, setConnecting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [adopting, setAdopting] = useState(false);
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
  const adopt = async () => {
    if (!result) return;
    setAdopting(true);
    try {
      const r = await api.adoptDiscussionConclusion(plan.id, result.id);
      toast(r.message ?? "", r.ok ? "info" : "error");
    } catch {
      toast("未能采用结论，现有方案已保留。", "error");
    } finally {
      setAdopting(false);
    }
  };

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
        <p className="qd-conclusions-boundary">在 Agent 中讨论，结论汇总到这里。</p>
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
                  {i === 0 ? "最新" : "历史"} · {c.recordedAt} · {c.summary.slice(0, 24)}
                </option>
              ))}
            </select>
          </label>
        )}
        {result ? (
          <>
            <div className="qd-conclusions-provenance">
              <span className="qd-tag">{result.source === "sample" ? "示例结论" : "手动记录"}</span>
              <span>
                {sourceAgent?.name ?? result.agentId} · {result.recordedAt}
              </span>
            </div>
            {isPreviousAgent && (
              <p className="qd-conclusions-note">
                以下保留原 Agent 的结论；{agent?.name} 尚无新结论。
              </p>
            )}
            <section className="qd-conclusion-section">
              <h3>本轮结论</h3>
              <p className="qd-conclusion-summary">{result.summary}</p>
            </section>
            <section className="qd-conclusion-section is-adoption">
              <h3>
                <Icon name="check-circle" size={15} />
                已确定<span>{result.confirmed.length}</span>
              </h3>
              {result.confirmed.length ? (
                <ul className="qd-conclusion-points">
                  {result.confirmed.map((text, i) => (
                    <li key={`${i}-${text}`}>{text}</li>
                  ))}
                </ul>
              ) : (
                <p className="qd-conclusions-note">暂无已确定事项</p>
              )}
            </section>
            <section className="qd-conclusion-section is-open">
              <h3>
                <Icon name="help-circle" size={15} />
                待决定<span>{result.open.length}</span>
              </h3>
              {result.open.length ? (
                <ul className="qd-conclusion-points">
                  {result.open.map((text, i) => (
                    <li key={`${i}-${text}`}>{text}</li>
                  ))}
                </ul>
              ) : (
                <p className="qd-conclusions-note">本次没有待决定事项</p>
              )}
            </section>
            <section className="qd-conclusion-section">
              <h3>
                <Icon name="pencil" size={15} />
                采用结论
              </h3>
              <p className="qd-conclusions-note">
                {result.adopted
                  ? "已采用，手动编辑的内容已保留。"
                  : "确认后补充到左侧方案。"}
              </p>
              {!result.adopted && (
                <button
                  type="button"
                  className="qd-btn ghost small"
                  disabled={adopting}
                  onClick={adopt}
                >
                  {adopting ? "采用中…" : "采用到方案"}
                </button>
              )}
            </section>
          </>
        ) : (
          <div className="qd-conclusions-empty">
            <Icon name="inbox" size={28} />
            <h3>还没有讨论结论</h3>
            <p>先和 {agent?.short ?? "Agent"} 把想法聊清楚，再把结论整理成方案。</p>
          </div>
        )}
      </div>

      <footer className="qd-conclusions-foot">
        {sourceUrl && (
          <a className="qd-btn primary" href={sourceUrl} target="_blank" rel="noopener noreferrer">
            回到{sourceAgent?.short ?? "Agent"}讨论
            <Icon name="external" size={15} />
          </a>
        )}
        <button
          type="button"
          className={sourceUrl ? "qd-link" : "qd-btn primary"}
          disabled={!agent || selecting}
          onClick={() => void openDialog("handoff")}
        >
          <Icon name="plane" size={15} />
          {sourceUrl ? "继续讨论另一部分" : "交给 Agent 讨论"}
        </button>
        {!sourceUrl && <p>复制目标与约束，到 Agent 中开始。</p>}
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
