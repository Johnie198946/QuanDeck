import { useState } from "react";
import { findLine, revisionImpact } from "../../data/ideas";
import type { IdeaPlan, WorkItem } from "../../data/types";
import { WORK_LABEL } from "../../data/orchestration";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { WorkIcon } from "../work/WorkStatus";

/** 修订影响：草稿与已采用版本的差异，按任务状态分别处理；不覆盖执行历史 */
export function RevisionPanel({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace } = useWorkdeck();
  const orch = snap.orchestrations?.[plan.taskId] ?? null;
  const impact = revisionImpact(plan, orch, Object.values(snap.ideaPlans ?? {}));
  const [supplement, setSupplement] = useState<string[]>(() => impact?.done.map((w) => w.id) ?? []);
  if (!impact || !plan.adopted) {
    return (
      <div className="qd-revision">
        <p className="qd-plan-empty">草稿与已采用版本一致，没有待应用的修订。</p>
        <button type="button" className="qd-link" onClick={() => patchWorkspace({ mode: "doc" })}>
          返回方案
        </button>
      </div>
    );
  }
  const before = (id: string) => findLine(plan.adopted!.doc, id)?.line.text;
  const after = (id: string) => findLine(plan.draft, id)?.line.text;
  const row = (w: WorkItem, note: string, extra?: React.ReactNode) => (
    <li key={w.id} className="qd-rev-item">
      <WorkIcon status={w.status} size={13} />
      <span className="qd-rev-title">{w.title}</span>
      <span className="qd-rev-note">
        {WORK_LABEL[w.status]} · {note}
      </span>
      {extra}
    </li>
  );
  const groups: { key: string; title: string; items: WorkItem[]; note: (w: WorkItem) => string; extra?: (w: WorkItem) => React.ReactNode }[] = [
    { key: "update", title: "可更新", items: impact.update, note: () => `更新为 v${impact.fromVersion + 1} 的要求` },
    { key: "running", title: "执行中 · 保留当前版本", items: impact.running, note: (w) => `按 v${w.source?.version} 继续，完成后复核` },
    {
      key: "done",
      title: "已完成 · 保留成果与记录",
      items: impact.done,
      note: () => "成果、完成记录与消耗保留",
      extra: (w) => (
        <label className="qd-rev-sup">
          <input
            type="checkbox"
            checked={supplement.includes(w.id)}
            onChange={(e) => setSupplement((s) => (e.target.checked ? [...s, w.id] : s.filter((x) => x !== w.id)))}
          />
          新建补充任务
        </label>
      ),
    },
    { key: "obsolete", title: "不再需要", items: impact.obsolete, note: (w) => (w.status === "done" ? "成果保留" : "将取消，记录保留") },
  ];

  return (
    <div className="qd-revision">
      <header className="qd-plan-head">
        <div>
          <h2>修订影响</h2>
          <p className="qd-plan-status">
            任务基于 v{impact.fromVersion} · 草稿有 {impact.changed.length} 处改动 · 按任务来源段落匹配，未做语义分析
          </p>
        </div>
        <button type="button" className="qd-link" onClick={() => patchWorkspace({ mode: "doc" })}>
          返回方案
        </button>
      </header>
      <ul className="qd-rev-changes" aria-label="改动">
        {impact.changed.map((id) => (
          <li key={id}>
            {before(id) ? <del>{before(id)}</del> : <span className="qd-rev-new">新增</span>}
            {after(id) ? <span> → {after(id)}</span> : <span> → 已删除</span>}
          </li>
        ))}
      </ul>
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.key} className={`qd-rev-group is-${g.key}`} aria-label={g.title}>
            <h3>
              {g.title} <span>{g.items.length}</span>
            </h3>
            <ul>{g.items.map((w) => row(w, g.note(w), g.extra?.(w)))}</ul>
          </section>
        ) : null,
      )}
      {groups.every((g) => g.items.length === 0) && <p className="qd-plan-empty">这些改动不影响已加入的任务。</p>}
      <footer className="qd-drafts-foot">
        <button type="button" className="qd-btn ghost small" onClick={() => patchWorkspace({ mode: "doc" })}>
          稍后
        </button>
        <button
          type="button"
          className="qd-btn primary small"
          onClick={async () => {
            const r = await api.applyRevision(plan.id, supplement);
            toast(r.message ?? "", r.ok ? "info" : "error");
            if (r.ok) patchWorkspace({ mode: "doc", view: "tasks" });
          }}
        >
          应用到任务（v{impact.fromVersion + 1}）
        </button>
      </footer>
    </div>
  );
}
