import { TaskIcon } from "../ui/TaskIcon";
import { useState } from "react";
import { completedResults, methodFor, taskOverviewRows, resultTime, reportMarkdown, resultComposition, type ResultRecord } from "../../data/results";
import { summarize, topItems, WORK_LABEL } from "../../data/orchestration";
import { VIEW_LABEL } from "../../data/derive";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { TaskOutputButton } from "../outputs/OutputDialog";
import { EditOutputButton, OutputAssets } from "../outputs/OutputAssets";
import { Icon } from "../ui/Icon";
import "./results-gallery.css";
import { ResultsIntegration } from "./ResultsIntegration";
import { TaskMemoryLookup } from "./TaskMemoryLookup";

type Filter = "all" | "ready" | "pending";

/** A folio is a main task, its adopted method, and completed execution reports. */
export function ResultsGallery({ onNew }: { onNew?: () => void }) {
  const { snap, openWorkspace, openAttemptSource, openSourceSession } = useWorkdeck();
  const [section, setSection] = useState<"tasks" | "integrated">("tasks");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const rows = taskOverviewRows(snap).map(row => ({ ...row, records: completedResults(snap, row.task.id, null) }));
  const composition = resultComposition(rows.flatMap(row => row.records));
  const drafts = Object.values(snap.outputs ?? {}).filter(output => output.status === "draft");
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
      <TaskMemoryLookup key={snap.project.id} />
      <nav className="qd-results-sections" aria-label="成果内容"><button type="button" aria-pressed={section === 'tasks'} onClick={() => setSection('tasks')}>任务记录</button><button type="button" aria-pressed={section === 'integrated'} onClick={() => setSection('integrated')}><Icon name="merge" size={14} />完整成果{Object.keys(snap.integration?.bundles ?? {}).length > 0 && <span>{Object.keys(snap.integration?.bundles ?? {}).length}</span>}</button></nav>
      <div hidden={section !== 'integrated'}><ResultsIntegration key={snap.project.id} /></div><div className="qd-gallery-task-content" hidden={section !== 'tasks'}>
      <section className="qd-output-overview" aria-label="成果自动归纳">
        <div className="qd-output-contributors"><div className="qd-output-contribution-ring" role="img" aria-label={`人工 ${composition.human} 份，Agent ${composition.agent} 份`}><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /><circle cx="50" cy="50" r="40" pathLength="100" strokeDasharray={`${composition.total ? composition.human / composition.total * 100 : 0} 100`} /></svg><strong>{composition.total}<small>份成果</small></strong></div><div><h2>一起完成的事</h2><p><i />人工 <b>{composition.human}</b><i className="is-agent" />Agent <b>{composition.agent}</b></p></div></div>
        <div className="qd-output-formats"><h2>成果构成</h2>{([['文字记录',composition.text],['参考链接',composition.links],['交付文件',composition.files]] as [string,number][]).map(([label,value]) => <div key={label}><span>{label}</span><i><b style={{width:`${value / Math.max(1,composition.text,composition.links,composition.files) * 100}%`}} /></i><strong>{value}</strong></div>)}</div>
        <div className="qd-output-coverage"><h2>产出覆盖</h2><strong>{ready.length}<span> / {rows.length}</span></strong><p>个任务已有成果</p><div aria-label={`${ready.length}/${rows.length} 个任务已有成果`}>{rows.map(row => <button key={row.task.id} type="button" className={row.records.length ? 'has-output' : ''} title={`${row.task.title} · ${row.records.length} 份成果`} aria-label={`查看 ${row.task.title} 的成果`} onClick={() => {setFilter('all');select(row.task.id);}} />)}</div></div>
      </section>
      {drafts.length > 0 && <details className="qd-output-drafts"><summary>待提交草稿 · {drafts.length}</summary>{drafts.map(output => <div key={output.id}><span>{output.title}</span><EditOutputButton outputId={output.id} /></div>)}</details>}
      <nav className="qd-gallery-filters" aria-label="筛选成果册">
        {([ ["all", "全部任务", rows.length], ["ready", "已有成果", ready.length], ["pending", "待产出", rows.length - ready.length] ] as [Filter, string, number][]).map(([key, label, count]) => <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? "is-on" : ""} onClick={() => { setFilter(key); setSelectedReport(null); }}>{label}<span>{count}</span></button>)}
      </nav>
      {active ? <>
        <div className="qd-folio-shelf" aria-label="选择主任务">
          {visible.map((row, index) => <button type="button" className={`qd-folio-tab ${row.task.id === active.task.id ? "is-on" : ""}`} key={row.task.id} aria-pressed={row.task.id === active.task.id} onClick={() => select(row.task.id)}>
            <span className="qd-folio-index"><TaskIcon snapshot={snap} taskId={row.task.id} size={22} /></span>
            <strong>{row.task.title}</strong>
            <span className="qd-folio-tab-meta">{row.records.length ? `${row.records.length} 份结果` : "等待产出"}<Icon name="arrow-right" size={14} /></span>
          </button>)}
        </div>
        <section className="qd-folio" aria-labelledby="folio-title">
          <div className="qd-folio-context">
            <p className="qd-folio-kicker"><TaskIcon snapshot={snap} taskId={active.task.id} size={20} />主任务<span className={active.waiting ? "has-wait" : ""}>{active.waiting ? "等我处理" : WORK_LABEL[active.status as keyof typeof WORK_LABEL] ?? VIEW_LABEL[active.status as keyof typeof VIEW_LABEL]}</span></p>
            <h2 id="folio-title">{active.task.title}</h2>
            <div className="qd-folio-map">
              <section><span className="qd-folio-node" aria-hidden="true">01</span><h3>任务树</h3>
                {summary && children.length ? <><p>{summary.done}<span> / {summary.total} 一级子任务完成</span></p><div className="qd-folio-branches" aria-label={`一级子任务 ${summary.done}/${summary.total} 完成`}>{children.map(item => <button type="button" key={item.id} className={`is-${item.status}`} aria-label={`${item.title}，${WORK_LABEL[item.status]}`} title={`${item.title} · ${WORK_LABEL[item.status]}`} onClick={() => open(item.id)} />)}</div></> : <p className="qd-folio-description">{active.task.completion ? "主任务已完成" : "尚未拆分子任务"}</p>}
              </section>
              <section><span className="qd-folio-node" aria-hidden="true">02</span><h3>方法概要{method?.version && <small>v{method.version} · {method.adopted ? "已采用" : "草稿"}</small>}</h3><p className="qd-folio-description">{method?.unavailableVersion ? "等待同步此任务的方法" : methodSummary ?? "尚未整理方法"}</p></section>
              <section><span className={`qd-folio-node ${records.length ? "has-result" : ""}`} aria-hidden="true">03</span><h3>执行结果</h3><p className="qd-folio-description">{records.length ? `${records.length} 份结果已汇集` : active.running ? "任务执行中，等待首份结果" : "完成任务后在这里汇集"}</p></section>
            </div>
            <TaskOutputButton taskId={active.task.id} /><button type="button" className="qd-folio-open" onClick={() => open()}>打开完整看板<Icon name="arrow-right" size={16} /></button>
          </div>
          <div className="qd-folio-stage">
            {report ? <>
              <div className="qd-folio-stage-head"><span>结果预览</span><span>{records.indexOf(report) + 1} / {records.length}</span></div>
              <ResultSheet taskId={active.task.id} report={report} agentName={snap.agents.find(agent => agent.id === report.agentId)?.name} onSource={source} onDetail={() => open(report.itemId ?? null)} />
              {records.length > 1 && <nav className="qd-folio-pages" aria-label="选择结果记录">{records.map((record, index) => <button type="button" key={record.id} className={record.id === report.id ? "is-on" : ""} aria-pressed={record.id === report.id} onClick={() => setSelectedReport(record.id)}><span>{String(index + 1).padStart(2, "0")}</span>{record.title}</button>)}</nav>}
            </> : <div className="qd-folio-empty"><Icon name="inbox" size={32} /><h3>等待产出</h3><p>{active.running ? "执行完成的记录会出现在这里。" : "从任务的方法与执行开始。"}</p><button type="button" className="qd-link" onClick={() => open()}>查看任务<Icon name="arrow-right" size={15} /></button></div>}
          </div>
        </section>
      </> : <div className="qd-gallery-empty"><Icon name="folder" size={30} /><h2>{rows.length ? "还没有这类成果册" : "从第一件事开始"}</h2><p>{rows.length ? "换个筛选，查看其他任务。" : "记录任务，方法和成果会汇集在这里。"}</p>{rows.length ? <button type="button" className="qd-btn ghost" onClick={() => setFilter("all")}>查看全部任务</button> : onNew && <button type="button" className="qd-btn primary" onClick={onNew}>记录任务</button>}</div>}
      </div>
    </div>
  </main>;
}

