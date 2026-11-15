import { useState } from "react";
import { completedResults, methodFor, taskOverviewRows, type ResultRecord } from "../../data/results";
import { summarize, topItems, WORK_LABEL } from "../../data/orchestration";
import { VIEW_LABEL } from "../../data/derive";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import "./results-gallery.css";

type Filter = "all" | "ready" | "pending";

/** A folio is a main task, its adopted method, and completed execution reports. */
export function ResultsGallery({ onNew }: { onNew?: () => void }) {
  const { snap, openWorkspace, openAttemptSource, openSourceSession } = useWorkdeck();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const rows = taskOverviewRows(snap).map(row => ({ ...row, records: completedResults(snap, row.task.id, null) }));
  const ready = rows.filter(row => row.records.length > 0);
  const visible = rows.filter(row => filter === "all" || (filter === "ready" ? row.records.length > 0 : row.records.length === 0));
  const active = visible.find(row => row.task.id === selectedTask) ?? visible.find(row => row.records.length > 0) ?? visible[0];
  const records = active?.records ?? [];
  const report = records.find(record => record.id === selectedReport) ?? records.at(-1);
  const method = active ? methodFor(snap, active.task.id, null) : null;
  const methodLines = method?.doc?.sections.flatMap(section => section.lines).filter(line => line.state === "fixed") ?? [];
  const methodSummary = method?.conclusions.at(-1)?.summary ?? methodLines[0]?.text;
  const orchestration = active && snap.orchestrations?.[active.task.id];
  const summary = orchestration ? summarize(snap, orchestration) : null;
  const children = orchestration ? topItems(orchestration) : [];
  const open = (itemId: string | null = null) => active && openWorkspace(active.task.id, { view: "results", selected: itemId, focus: true });
  const source = () => {
    if (!active || !report) return;
    if (report.attemptId) openAttemptSource(active.task.id, report.attemptId);
    else if (report.sessionId) openSourceSession(report.sessionId);
  };
  const select = (taskId: string) => { setSelectedTask(taskId); setSelectedReport(null); };
  return <main className="qd-gallery" aria-labelledby="gallery-title">
    <div className="qd-gallery-inner">
      <header className="qd-gallery-head">
        <div><p>{snap.project.name} <span aria-hidden="true">/</span> 成果空间</p><h1 id="gallery-title">成果</h1></div>
        <div className="qd-gallery-total"><strong>{rows.reduce((sum, row) => sum + row.records.length, 0)}</strong><span>份结果记录</span></div>
      </header>
      <nav className="qd-gallery-filters" aria-label="筛选成果册">
        {([ ["all", "全部任务", rows.length], ["ready", "已有成果", ready.length], ["pending", "待产出", rows.length - ready.length] ] as [Filter, string, number][]).map(([key, label, count]) => <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? "is-on" : ""} onClick={() => { setFilter(key); setSelectedReport(null); }}>{label}<span>{count}</span></button>)}
      </nav>
      {active ? <>
        <div className="qd-folio-shelf" aria-label="选择主任务">
          {visible.map((row, index) => <button type="button" className={`qd-folio-tab ${row.task.id === active.task.id ? "is-on" : ""}`} key={row.task.id} aria-pressed={row.task.id === active.task.id} onClick={() => select(row.task.id)}>
            <span className="qd-folio-index">{String(index + 1).padStart(2, "0")}</span>
            <strong>{row.task.title}</strong>
            <span className="qd-folio-tab-meta">{row.records.length ? `${row.records.length} 份结果` : "等待产出"}<Icon name="arrow-right" size={14} /></span>
          </button>)}
        </div>
        <section className="qd-folio" aria-labelledby="folio-title">
          <div className="qd-folio-context">
            <p className="qd-folio-kicker"><Icon name="folder" size={14} />主任务<span className={active.waiting ? "has-wait" : ""}>{active.waiting ? "等我处理" : WORK_LABEL[active.status as keyof typeof WORK_LABEL] ?? VIEW_LABEL[active.status as keyof typeof VIEW_LABEL]}</span></p>
            <h2 id="folio-title">{active.task.title}</h2>
            <div className="qd-folio-map">
              <section><span className="qd-folio-node" aria-hidden="true">01</span><h3>任务树</h3>
                {summary && children.length ? <><p>{summary.done}<span> / {summary.total} 一级子任务完成</span></p><div className="qd-folio-branches" aria-label={`一级子任务 ${summary.done}/${summary.total} 完成`}>{children.map(item => <button type="button" key={item.id} className={`is-${item.status}`} aria-label={`${item.title}，${WORK_LABEL[item.status]}`} title={`${item.title} · ${WORK_LABEL[item.status]}`} onClick={() => open(item.id)} />)}</div></> : <p className="qd-folio-description">{active.task.completion ? "主任务已完成" : "尚未拆分子任务"}</p>}
              </section>
              <section><span className="qd-folio-node" aria-hidden="true">02</span><h3>方法概要{method?.version && <small>v{method.version} · {method.adopted ? "已采用" : "草稿"}</small>}</h3><p className="qd-folio-description">{method?.unavailableVersion ? "等待同步此任务的方法" : methodSummary ?? "尚未整理方法"}</p></section>
              <section><span className={`qd-folio-node ${records.length ? "has-result" : ""}`} aria-hidden="true">03</span><h3>执行结果</h3><p className="qd-folio-description">{records.length ? `${records.length} 份结果已汇集` : active.running ? "任务执行中，等待首份结果" : "完成任务后在这里汇集"}</p></section>
            </div>
            <button type="button" className="qd-folio-open" onClick={() => open()}>打开完整看板<Icon name="arrow-right" size={16} /></button>
          </div>
          <div className="qd-folio-stage">
            {report ? <>
              <div className="qd-folio-stage-head"><span>结果预览</span><span>{records.indexOf(report) + 1} / {records.length}</span></div>
              <ResultSheet report={report} agentName={snap.agents.find(agent => agent.id === report.agentId)?.name} onSource={source} onDetail={() => open(report.itemId ?? null)} />
              {records.length > 1 && <nav className="qd-folio-pages" aria-label="选择结果记录">{records.map((record, index) => <button type="button" key={record.id} className={record.id === report.id ? "is-on" : ""} aria-pressed={record.id === report.id} onClick={() => setSelectedReport(record.id)}><span>{String(index + 1).padStart(2, "0")}</span>{record.title}</button>)}</nav>}
            </> : <div className="qd-folio-empty"><Icon name="inbox" size={32} /><h3>等待产出</h3><p>{active.running ? "执行完成的记录会出现在这里。" : "从任务的方法与执行开始。"}</p><button type="button" className="qd-link" onClick={() => open()}>查看任务<Icon name="arrow-right" size={15} /></button></div>}
          </div>
        </section>
      </> : <div className="qd-gallery-empty"><Icon name="folder" size={30} /><h2>{rows.length ? "还没有这类成果册" : "从第一件事开始"}</h2><p>{rows.length ? "换个筛选，查看其他任务。" : "记录任务，方法和成果会汇集在这里。"}</p>{rows.length ? <button type="button" className="qd-btn ghost" onClick={() => setFilter("all")}>查看全部任务</button> : onNew && <button type="button" className="qd-btn primary" onClick={onNew}>记录任务</button>}</div>}
    </div>
  </main>;
}

function ResultSheet({ report, agentName, onSource, onDetail }: { report: ResultRecord; agentName?: string; onSource: () => void; onDetail: () => void }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([`# ${report.title}\n\n${report.text}\n\n${agentName ?? "执行记录"} · ${report.at}\n`], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${report.title.replace(/[\\/:*?"<>|]/g, "_")}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <article className="qd-result-sheet" aria-label={`结果预览：${report.title}`}>
    <div className="qd-result-sheet-meta"><span><Icon name="check-circle" size={14} />已完成的执行记录</span><time>{report.at}</time></div>
    <h3>{report.title}</h3>
    <p>{report.text}</p>
    <footer><span>{agentName ?? "执行记录"}</span><button type="button" className="qd-link" onClick={onSource}>来源会话<Icon name="external" size={13} /></button></footer>
    <div className="qd-result-sheet-actions"><button type="button" onClick={onDetail}>任务与方法<Icon name="arrow-right" size={14} /></button><button type="button" onClick={download}>导出 Markdown<Icon name="external" size={14} /></button></div>
  </article>;
}
