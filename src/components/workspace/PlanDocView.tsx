import { useEffect, useRef, useState } from "react";
import { countOpen, findLine } from "../../data/ideas";
import { rootPlanOf } from "../../data/ideaEngine";
import type { IdeaPlan, LineState, PlanLine, PlanSection } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";

const STATE_LABEL: Record<LineState, string> = { fixed: "确定", tentative: "暂定", open: "待定" };

function LineRow({ plan, line, readOnly = false }: { plan: IdeaPlan; line: PlanLine; readOnly?: boolean }) {
  const { api } = useWorkdeck();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(line.text), [line.text]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const save = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== line.text) api.editPlanLine(plan.id, line.id, { text: draft });
    else setDraft(line.text);
  };
  const fresh = !readOnly && plan.round > 0 && line.round === plan.round;
  return (
    <li className={`qd-pline state-${line.state} ${fresh ? "is-fresh" : ""}`}>
      <span className="qd-pline-mark" aria-hidden="true">
        {line.state === "fixed" ? <Icon name="check" size={12} /> : line.state === "open" ? "?" : "~"}
      </span>
      {editing ? (
        <input
          ref={ref}
          className="qd-pline-input"
          value={draft}
          aria-label="编辑方案条目"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(line.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="qd-pline-text"
          disabled={readOnly}
          onClick={() => setEditing(true)}
          title={readOnly ? "继承自上级方案（只读）" : "点击编辑"}
        >
          {line.text}
        </button>
      )}
      {fresh && <span className="qd-pline-tag">本轮</span>}
      {line.userEdited && !readOnly && <span className="qd-pline-tag is-mine">我改过</span>}
      {!readOnly && (
        <select
          className="qd-pline-state"
          value={line.state}
          aria-label={`状态：${line.text}`}
          onChange={(e) => api.editPlanLine(plan.id, line.id, { state: e.target.value as LineState })}
        >
          {(Object.keys(STATE_LABEL) as LineState[]).map((k) => (
            <option key={k} value={k}>
              {STATE_LABEL[k]}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

/** 当前方案（可编辑）：要点 + 正文结构；点正文段落查看对应结论与 Agent 讨论入口 */
export function PlanDocView({ plan }: { plan: IdeaPlan }) {
  const { snap, api, workspace, patchWorkspace } = useWorkdeck();
  const root = rootPlanOf(snap, plan.taskId);
  const parentDoc = root?.adopted?.doc ?? root?.draft;
  const inherited = plan.itemId && parentDoc ? (plan.inherit ?? []).map((id) => findLine(parentDoc, id)?.line).filter(Boolean) as PlanLine[] : [];
  const open = countOpen(plan.draft);
  const keys = plan.draft.sections.filter((s) => s.kind === "key");
  const body = plan.draft.sections.filter((s) => s.kind === "body");
  const empty = plan.draft.sections.every((s) => s.lines.length === 0);
  const scope = workspace?.scope ?? "root";

  const toDrafts = async () => {
    await api.generateDrafts(plan.id);
    patchWorkspace({ mode: "drafts", pane: "main" });
  };

  const section = (s: PlanSection) => (
    <section key={s.id} data-plan-section={s.id} tabIndex={-1} className={`qd-psec ${scope === s.id ? "is-scope" : ""}`} aria-label={s.title}>
      <button
        type="button"
        className="qd-psec-head"
        aria-pressed={scope === s.id}
        onClick={() => patchWorkspace({ scope: scope === s.id ? "root" : s.id, pane: "side" })}
        title="查看此段结论及 Agent 讨论入口"
      >
        <h3>{s.title}</h3>
        <span className="qd-psec-talk">
          <Icon name="message" size={13} />
          {scope === s.id ? "当前范围" : "查看结论"}
        </span>
      </button>
      <ul className="qd-plines">
        {s.lines.map((l) => (
          <LineRow key={l.id} plan={plan} line={l} />
        ))}
        {s.lines.length === 0 && <li className="qd-pline-empty">待 Agent 结论</li>}
      </ul>
    </section>
  );

  return (
    <div className="qd-plan">
      <header className="qd-plan-head">
        <div>
          <h2>{plan.itemId ? plan.title : "当前方案"}</h2>
          <p className="qd-plan-status">
            草稿 · v{plan.draftVersion} · {open} 项待定 · {plan.adopted ? `已采用 v${plan.adopted.version}` : "尚未采用"}
          </p>
        </div>
        <button type="button" className="qd-btn primary small" onClick={toDrafts} disabled={empty}>
          <Icon name="check-square" size={14} />
          整理为{plan.itemId ? "子任务" : "任务"}
        </button>
      </header>

      {!(plan.discussion?.conclusions?.length) && (
        <div className="qd-plan-start">
          <p>先把想法聊清楚</p>
          <span>选择 Agent 讨论 → 汇总结论 → 按需拆成任务</span>
          <button type="button" className="qd-link" onClick={() => {
            patchWorkspace({ pane: "side" });
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".qd-conclusions-foot .qd-btn.primary")?.focus());
          }}>去讨论 <Icon name="arrow-right" size={14} /></button>
        </div>
      )}

      {empty && <p className="qd-plan-empty">还没有方案内容。可先交给 Agent 讨论，再记录结论。</p>}

      {inherited.length > 0 && (
        <section className="qd-psec is-inherit" aria-label="继承自上级">
          <div className="qd-psec-head is-static">
            <h3>继承自上级 · 只读</h3>
          </div>
          <ul className="qd-plines">
            {inherited.map((l) => (
              <LineRow key={l.id} plan={plan} line={l} readOnly />
            ))}
          </ul>
        </section>
      )}

      {keys.some((s) => s.lines.length) && (
        <div className="qd-pkeys">
          {keys.map((s) =>
            s.lines.length ? (
              <div key={s.id} data-plan-section={s.id} tabIndex={-1} className={`qd-pkey key-${s.id}`}>
                <h3>{s.title}</h3>
                <ul className="qd-plines">
                  {s.lines.map((l) => (
                    <LineRow key={l.id} plan={plan} line={l} />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}

      {body.length > 0 && !empty && (
        <div className="qd-pbody">
          <h3 className="qd-pbody-title">结构</h3>
          {body.map(section)}
        </div>
      )}
    </div>
  );
}
