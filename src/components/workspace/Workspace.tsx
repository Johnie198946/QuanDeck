import { TaskAttachmentsButton } from "./TaskAttachments";
import { TaskIcon } from "../ui/TaskIcon";
import { ResultsBoard } from "../results/ResultsBoard";
import { changedLines } from "../../data/ideas";
import { localPlanId, rootPlanOf } from "../../data/ideaEngine";
import { summarize } from "../../data/orchestration";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { TaskScope } from "../deck/TaskScope";
import { Icon } from "../ui/Icon";
import { WorkDetail } from "../work/WorkDetail";
import { DiscussionSummary } from "./DiscussionSummary";
import { DraftPreview } from "./DraftPreview";
import { NotePreview } from "./NotePreview";
import { PlanDocView } from "./PlanDocView";
import { RevisionPanel } from "./RevisionPanel";

/**
 * 事项工作区：同一事项的两个视图。
 * 思路 = 当前方案（中）+ Agent 结论（右）；任务 = 任务树（中）+ 执行详情（右）。
 */
export function Workspace() {
  const { snap, workspace: ws, patchWorkspace, closeWorkspace } = useWorkdeck();
  if (!ws) return null;
  if (ws.view === "results") return <ResultsBoard />;
  const task = snap.tasks[ws.taskId];
  const root = rootPlanOf(snap, ws.taskId);
  const plan = (ws.itemId ? snap.ideaPlans?.[localPlanId(ws.taskId, ws.itemId)] : null) ?? root;
  const orch = snap.orchestrations?.[ws.taskId] ?? null;
  const count = orch ? Object.values(orch.items).filter((w) => w.status !== "cancelled").length : 0;
  const selected = ws.selected && orch?.items[ws.selected] ? orch.items[ws.selected] : null;
  const pendingRevision = !!root?.adopted && changedLines(root.adopted.doc, root.draft).size > 0;
  const sum = orch && count ? summarize(snap, orch) : null;

  if (!task || !plan) {
    return (
      <section className="qd-ws">
        <p className="qd-plan-empty">这个事项已不存在。</p>
        <button type="button" className="qd-link" onClick={closeWorkspace}>
          返回
        </button>
      </section>
    );
  }

  const tabs: { key: "plan" | "tasks" | "results"; label: string }[] = [
    { key: "plan", label: "思路" },
    { key: "tasks", label: count ? `任务 ${count}` : "任务" },
    { key: "results", label: "结果看板" },
  ];
  const paneLabels = ws.view === "plan" ? ["方案", "结论"] : ["任务", "详情"];

  return (
    <section className={`qd-ws view-${ws.view} pane-${ws.pane}`} aria-label={`事项：${task.title}`}>
      <header className="qd-ws-head">
        <button type="button" className="qd-ws-back" onClick={closeWorkspace} aria-label="返回上一页">
          <Icon name="chevron-left" size={17} />
          返回
        </button>
        <h1 className="qd-ws-title qd-task-name" title={task.title}>
          <TaskIcon snapshot={snap} taskId={task.id} size={24} /><span>{task.title}</span>
        </h1>
        <nav className="qd-ws-tabs" role="tablist" aria-label="事项视图">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={ws.view === t.key}
              className={ws.view === t.key ? "is-on" : ""}
              onClick={() =>
                patchWorkspace(
                  t.key === "plan" ? { view: "plan" } : { view: t.key, mode: "doc", itemId: null, scope: "root", focus: t.key === "results" ? true : ws.focus },
                )
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="qd-ws-tools">
          <TaskAttachmentsButton taskId={task.id} />
          {root?.script === "travel" && (
            <button type="button" className="qd-btn ghost small" onClick={() => patchWorkspace({ note: true })}>
              <Icon name="folder" size={14} />
              成果笔记
            </button>
          )}
          <button
            type="button"
            className={`qd-icon-btn ${ws.focus ? "is-on" : ""}`}
            aria-pressed={ws.focus}
            aria-label={ws.focus ? "显示时间线" : "收起时间线，专注思考"}
            title={ws.focus ? "显示时间线" : "收起时间线"}
            onClick={() => patchWorkspace({ focus: !ws.focus })}
          >
            <Icon name={ws.focus ? "clock" : "sliders"} size={16} />
          </button>
        </div>
      </header>

      {pendingRevision && ws.mode !== "revision" && (
        <p className="qd-ws-banner" role="status">
          <Icon name="alert" size={14} />
          此修订尚未应用到任务（任务基于 v{root!.adopted!.version}）
          <button
            type="button"
            className="qd-link"
            onClick={() => patchWorkspace({ view: "plan", itemId: null, scope: "root", mode: "revision", pane: "main" })}
          >
            查看任务影响
          </button>
        </p>
      )}

      <div className="qd-ws-panes" role="tablist" aria-label="窄屏切换">
        {paneLabels.map((l, i) => {
          const key = i === 0 ? "main" : "side";
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={ws.pane === key}
              className={ws.pane === key ? "is-on" : ""}
              onClick={() => patchWorkspace({ pane: key })}
            >
              {l}
            </button>
          );
        })}
      </div>

      <div className="qd-ws-body">
        <main className="qd-ws-main">
          {ws.view === "plan" ? (
            ws.mode === "drafts" ? (
              <DraftPreview plan={plan} />
            ) : ws.mode === "revision" && root ? (
              <RevisionPanel plan={root} />
            ) : (
              <>
                {ws.itemId && (
                  <button
                    type="button"
                    className="qd-ws-up"
                    onClick={() => patchWorkspace({ itemId: null, scope: "root", mode: "doc" })}
                  >
                    <Icon name="chevron-left" size={14} />
                    {root?.title ?? "上级方案"}
                  </button>
                )}
                <PlanDocView plan={plan} />
              </>
            )
          ) : orch && count ? (
            <TaskScope o={orch} embedded selectedId={ws.selected} onSelect={(id) => patchWorkspace({ selected: id, pane: "side" })} />
          ) : (
            <div className="qd-plan-empty">
              还没有任务。可以在思路里把明确的部分整理为任务，也可以只讨论不建任务。
            </div>
          )}
        </main>
        <aside className="qd-ws-side" aria-label={ws.view === "plan" ? "讨论结论" : "执行详情"}>
          {ws.view === "plan" ? (
            <DiscussionSummary key={`${plan.id}:${ws.scope}`} plan={plan} />
          ) : selected && orch ? (
            <div className="qd-ws-detail">
              <h2 className="qd-ws-detail-title qd-task-name"><TaskIcon snapshot={snap} taskId={task.id} workItemId={selected.id} size={20} /><span>{selected.title}</span></h2>
              <WorkDetail o={orch} item={selected} inWorkspace onSelect={(id) => patchWorkspace({ selected: id })} />
            </div>
          ) : (
            <div className="qd-ws-hint">
              {sum ? (
                <>
                  <p>
                    {sum.done}/{sum.total} 完成 · {sum.overall.label}
                  </p>
                  <p>选择左侧任务查看详情、安排负责人或委派。</p>
                </>
              ) : (
                <p>选择任务查看详情。</p>
              )}
            </div>
          )}
        </aside>
      </div>
      {ws.note && <NotePreview taskId={ws.taskId} />}
    </section>
  );
}
