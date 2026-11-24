import { useLayoutEffect, useRef, useState } from 'react';
import { isDirectionRetrospective } from '../../data/discussionAuthority';
import { ActivityReply } from '../deck/ActivityReply';
import { pendingSessionStatus } from '../../data/derive';
import { DirectionReply } from './DirectionReply';
import { DirectionDiscussionDrawer } from './DirectionDiscussionDrawer';
import './direction-reading.css';
import { taskExecutionPresentation } from "../../data/taskExecutionPresentation";
import { TaskDirectView } from "./TaskDirectView";
import { TaskHandoffPanel } from '../work/TaskHandoffPanel';
import "./plan-flow.css";
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
  const { snap, api, toast, workspace: ws, patchWorkspace, closeWorkspace, openSourceSession } = useWorkdeck();
  const container = useRef<HTMLElement>(null), discussionTrigger = useRef<HTMLButtonElement>(null);
  const [narrow, setNarrow] = useState(false), [collapsed, setCollapsed] = useState(true);
  const [openedReplyId, setOpenedReplyId] = useState<string>();
  const [documentView, setDocumentView] = useState<{ planId: string; version: 'draft' | 'adopted' } | null>(null);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || ws?.view !== 'plan') return;
    setNarrow(node.getBoundingClientRect().width <= 1000);
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 1000));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ws?.taskId, ws?.planId, ws?.view]);
  const currentPlan = ws ? (ws.planId ? snap.ideaPlans?.[ws.planId] : undefined) ?? (ws.itemId ? snap.ideaPlans?.[localPlanId(ws.taskId, ws.itemId)] : undefined) ?? rootPlanOf(snap, ws.taskId) : undefined;
  const retrospective = isDirectionRetrospective(snap, currentPlan);
  useLayoutEffect(() => setCollapsed(true), [currentPlan?.id, retrospective]);
  useLayoutEffect(() => {
    if (!ws?.focusReply || retrospective || ws.view !== 'plan') return;
    const input = container.current?.querySelector<HTMLElement>('.qd-direction-conversation [data-direction-input]:not(:disabled), .qd-direction-conversation .qd-activity-reply :is(button,input,textarea):not(:disabled)');
    if (input) {
      input.focus();
      patchWorkspace({ focusReply: false });
    }
  }, [ws?.planId, ws?.focusReply, ws?.view, retrospective, patchWorkspace]);
  if (!ws) return null;
  if (ws.view === "results") return <ResultsBoard />;
  const task = snap.tasks[ws.taskId];
  const explicitPlan = ws.planId ? snap.ideaPlans?.[ws.planId] : undefined;
  const root = explicitPlan?.scope === 'project' ? explicitPlan : rootPlanOf(snap, ws.taskId);
  const plan = currentPlan;
  const projectPlan = plan?.scope === 'project';
  const orch = snap.orchestrations?.[ws.taskId] ?? null;
  const count = orch ? Object.values(orch.items).filter((w) => w.status !== "cancelled").length : 0;
  const selected = ws.selected && orch?.items[ws.selected] ? orch.items[ws.selected] : null;
  const pendingRevision = !!root?.adopted && changedLines(root.adopted.doc, root.draft).size > 0;
  const sum = orch && count ? summarize(snap, orch) : null;
  const attention = taskExecutionPresentation(snap, ws.taskId).attention;

  if (!task && !projectPlan) {
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
    { key: "plan", label: "方向方案" },
    { key: "tasks", label: count ? `任务 ${count}` : "任务" },
    { key: "results", label: "汇总成果" },
  ];
  const paneLabels = ws.view === "plan" ? ["大纲与正文", "讨论与版本"] : ["任务", "详情"];
  const title = projectPlan ? snap.project.name : task.title;
  const direction = ws.view === 'plan';
  const documentVersion = plan?.adopted ? (documentView?.planId === plan.id ? documentView.version : retrospective ? 'adopted' : 'draft') : 'draft';
  const switchDocument = (version: 'draft' | 'adopted') => {
    if (plan) setDocumentView({ planId: plan.id, version });
    patchWorkspace({ mode: 'doc', pane: 'main' });
  };
  const readingHistory = retrospective || documentVersion === 'adopted';
  const replies = readingHistory ? (plan?.discussion?.conclusions ?? []).filter(c => c.source === 'agent') : [];
  const historicalReply = [...replies].reverse().find(c => c.scopeId === ws.scope) ?? replies.at(-1);
  const discussionOpen = narrow ? ws.pane === 'side' : !collapsed;
  const toggleDiscussion = () => {
    if (!discussionOpen && historicalReply) {
      setOpenedReplyId(historicalReply.id);
      patchWorkspace({ scope:historicalReply.scopeId, ...(narrow ? { pane:'side' } : {}) });
    } else if (narrow) patchWorkspace({ pane:discussionOpen ? 'main' : 'side' });
    if (!narrow) setCollapsed(discussionOpen);
  };
  const editingDiscussion = direction && !!plan && !readingHistory && ws.mode === 'doc';
  const pendingSessions = editingDiscussion ? Object.values(snap.sessions).filter(session => {
    const runtime = session.runtime;
    if (session.linkedAsHistory || !runtime?.runId || runtime.projectId !== snap.project.id ||
        !['running', 'waiting_reply', 'waiting_permission'].includes(session.status) || !pendingSessionStatus(session)) return false;
    if (runtime.purpose === 'discussion') return runtime.planId === plan.id && (runtime.scope ?? 'root') === ws.scope;
    return !projectPlan && runtime.taskId === ws.taskId && (!ws.itemId || runtime.workItemId === ws.itemId);
  }) : [];
  const focusDiscussion = (scope: string) => {
    setCollapsed(true);
    patchWorkspace({ scope, pane: 'main', mode: 'doc', focusReply: true });
  };
  const discussion = plan ? <DiscussionSummary readOnlyDocument={readingHistory} initialReplyId={readingHistory ? openedReplyId : undefined} key={JSON.stringify([plan.id,ws.scope,readingHistory,openedReplyId])} plan={plan} onReply={() => { switchDocument('draft'); focusDiscussion(ws.scope); }} onReadDocument={() => switchDocument('draft')} /> : null;

  return (
    <section ref={container} data-discussion-narrow={direction ? narrow : undefined} data-discussion-collapsed={direction ? collapsed : undefined} className={`qd-ws view-${ws.view} pane-${ws.pane}`} aria-label={`${projectPlan ? '项目方向' : '事项'}：${title}`}>
      <header className="qd-ws-head">
        <button type="button" className="qd-ws-back" onClick={closeWorkspace} aria-label="返回上一页">
          <Icon name="chevron-left" size={17} />
          返回
        </button>
        <h1 className="qd-ws-title qd-task-name" title={title}>
          {projectPlan ? <Icon name="folder" size={24} /> : <TaskIcon snapshot={snap} taskId={task.id} size={24} />}<span>{title}</span>
        </h1>
        <nav className="qd-ws-tabs" role="tablist" aria-label="事项视图">
          {tabs.filter(t => !projectPlan || t.key === 'plan').map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={ws.view === t.key}
              className={ws.view === t.key ? "is-on" : ""}
              onClick={async () => {
                try {
                  if (t.key === "plan" && !plan) await api.ensureTaskPlan(task.id);
                  patchWorkspace(t.key === "plan" ? { view: "plan" } : { view: t.key, planId: root?.id, mode: "doc", itemId: null, scope: "root", focus: t.key === "results" ? true : ws.focus });
                } catch (error) { toast(error instanceof Error ? error.message : "暂未能打开方案", "error"); }
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="qd-ws-tools">
          {direction && <button ref={discussionTrigger} type="button" className="qd-btn ghost small qd-discussion-toggle" aria-controls="direction-discussion" aria-expanded={discussionOpen}
            onClick={toggleDiscussion}>
            {discussionOpen ? '收起讨论' : historicalReply ? '查看 AI 回复' : '讨论与版本'}
          </button>}
          {!projectPlan && <TaskAttachmentsButton taskId={task.id} />}
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

      {pendingRevision && !retrospective && ws.mode !== "revision" && !(direction && documentVersion === 'adopted') && (
        <p className="qd-ws-banner" role="status">
          <Icon name="alert" size={14} />
          {projectPlan ? `方向已更新。任务仍基于已确认的 v${root!.adopted!.draftVersion ?? root!.adopted!.version}，请在页首确认当前版本。` : `此修订尚未应用到任务（任务基于 v${root!.adopted!.draftVersion ?? root!.adopted!.version}）`}
          {!projectPlan && <button
            type="button"
            className="qd-link"
            onClick={() => patchWorkspace({ view: "plan", planId: root?.id, itemId: null, scope: "root", mode: "revision", pane: "main" })}
          >
            查看任务影响
          </button>}
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

      <div className="qd-ws-body" data-has-discussion-editor={editingDiscussion && (narrow || collapsed) || undefined}>
        {editingDiscussion && <aside className="qd-direction-conversation" aria-label="和 AI 讨论方案" hidden={!narrow && !collapsed}>
          {pendingSessions.map(session => <section className="qd-direction-pending" aria-label={session.title} key={session.id}>
            <strong>{session.title}</strong>
            <ActivityReply session={session} onOpen={() => openSourceSession(session.id)} />
          </section>)}
          <DirectionReply key={JSON.stringify([snap.project.id, plan.id, ws.scope, plan.discussion?.agentId ?? snap.defaultAgent])}
            plan={plan} scope={ws.scope ?? 'root'} onScope={focusDiscussion} />
        </aside>}
        <main className="qd-ws-main">
          {ws.view === "plan" && plan ? (
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
                    onClick={() => patchWorkspace({ planId: root?.id, itemId: null, scope: "root", mode: "doc" })}
                  >
                    <Icon name="chevron-left" size={14} />
                    {root?.title ?? "上级方案"}
                  </button>
                )}
                <PlanDocView summaryShown={editingDiscussion && (narrow || collapsed) && (ws.scope ?? 'root') === 'root' && documentVersion === 'draft'} retrospective={retrospective} key={plan.id} plan={plan} documentVersion={documentVersion} onDocumentVersion={switchDocument}
                  onDiscussSection={focusDiscussion} />
              </>
            )
          ) : orch && count ? (
            <>{!ws.selected && <TaskHandoffPanel taskId={task.id} />}<TaskScope o={orch} embedded selectedId={ws.selected} onSelect={(id) => patchWorkspace({ selected: id, pane: "side" })} /></>
          ) : (
            <TaskDirectView taskId={task.id} />
          )}
        </main>
        <aside id={direction && !narrow ? 'direction-discussion' : undefined} hidden={direction && (narrow || collapsed)} className="qd-ws-side" aria-label={ws.view === "plan" ? "讨论与版本" : "执行详情"}>
          {ws.view === "plan" && plan ? (
            narrow || (readingHistory && collapsed) ? null : discussion
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
                    {sum.done}/{sum.total} 完成 · {attention.length ? attention.map(item => item.label).join(" · ") : sum.overall.label}
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
      {direction && narrow && <DirectionDiscussionDrawer open={ws.pane === 'side'} onClose={() => patchWorkspace({ pane: 'main' })} trigger={discussionTrigger}>{discussion}</DirectionDiscussionDrawer>}
      {ws.note && <NotePreview taskId={ws.taskId} />}
    </section>
  );
}
