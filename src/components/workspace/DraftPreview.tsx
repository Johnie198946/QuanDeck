import { useEffect, useState } from "react";
import { docWithInherit } from "../../data/ideaEngine";
import type { IdeaPlan, Owner, TaskDraft } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { useConfiguredAgents } from "../../integration/configuredAgents";
import { AgentConnectionSetup } from "../deck/AgentConnectionSetup";
import { Icon } from "../ui/Icon";

const OWNERS: { key: Owner; label: string }[] = [
  { key: "me", label: "我" },
  { key: "agent", label: "Agent" },
  { key: "unassigned", label: "未安排" },
];

function Field({ value, onSave, label, className }: { value: string; onSave: (v: string) => void; label: string; className: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={className}
      value={v}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 任务草稿预览：选择、编辑、合并、删除、调整层级；加入只创建任务，不启动 Agent */
export function DraftPreview({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace } = useWorkdeck();
  const orch = snap.orchestrations?.[plan.taskId];
  const projectDirection = plan.scope === 'project';
  const doc = docWithInherit(snap, plan);
  const { agents } = useConfiguredAgents(snap.agents);
  const [connecting, setConnecting] = useState(false);
  const suggested = agents.find(agent => agent.id === snap.defaultAgent) ?? agents[0];
  const added = (x: TaskDraft) => !!orch && Object.values(orch.items).some((w) => w.draftKey === x.key);
  const titleOf = (k: string) => plan.drafts.find((x) => x.key === k)?.title ?? orch?.items[`w-${k}`]?.title ?? k;
  const sources = (x: TaskDraft) =>
    [...new Set(x.lineIds.map((id) => doc.sections.find((s) => s.lines.some((l) => l.id === id))?.title).filter(Boolean))].join("、");
  const chosen = plan.drafts.filter((x) => x.include).length;
  const needsAgent = plan.drafts.some(x => x.include && !added(x) && x.owner === "agent" && !agents.some(agent => agent.id === x.agentId));

  const add = async () => {
    if (needsAgent) { toast("请为 Agent 任务选择已配置的工具，或将负责人改为我／未安排。", "error"); return; }
    const r = await api.addDraftsToTasks(plan.id);
    toast(r.message ?? "", r.ok ? "info" : "error");
    if (r.ok) patchWorkspace({ view: "tasks", mode: "doc", selected: null });
  };

  return (
    <div className="qd-drafts">
      <header className="qd-plan-head">
        <div>
          <h2>任务草稿</h2>
          <p className="qd-plan-status">
            来自{plan.itemId ? `「${plan.title}」` : "当前方案"}草稿 v{plan.draftVersion} · {projectDirection ? "确认方向时一并生成任务，是否执行由你决定" : "加入后只创建任务，不启动 Agent"}
          </p>
        </div>
        <button type="button" className="qd-link" onClick={() => patchWorkspace({ mode: "doc" })}>
          返回方案
        </button>
      </header>

      {plan.drafts.length === 0 && <p className="qd-plan-empty">方案中还没有可整理的部分。</p>}
      <ol className="qd-draft-list">
        {plan.drafts.map((x, i) => {
          const done = added(x);
          return (
            <li key={x.key} className={`qd-draft ${x.parentKey ? "is-child" : ""} ${done ? "is-added" : ""}`}>
              <input
                type="checkbox"
                className="qd-draft-check"
                checked={x.include}
                disabled={done}
                aria-label={`加入：${x.title}`}
                onChange={(e) => api.updateDraft(plan.id, x.key, { include: e.target.checked })}
              />
              <div className="qd-draft-main">
                <Field className="qd-draft-title" value={x.title} label="行动" onSave={(v) => api.updateDraft(plan.id, x.key, { title: v })} />
                <Field className="qd-draft-expected" value={x.expected} label="预期结果" onSave={(v) => api.updateDraft(plan.id, x.key, { expected: v })} />
                <p className="qd-draft-meta">
                  {x.deps.length > 0 && <span>依赖：{x.deps.map(titleOf).join("、")}</span>}
                  <span>来源：{sources(x) || "方案"}</span>
                  {x.notReady && <span className="is-warn">{x.notReady}</span>}
                  {done && <span className="is-ok">已加入，不会重复</span>}
                </p>
              </div>
              <div className="qd-draft-side">
                <div className="qd-seg qd-owner-seg" role="radiogroup" aria-label={`负责人：${x.title}`}>
                  {OWNERS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={x.owner === o.key}
                      className={x.owner === o.key ? "is-on" : ""}
                      disabled={done}
                      onClick={() => api.updateDraft(plan.id, x.key, { owner: o.key, agentId: o.key === "agent" ? (agents.some(agent => agent.id === x.agentId) ? x.agentId : suggested?.id) : undefined })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {x.owner === "agent" && (
                  <select
                    className="qd-draft-agent"
                    value={agents.some(agent => agent.id === x.agentId) ? x.agentId : ""}
                    disabled={done}
                    aria-label="建议 Agent"
                    onChange={(e) => api.updateDraft(plan.id, x.key, { agentId: e.target.value })}
                  >
                    <option value="" disabled>{agents.length ? "请选择 Agent" : "尚未配置 Agent"}</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        建议 {a.name}
                      </option>
                    ))}
                  </select>
                )}
                {x.owner === "agent" && !agents.length && !done && <button type="button" className="qd-link" onClick={() => setConnecting(true)}>配置 Agent</button>}
                {!done && (
                  <div className="qd-draft-actions">
                    <button
                      type="button"
                      className="qd-icon-btn"
                      aria-label={x.parentKey ? `取消缩进：${x.title}` : `缩进为上一项的子任务：${x.title}`}
                      title={x.parentKey ? "取消缩进" : "设为上一项的子任务"}
                      disabled={i === 0 && !x.parentKey}
                      onClick={() => api.indentDraft(plan.id, x.key, x.parentKey ? -1 : 1)}
                    >
                      <Icon name={x.parentKey ? "chevron-left" : "chevron-right"} size={15} />
                    </button>
                    <button
                      type="button"
                      className="qd-icon-btn"
                      aria-label={`合并到上一项：${x.title}`}
                      title="合并到上一项"
                      disabled={i === 0}
                      onClick={async () => {
                        const r = await api.mergeDraftUp(plan.id, x.key);
                        if (!r.ok) toast(r.message ?? "", "error");
                      }}
                    >
                      <Icon name="merge" size={15} />
                    </button>
                    <button
                      type="button"
                      className="qd-icon-btn"
                      aria-label={`删除：${x.title}`}
                      title="删除"
                      onClick={() => api.removeDraft(plan.id, x.key)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {connecting && <AgentConnectionSetup onClose={() => setConnecting(false)} />}
      {needsAgent && <p className="qd-plan-status" role="status">请为 Agent 任务选择已配置的工具，或将负责人改为我／未安排。</p>}
      <footer className="qd-drafts-foot">
        <button type="button" className="qd-btn ghost small" onClick={() => patchWorkspace({ mode: "doc" })}>
          返回方案与结论
        </button>
        <button type="button" className="qd-btn primary small" disabled={!projectDirection && (chosen === 0 || needsAgent)} onClick={projectDirection ? () => patchWorkspace({ mode: "doc", pane: "main" }) : add}>
          {projectDirection ? "返回确认方向" : `加入 ${chosen} 项任务`}
        </button>
      </footer>
    </div>
  );
}
