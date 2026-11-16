import { TaskIcon } from "../ui/TaskIcon";
import { useState } from "react";
import { completedResults, executionDrafts, methodFor, workBranch, resultTime, reportMarkdown } from "../../data/results";
import { latestAttempt, WORK_LABEL } from "../../data/orchestration";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { TaskOutputButton } from "../outputs/OutputDialog";
import { AddSubtask, EditOutputButton, OutputAssets } from "../outputs/OutputAssets";
import { TaskMap } from "./TaskMap";
import { ResultMetrics } from "./ResultMetrics";
import { TaskScheduleButton } from "../schedule/TaskScheduleButton";
import "./results.css";

type Pane = "tree" | "method" | "result";

export function ResultsBoard() {
  const { snap, api, workspace: ws, openWorkspace, patchWorkspace, closeWorkspace, openAttemptSource, openSourceSession, toast } = useWorkdeck();
  const [pane, setPane] = useState<Pane>("tree");
  const [opening, setOpening] = useState(false);
  if (!ws) return null;
  const task = snap.tasks[ws.taskId];
  const orchestration = snap.orchestrations?.[ws.taskId];
  const selected = ws.selected ? orchestration?.items[ws.selected] ?? null : null;
  const method = methodFor(snap, ws.taskId, selected);
  const records = completedResults(snap, ws.taskId, selected?.id ?? null);
  const drafts = executionDrafts(snap, ws.taskId, selected?.id ?? null);
  const draftSessions = new Set(drafts.map(draft => draft.sessionId));
  const branch = orchestration ? workBranch(orchestration, selected?.id ?? null) : [];
  const progress = branch.filter(item => item.status !== "done" && item.status !== "cancelled" && !drafts.some(draft => draft.itemId === item.id));
  const standaloneSessions = !orchestration ? (task?.sessionIds ?? []).map(id => snap.sessions[id]).filter(session => session && session.status !== "archived" && !draftSessions.has(session.id)) : [];
  const conclusions = method.conclusions;
  const analyze = async () => {
    if (!task || opening) return;
    setOpening(true);
    try {
      await api.ensureTaskPlan(task.id);
      if (selected) await api.openLocalPlan(task.id, selected.id);
      openWorkspace(task.id, { view: "plan", itemId: selected?.id ?? null, scope: "root", pane: "side", focus: true });
    } catch (error) { toast(error instanceof Error ? error.message : "打开分析失败", "error"); }
    finally { setOpening(false); }
  };
  const exportResult = () => {
    const content = [`# ${selected?.title ?? task?.title ?? "执行结果"}`, ...records.map(record => reportMarkdown(record))].join("\n");
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    link.href = url; link.download = "执行结果.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className={`qd-results pane-${pane}`} aria-label="任务结果看板">
    <header className="qd-results-head">
      <button type="button" className="qd-ws-back" onClick={closeWorkspace}><Icon name="chevron-left" size={16} />返回</button>
      <div><h1 className="qd-task-name">{task && <TaskIcon snapshot={snap} taskId={task.id} workItemId={selected?.id} size={24} />}<span>任务成果</span></h1><p>{snap.project.name}{task ? ` / ${task.title}` : ""}{selected ? ` / ${selected.title}` : ""}</p></div>
      {task && <TaskOutputButton taskId={task.id} itemId={selected?.id} />}
      {task && <TaskScheduleButton taskId={task.id} itemId={selected?.id} compact />}
      {task && <button type="button" className="qd-btn ghost small" disabled={opening} onClick={analyze}>{method.plan ? "继续分析" : "先分析"}<Icon name="arrow-right" size={14} /></button>}
    </header>
    <ResultMetrics snap={snap} taskId={ws.taskId} itemId={selected?.id ?? null} onSelect={itemId => patchWorkspace({ selected: itemId })} />
    <nav className="qd-results-mobile" aria-label="结果看板栏目">
      {([ ["tree", "任务地图"], ["method", "任务方法"], ["result", "执行结果"] ] as [Pane, string][]).map(([key,label]) => <button type="button" key={key} className={pane === key ? "is-on" : ""} aria-pressed={pane === key} onClick={() => setPane(key)}>{label}</button>)}
    </nav>
    <div className="qd-results-columns">
      <section className="qd-results-tree" aria-labelledby="result-tree-title">
        <header className="qd-results-column-head"><h2 id="result-tree-title"><span aria-hidden="true">01</span>任务地图</h2><span>{Object.keys(snap.tasks).length} 主任务</span></header>
        <div className="qd-results-scroll"><TaskMap snap={snap} taskId={ws.taskId} itemId={selected?.id ?? null} onSelect={(taskId, itemId) => openWorkspace(taskId, { view: "results", selected: itemId, focus: true })} />{task && <AddSubtask taskId={task.id} parentId={selected?.id} />}</div>
      </section>
      <section className="qd-results-method" aria-labelledby="result-method-title">
        <header className="qd-results-column-head"><h2 id="result-method-title"><span aria-hidden="true">02</span>任务方法</h2><span>{method.version ? `v${method.version}${method.unavailableVersion ? " · 来源待同步" : method.adopted ? " · 已采用" : " · 草稿"}` : "待分析"}</span></header>
        <div className="qd-results-scroll">
          <p className="qd-result-selected qd-task-name">{task && <TaskIcon snapshot={snap} taskId={task.id} workItemId={selected?.id} size={18} />}<span>{selected?.title ?? task?.title ?? "选择一个任务"}</span></p>
          {method.inherited && <p className="qd-result-meta">沿用主任务的讨论方法</p>}
          {conclusions.map(conclusion => <div className="qd-result-conclusion" key={conclusion.id}><p>{conclusion.summary}</p><small>{snap.agents.find(agent => agent.id === conclusion.agentId)?.name ?? "Agent"} · {conclusion.recordedAt} · 已采用的讨论结论</small></div>)}
          {method.unavailableVersion ? <p className="qd-result-empty">此任务引用的方法 v{method.unavailableVersion} 尚未同步，暂时无法显示。</p> : method.doc?.sections.some(section => section.lines.length) ? method.doc.sections.filter(section => section.lines.length).map(section => <section className="qd-method-section" key={section.id}><h3>{section.title}</h3><ul>{section.lines.map(line => <li key={line.id}><span>{line.text}</span>{line.state !== "fixed" && <small>{line.state === "open" ? "待确定" : "暂定"}</small>}</li>)}</ul></section>) : <div className="qd-result-empty"><Icon name="message" size={22} /><h3>先确定怎么做</h3><p>可以自行整理方法，也可以交给 Agent 分析。</p>{task && <button type="button" className="qd-btn primary small" disabled={opening} onClick={analyze}>先分析</button>}</div>}
          {selected?.expected && <section className="qd-method-section"><h3>预期交付</h3><p>{selected.expected}</p></section>}
          {method.plan && <button type="button" className="qd-link qd-result-method-link" onClick={analyze}>打开方法与讨论结论<Icon name="arrow-right" size={14} /></button>}
        </div>
      </section>
      <section className="qd-results-output" aria-labelledby="result-output-title">
        <header className="qd-results-column-head"><h2 id="result-output-title"><span aria-hidden="true">03</span>执行结果</h2>{records.length > 0 && <button type="button" className="qd-link" onClick={exportResult}>导出结果<Icon name="external" size={14} /></button>}</header>
        <div className="qd-results-scroll" aria-live="polite">
          {records.length > 0 ? records.map(record => <article className="qd-result-report" key={record.id}><div className="qd-result-report-head"><Icon name="check-circle" size={16} /><h3 className="qd-task-name"><TaskIcon snapshot={snap} taskId={ws.taskId} workItemId={record.itemId} size={18} /><span>{record.title}</span></h3></div><p className="qd-result-body">{record.text}</p><OutputAssets report={record} /><footer><span>{record.origin === "human" ? "我 · 人工成果" : snap.agents.find(agent => agent.id === record.agentId)?.name ?? "Agent"} · {resultTime(record.at)}</span>{record.outputId ? <EditOutputButton outputId={record.outputId} /> : <button type="button" className="qd-link" onClick={() => record.attemptId ? openAttemptSource(ws.taskId, record.attemptId) : record.sessionId && openSourceSession(record.sessionId)}>来源<Icon name="external" size={12} /></button>}</footer></article>) : !drafts.length && <div className="qd-result-empty"><Icon name="folder" size={22} /><h3>{selected?.status === "done" || task?.completion ? "等待补充结果" : "还没有完成结果"}</h3><p>{selected?.status === "done" || task?.completion ? "任务已完成，可以补充文字、链接或文件。" : "人工提交与 Agent 回报会自动汇集到这里。"}</p></div>}
          {drafts.length > 0 && <section className="qd-result-progress"><h3>待验收执行稿</h3>{drafts.map(draft => <article key={draft.id}><h4>{draft.title}</h4><p className="qd-result-body">{draft.text}</p><button type="button" className="qd-link" onClick={() => openSourceSession(draft.sessionId!)}>打开本机执行记录<Icon name="external" size={12} /></button></article>)}</section>}
          {progress.length > 0 && <section className="qd-result-progress"><h3>执行动态</h3>{progress.map(item => { const attempt = latestAttempt(orchestration!, item); const round = attempt?.rounds.at(-1); return <article key={item.id}><button type="button" className="qd-link" onClick={() => patchWorkspace({ selected: item.id })}><TaskIcon snapshot={snap} taskId={ws.taskId} workItemId={item.id} size={18} />{item.title}</button><span>{WORK_LABEL[item.status]}</span><p>{item.waiting?.question ?? attempt?.step?.label ?? round?.reply ?? item.statusReason ?? WORK_LABEL[item.status]}</p>{attempt && <button type="button" className="qd-link" onClick={() => openAttemptSource(ws.taskId, attempt.id)}>打开会话<Icon name="external" size={12} /></button>}</article>; })}</section>}
          {standaloneSessions.length > 0 && <section className="qd-result-progress"><h3>执行动态</h3>{standaloneSessions.map(session => <article key={session.id}><p>{session.waitingQuestion ?? session.step?.label ?? session.rounds.at(-1)?.reply ?? "等待回执"}</p><button type="button" className="qd-link" onClick={() => openSourceSession(session.id)}>打开会话<Icon name="external" size={12} /></button></article>)}</section>}
        </div>
      </section>
    </div>
  </section>;
}
