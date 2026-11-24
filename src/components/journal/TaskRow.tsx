import type { TaskCloseout } from '../../data/taskCloseout';
import { AnnotationHistory } from './AnnotationHistory';
import { ActivityReply } from '../deck/ActivityReply';
import { PendingChildren } from './TaskCloseoutRow';
import { TaskProgressTrail } from './TaskProgressTrail';
import './task-input.css';
import { ProgressIndicator } from './RunProgress';
import { TOOL_LABELS } from '../../integration/contracts';
import { taskExecutionPresentation } from '../../data/taskExecutionPresentation';
import { AgentLogo } from '../ui/AgentLogo';
import { TaskInput } from './TaskInput';
import { DeleteWorkButton } from "../projects/DeleteWorkButton";
import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { isWaiting, pendingSessionStatus, sessionView, taskCounts, taskSessions, taskView } from "../../data/derive";
import { formatDuration, formatTokens, span, toMinutes, clockTime } from "../../data/format";
import type { AgentId } from "../../data/types";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { StatusPill } from "../ui/StatusPill";
import { DispatchButton } from "./DispatchButton";
import { InlineSessionRecord } from "./InlineSessionRecord";
import { OrchestrationBlock } from "./OrchestrationBlock";
import { IdeaBlock } from "./IdeaBlock";
import { rootPlanOf } from "../../data/ideaEngine";
import { latestAttempt, orchOf, summarize } from "../../data/orchestration";
import { WorkPill } from "../work/WorkStatus";
import { TaskOutputButton } from "../outputs/OutputDialog";
import { AddSubtask } from "../outputs/OutputAssets";
import { TaskScheduleButton } from "../schedule/TaskScheduleButton";
import { SessionLinkMenu } from './SessionLinkMenu';
import { TaskTitleSummaryButton } from './TaskTitleSummaryButton';
import { requestProductDispatch } from '../deck/ProductExecution';
import { TaskAttachmentsButton } from '../workspace/TaskAttachments';

export function useDispatch() {
  const { snap } = useWorkdeck();
  return async (taskId: string, agentId: AgentId) => { requestProductDispatch({projectId:snap.project.id,taskId,agentId}); };
}

