import { useEffect, useRef } from "react";
import { daysOf, findLine } from "../../data/ideas";
import { rootPlanOf } from "../../data/ideaEngine";
import { WORK_LABEL } from "../../data/orchestration";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { WorkIcon } from "../work/WorkStatus";

/** 成果笔记预览：按已采用方案生成，关联来源版本与任务；笔记完成不等于旅行完成 */
export function NotePreview({ taskId }: { taskId: string }) {
  const { snap, patchWorkspace } = useWorkdeck();
  const ref = useRef<HTMLDivElement>(null);
  const plan = rootPlanOf(snap, taskId);
  const orch = snap.orchestrations?.[taskId];
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && patchWorkspace({ note: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [patchWorkspace]);
  if (!plan) return null;
  const doc = plan.adopted?.doc ?? plan.draft;
  const days = daysOf(doc) ?? 0;
  const text = (id: string) => findLine(doc, id)?.line.text;
  const linked = Object.values(orch?.items ?? {}).filter((w) => ["note", "review", "photos", "daily"].includes(w.draftKey ?? ""));
  const noteItem = linked.find((w) => w.draftKey === "note");
  const reviewItem = linked.find((w) => w.draftKey === "review");
  const status =
    reviewItem?.status === "done" ? "已审阅定稿" : noteItem?.status === "done" ? "草稿已汇总，待审阅" : "尚未汇总，以下按方案预览";

  return (
    <div className="qd-note-overlay" role="presentation" onClick={() => patchWorkspace({ note: false })}>
      <div
        className="qd-note"
        role="dialog"
        aria-modal="true"
        aria-label="成果笔记预览"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="qd-note-head">
          <div>
            <span className="qd-tag">演示 · 成果笔记预览</span>
            <h2>{days ? `${days} 天轻松旅行计划` : plan.title}</h2>
            <p>
              来源 方案 v{plan.adopted?.version ?? "—（未采用）"} · {status} · 笔记完成不代表旅行已完成
            </p>
          </div>
          <button type="button" className="qd-icon-btn" aria-label="关闭" onClick={() => patchWorkspace({ note: false })}>
            <Icon name="close" size={17} />
          </button>
        </header>
        <section>
          <h3>总览</h3>
          <p>{[text("l-days"), text("l-people"), text("l-pace"), text("l-transport")].filter(Boolean).join(" · ")}</p>
        </section>
        {days > 0 && (
          <section>
            <h3>每日行程</h3>
            <div className="qd-note-days">
              {Array.from({ length: days }, (_, i) => (
                <div key={i} className="qd-note-day">
                  <strong>Day {i + 1}</strong>
                  <div className="qd-note-route">路线示意（待绘制）</div>
                  <div className="qd-note-photos">
                    <span>参考图 · 注明来源</span>
                    <span>参考图 · 注明来源</span>
                    <span>我的照片 · 旅行后替换</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3>交通</h3>
          <p>{[text("l-transport"), text("l-tr-0")].filter(Boolean).join("；") || "待定"}</p>
        </section>
        <footer className="qd-note-foot">
          <h3>关联任务</h3>
          <ul>
            {linked.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  className="qd-link"
                  onClick={() => patchWorkspace({ note: false, view: "tasks", selected: w.id, mode: "doc" })}
                >
                  <WorkIcon status={w.status} size={12} />
                  {w.title}
                </button>
                <span>
                  {WORK_LABEL[w.status]}
                  {w.source ? ` · 来源 v${w.source.version}` : ""}
                </span>
              </li>
            ))}
            {linked.length === 0 && <li>还没有关联任务</li>}
          </ul>
        </footer>
      </div>
    </div>
  );
}