function ResultSheet({ taskId, report, agentName, onSource, onDetail }: { taskId: string; report: ResultRecord; agentName?: string; onSource: () => void; onDetail: () => void }) {
  const { snap } = useWorkdeck();
  const download = () => {
    const url = URL.createObjectURL(new Blob([reportMarkdown(report)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${report.title.replace(/[\\/:*?"<>|]/g, "_")}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <article className="qd-result-sheet" aria-label={`结果预览：${report.title}`}>
    <div className="qd-result-sheet-meta"><span><Icon name="check-circle" size={14} />{report.origin === "human" ? "人工成果" : "Agent 回报"}</span><time>{resultTime(report.at)}</time></div>
    <h3 className="qd-task-name"><TaskIcon snapshot={snap} taskId={taskId} workItemId={report.itemId} size={20} /><span>{report.title}</span></h3>
    <p>{report.text}</p><OutputAssets report={report} />
    <footer><span>{report.origin === "human" ? "我" : agentName ?? "Agent"}</span>{report.outputId ? <EditOutputButton outputId={report.outputId} /> : <button type="button" className="qd-link" onClick={onSource}>来源会话<Icon name="external" size={13} /></button>}</footer>
    <div className="qd-result-sheet-actions"><button type="button" onClick={onDetail}>任务与方法<Icon name="arrow-right" size={14} /></button><button type="button" onClick={download}>导出 Markdown<Icon name="external" size={14} /></button></div>
  </article>;
}