export function TaskRow({ taskId, model }: { taskId: string; model?:TaskCloseout }) {
  const {
    snap,
    api,
    toast,
    registerTaskNode,
    locatedTask,
    drag,
    setDrag,
    linking,
    linkWithFx,
    selectWork,
    scope,
    openWorkspace,
    openTaskDirection,
    openSourceSession,
    agentOf,
  } = useWorkdeck();
  const orch = orchOf(snap, taskId);
  // 有方案的事项：从标题或“查看方案”进入事项工作区
  const idea = rootPlanOf(snap, taskId);
  const task = snap.tasks[taskId];
  const view = taskView(snap, task);
  const counts = taskCounts(snap, task);
  const sessions = taskSessions(snap, task);
  const done = view === "done";
  const execution = taskExecutionPresentation(snap, taskId);
  const latestSession = execution.primarySession;
  const dispatch = useDispatch();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [dropOver, setDropOver] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerTaskNode(taskId, rowRef.current);
    return () => registerTaskNode(taskId, null);
  }, [taskId, registerTaskNode]);

  useEffect(() => setDraft(task.title), [task.title]);

  const ledgerTask = snap.collaboration?.tasks[taskId];
  const starting = view === 'todo' && !sessions.length && (!orch || !Object.keys(orch.items).length) && !idea?.adopted
    && (!ledgerTask || (['draft', 'ready'].includes(ledgerTask.status) && !ledgerTask.requiresRevalidation && !ledgerTask.latestSubmissionId));
  const returned = model?.root.returned
    ? snap.collaboration?.artifacts.find(a => a.id === model.root.artifactId)
    : undefined;
  const working = execution.rows.find(row => row.progress?.state === 'flowing');
  const currentProgress = working?.progress;
  const workingSession = working?.sessionId ? snap.sessions[working.sessionId] : undefined;
  const tool = workingSession?.source?.tool ?? workingSession?.runtime?.connection.tool;
  const workingAgent = snap.agents.find(agent=>agent.id===working?.agentId)?.name ?? (tool ? TOOL_LABELS[tool] : 'Agent');
  const stage = currentProgress?.stage === working?.title ? '' : currentProgress?.stage;
  const waitingSession = execution.rows.map(row => row.sessionId && snap.sessions[row.sessionId])
    .find(session => session && session.runtime?.runId && isWaiting(sessionView(session)) && pendingSessionStatus(session));
  const [replyOpen,setReplyOpen] = useState(false);
  const waitingKind = waitingSession ? pendingSessionStatus(waitingSession) : undefined;
  const automation = idea && snap.collaboration?.goalAutomation?.[idea.id];
  const autoReady = !!automation?.enabled && automation.draftVersion === idea?.draftVersion;
  const canEditTitle = !done;
  const activeSessions = sessions.filter((s) => s.status !== "archived");
  const ordered = [...activeSessions, ...sessions.filter((s) => s.status === "archived")].filter(
    // 有编排的主任务：主会话由执行摘要呈现，其余关联会话照常显示
    (s) => execution.hasChildActivity || !orch || s.id !== orch.mainSessionId,
  );
  const orchSum = orch ? summarize(snap, orch) : null;
  const hasChildren = !!orchSum?.total;
  const pausedChild = orch && orchSum?.overall.status === 'paused' && !execution.attention.length
    ? Object.values(orch.items).find(item => item.status === 'paused')
    : undefined;
  const pausedAttempt = orch && pausedChild ? latestAttempt(orch, pausedChild) : null;
  const pausedSession = pausedAttempt?.sessionId ? snap.sessions[pausedAttempt.sessionId] : undefined;
  const canResume = pausedSession?.status === 'paused' && (pausedSession.runtime || pausedSession.source);
  const inspectChildren = () => openWorkspace(taskId, {
    view: 'tasks', selected: pausedChild?.id || null, pane: pausedChild ? 'side' : 'main', focus: true,
  });


  // 完成后汇总：起止、总经过时间、token、完成原因
  const starts = sessions.map((s) => s.startedAt).filter(Boolean) as string[];
  const ends = sessions.map((s) => s.endedAt).filter(Boolean) as string[];
  const timeOrder = (value: string) => /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : toMinutes(value) * 60000;
  const first = starts.length ? [...starts].sort((a, b) => timeOrder(a) - timeOrder(b))[0] : null;
  const last = ends.length ? [...ends].sort((a, b) => timeOrder(b) - timeOrder(a))[0] : null;
  const tokenValues = sessions.map((s) => s.tokens);
  const totalTokens = tokenValues.some((t) => t == null)
    ? null
    : tokenValues.reduce<number>((a, b) => a + (b ?? 0), 0);

  const saveTitle = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== task.title) api.updateTaskTitle(taskId, t);
    else setDraft(task.title);
  };

  const reopen = async () => {
    try {
      await api.reopenTask(taskId);
      toast("已重新打开");
    } catch (error) {
      toast(error instanceof Error ? error.message : "暂时无法重新打开任务，请重试", "error");
    }
  };

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "copyLink";
    e.dataTransfer.setData("text/plain", `quandeck-task:${taskId}`);
    if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 24, 20);
    setDrag({ type: "task", taskId });
  };

  const acceptsSession = drag?.type === "session" && !done;
  const draggedArchived =
    drag?.type === "session" && snap.sessions[drag.sessionId]?.status === "archived";
  // 只关联了归档历史、尚无进行中会话：任务保持未完成，由用户决定
  const merging = Object.values(linking).includes(taskId);
  const historyOnly =
    !done && !task.manualLock && sessions.length > 0 && activeSessions.length === 0;

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      data-task={taskId}
      className={`qd-task qd-task-compact ${starting ? "is-task-start" : ""} view-${view} ${locatedTask === taskId ? "is-located" : ""} ${dropOver ? "is-drop" : ""} ${
        acceptsSession ? "accepts-drop" : ""
      }`}
      onDragOver={(e) => {
        if (!acceptsSession) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "link";
        setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false);
      }}
      onDrop={async (e) => {
        if (drag?.type !== "session") return;
        e.preventDefault();
        setDropOver(false);
        setDrag(null);
        // 与“合并到待办”菜单共用同一关联与动效流程
        await linkWithFx(drag.sessionId, taskId);
      }}
    >
      <div className="qd-task-line">
        {!done ? (
          <span
            className="qd-grip"
            draggable
            onDragStart={onDragStart}
            onDragEnd={() => setDrag(null)}
            title="拖到右侧 Agent 委派"
            aria-hidden="true"
          >
            <Icon name="grip" size={16} />
          </span>
        ) : (
          <span className="qd-grip is-placeholder" aria-hidden="true" />
        )}
        <div className="qd-task-main">
          <div className="qd-task-head">
            <TaskIcon snapshot={snap} taskId={taskId} size={20} />
            {editing ? (
              <input
                className="qd-title-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setDraft(task.title);
                    setEditing(false);
                  }
                }}
                aria-label="编辑任务"
              />
            ) : (
              <h3 className="qd-task-title is-scope-link" title={task.title}>
                <button type="button" className="qd-task-detail-link" aria-label={`查看任务详情：${task.title}`} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(v=>!v)}>{task.title}</button>
              </h3>
            )}
            {task.estimate != null && <span className="qd-estimate">{task.estimate}m</span>}
            {model?.root.returned && <span className="qd-pill tone-wait">待修改</span>}
            {!model?.root.returned && idea && !done && orchSum && orchSum.total === 0 && (
              <span className="qd-pill tone-muted">
                <Icon name="message" size={12} className="qd-pill-icon" />
                方案整理
              </span>
            )}
            {!model?.root.returned && orchSum && !done && orchSum.total > 0 && (
              <WorkPill status={execution.attention[0]?.state ?? orchSum.overall.status} label={execution.attention.length ? execution.attention.map(item => item.label).join(" · ") : orchSum.overall.label} />
            )}
            {!model?.root.returned && !orchSum && view !== "todo" && sessions.length <= 1 && <StatusPill view={view} />}
            {!model?.root.returned && !orchSum && sessions.length > 1 && (
              <StatusPill
                view={view}
                label={
                  done
                    ? undefined
                    : [
                        counts.waiting && `${counts.waiting} 项等你`,
                        counts.running && `${counts.running} 项在跑`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                }
              />
            )}
          </div>
        </div>
        <div className="qd-task-actions">
          {returned && <TaskOutputButton taskId={taskId} revision={returned} />}
          {starting && <button type="button" className="qd-btn primary qd-start-discuss" onClick={() => void openTaskDirection(taskId, null, true)}><Icon name="message" size={15}/>{idea?.discussion?.sessionId ? '继续讨论方案' : '讨论方案'}</button>}
          {!returned && waitingSession && <button type="button" className="qd-btn primary" aria-expanded={replyOpen} onClick={()=>setReplyOpen(v=>!v)}>{replyOpen ? '收起' : waitingKind==='waiting_permission' ? '处理授权' : '回答问题'}</button>}
          {!waitingSession && !returned && hasChildren && <button type="button" className="qd-btn ghost" onClick={() => canResume ? openSourceSession(pausedSession.id) : inspectChildren()}>{canResume ? '回到原会话' : '查看子任务'}<Icon name="arrow-right" size={14}/></button>}
          {!waitingSession && !starting && !hasChildren && !returned && (latestSession && !['archived', 'cancelled'].includes(latestSession.status)
            ? <button type="button" className="qd-btn ghost" onClick={() => openSourceSession(latestSession.id)}>查看会话<Icon name="arrow-right" size={14}/></button>
            : idea && <button type="button" className="qd-btn ghost" onClick={() => void openTaskDirection(taskId)}>查看方案</button>)}
          {!done && !returned && !hasChildren && !idea && (view === "todo" || (!isWaiting(view) && sessions.length === 0)) && (
            <DispatchButton showLabel={starting} label={task.title} onDispatch={(agentId) => dispatch(taskId, agentId)} />
          )}
        </div>
      </div>
      <div className="qd-task-body">
        {waitingSession && replyOpen && <ActivityReply key={waitingSession.runtime?.runId || waitingSession.id} session={waitingSession} onOpen={()=>openSourceSession(waitingSession.id)}/>}
        {working && <p className="qd-row-current"><strong>{workingAgent}</strong> {currentProgress?.label}{working.title !== task.title ? ' · '+working.title : ''}</p>}
        {!working && !waitingSession && !hasChildren && autoReady && !latestSession && <p className="qd-row-current">方向已确认，等待自动执行</p>}
        {model && <>{(model.root.returned || model.root.summary !== task.title && !hasChildren) && <p className="qd-closeout-summary">{model.root.returned ? model.root.reviewNote || model.root.summary : model.root.summary}</p>}<PendingChildren taskId={taskId} children={model.children}/></>}
        {(stage || currentProgress?.amount) && <p className="qd-task-subtask-status">{[stage,currentProgress?.amount].filter(Boolean).join(' · ')}</p>}
        {hasChildren && <p className="qd-task-subtask-status">
          <span>{orchSum.done}/{orchSum.total} 项子任务完成</span>
          {pausedChild && <span>{pausedChild.title} · 已暂停</span>}
          {orchSum.blocked > 0 && <span>{orchSum.blocked} 项等待前置</span>}
        </p>}
        <AnnotationHistory taskId={taskId}/>
        <div className="qd-task-disclosure">
        <details className="qd-task-secondary" open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}>
          <summary>{starting ? '任务详情' : '任务详情与记录'}</summary>
          <TaskInput taskId={taskId} />
        {detailsOpen && !starting && !hasChildren && <TaskProgressTrail snapshot={snap} scope={{ taskId }} compact />}
        {detailsOpen && !done && execution.rows.length > 0 && <div className="qd-task-execution" aria-label="任务执行进度">
          {execution.rows.map(row => <div key={row.id}>
            <div className="qd-task-execution-agent">{row.agentId && <><AgentLogo agent={agentOf(row.agentId)} size={16}/><span>{agentOf(row.agentId).name}</span></>}{execution.hasChildActivity && <span className="qd-task-execution-title" title={row.title}>{row.entry?.itemId || row.entry?.subAgentId ? '子任务' : '主任务'} · {row.title}</span>}
              {execution.hasChildActivity && row.sessionId && snap.sessions[row.sessionId] && <button type="button" className="qd-text-btn" aria-label={`打开 ${row.title} 的执行会话`} onClick={() => openSourceSession(row.sessionId!)}>查看会话 ↗</button>}
            </div>
            <ProgressIndicator progress={row.progress} agentName={row.agentId ? agentOf(row.agentId).name : 'Agent'} color={row.agentId ? agentOf(row.agentId).color : '#68717b'}/>
          </div>)}
        </div>}

      {detailsOpen && orch && hasChildren && (
        <div className={`qd-records ${scope?.taskId === taskId ? "is-in-scope" : ""}`}>
          <OrchestrationBlock o={orch} />
        </div>
      )}

          <TaskTitleSummaryButton snapshot={snap} taskId={taskId}/>
          {model && <dl className="qd-task-facts"><dt>任务要求</dt><dd>{model.root.goal}</dd>
            {model.root.criteria.length>0 && <><dt>验收条件</dt><dd>{model.root.criteria.join('；')}</dd></>}
            {model.root.reviewNote && <><dt>最近验收意见</dt><dd>{model.root.reviewNote}</dd></>}</dl>}
          <div className="qd-manual-tools">
            {canEditTitle && !editing && <button type="button" className="qd-link" onClick={() => setEditing(true)}>编辑标题</button>}
            {!starting && <button type="button" className="qd-link" onClick={() => void openTaskDirection(taskId)}>方向方案</button>}
            <button type="button" className="qd-link" onClick={() => openWorkspace(taskId, {view:"results",focus:true})}>成果地图</button>
            {latestSession && <button type="button" className="qd-link" onClick={() => openSourceSession(latestSession.id)}>打开会话</button>}
            <TaskScheduleButton taskId={taskId} compact />
            <DeleteWorkButton projectId={snap.project.id} taskId={taskId} title={task.title} />
          </div>

      {(task.originalTitle || Array.from(task.title).length > 40) && <details className="qd-task-original"><summary>查看完整任务内容</summary><p>{task.originalTitle ?? task.title}</p></details>}
      <div className="qd-manual-tools"><TaskAttachmentsButton taskId={taskId}/><label>完成方式 <select aria-label={`完成方式：${task.title}`} value={task.owner ?? "me"} onChange={event => void api.setTaskOwner(taskId, event.target.value as "me" | "agent").catch(error => toast(error.message, "error"))}><option value="me">我来完成</option><option value="agent">交给 Agent</option></select></label><AddSubtask taskId={taskId} /><SessionLinkMenu taskId={taskId} /></div>
      {!!task.sessionHistory?.length && <details className="qd-meta-soft"><summary>已改绑会话 · {task.sessionHistory.length}</summary>{task.sessionHistory.map(history => <div key={`${history.sessionId}:${history.at}`}><strong>{history.title}</strong><p>{history.rounds.at(-1)?.reply ?? '当时尚无最终回复'}</p><small>已移到 {snap.tasks[history.transferredToTaskId]?.title ?? '其他任务'}</small></div>)}</details>}


      {idea && (
        <div className="qd-records">
          <IdeaBlock taskId={taskId} methodOnly={!!orch && Object.keys(orch.items).length > 0} />
        </div>
      )}


      {ordered.length > 0 && (
        <div className="qd-records">
          {execution.hasChildActivity && <p className="qd-task-parent-history-label">主任务会话与历史记录</p>}
          {ordered.map((s) => (
            <InlineSessionRecord
              key={s.id}
              session={s}
              showStatus={execution.hasChildActivity || sessions.length > 1}
              taskDone={done}
            />
          ))}
        </div>
      )}

      {done && (
        <div className="qd-completion">
          <span>
            {sessions.length > 1 && (
              <>
                {first && last
                  ? `${clockTime(first, snap.project.timeZone)}—${clockTime(last, snap.project.timeZone)} · 共 ${formatDuration(span(first, last))}`
                  : "起止未提供"}
                {" · "}
                {formatTokens(totalTokens)}
                {" · "}
              </>
            )}
            {task.completion?.reason === "all_archived"
              ? "全部关联会话已归档"
              : `${clockTime(task.completion?.at, snap.project.timeZone)} 手动完成`}
          </span>
          <button type="button" className="qd-link" onClick={() => void reopen()}>
            <Icon name="undo" size={13} />
            重新打开
          </button>
        </div>
      )}
      {historyOnly && (
        <div className="qd-completion is-soft">
          <span>{sessions.length} 条历史记录</span>
        </div>
      )}
      {task.manualLock &&
        !done &&
        sessions.length > 0 &&
        sessions.every((s) => s.status === "archived") && (
          <div className="qd-completion is-soft">
            <span>会话均已归档</span>
            <button type="button" className="qd-link" onClick={async () => {
              try { await api.resumeAutoFollow(taskId); }
              catch (error) { toast(error instanceof Error ? error.message : "暂时无法恢复自动跟随，请重试", "error"); }
            }}>
              恢复自动跟随
            </button>
          </div>
        )}

        </details>
        {!returned && !done && (starting || detailsOpen) && <div className="qd-secondary-submission"><TaskOutputButton taskId={taskId} compact /></div>}
        </div>
      </div>
      {(dropOver || merging) && (
        <div className="qd-drop-hint" aria-live="polite">
          <Icon name="merge" size={15} />
          {merging
            ? "正在关联…"
            : draggedArchived
              ? "关联为历史"
              : "松手关联到此待办"}
        </div>
      )}
    </div>
  );
}
