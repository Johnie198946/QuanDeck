import { DeleteWorkButton } from "../projects/DeleteWorkButton";
import { TaskIcon } from "../ui/TaskIcon";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { dashboardLanes, dashboardOverview, OVERVIEW_LABELS } from "../../data/dashboard";
import type { OverviewBucket } from "../../data/dashboard";
import { portfolioOverview, matchesProjectFilter } from "../../data/portfolio";
import type { ProjectFilter } from "../../data/portfolio";
import { completedResults } from "../../data/results";
import { WORK_LABEL } from "../../data/orchestration";
import { formatDuration } from "../../data/format";
import { dayBounds, instant, timelinePlanTotals, visibleIntervals } from "../../data/timeline";
import type { Snapshot } from "../../data/types";
import { Icon } from "../ui/Icon";
import "./dashboard.css";

const BUCKETS: OverviewBucket[] = ["running", "attention", "pending", "done", "cancelled"];
const tint = (color: string) => ({ "--dash-tint": color } as CSSProperties);

function DayActivity({ snap, onLocate, onSchedule }: { snap: Snapshot; onLocate: (taskId: string, itemId?: string) => void; onSchedule: () => void }) {
  const intervals = visibleIntervals(snap);
  const agents = snap.agents.filter(agent => intervals.some(interval => interval.agentId === agent.id));
  const totals = timelinePlanTotals(snap);
  const [start, end] = dayBounds(snap.date, snap.project.timeZone);
  const position = (ms: number) => Math.max(0, Math.min(100, (ms - start) / (end - start) * 100));
  const now = position(Date.parse(snap.timeline?.asOf ?? instant(snap.now, snap.date, snap.project.timeZone)));
  const plans = dashboardLanes(snap.plans.map(plan => {
    const from = Date.parse(instant(plan.start, snap.date, snap.project.timeZone));
    return { plan, from: position(from), to: position(from + plan.minutes * 60000) };
  }).filter(plan => plan.to > plan.from));
  return <section className="qd-day-chart" aria-labelledby="day-chart-title">
    <header className="qd-dash-section-head"><h2 id="day-chart-title">一天的节奏</h2><button type="button" onClick={onSchedule}>日程 <Icon name="arrow-right" size={14} /></button></header>
    <div className="qd-day-totals"><span><small>计划</small><strong>{formatDuration(totals.planned)}</strong></span><span title="实际时间合并了并行时段"><small>实际</small><strong>{formatDuration(totals.actual)}</strong></span><span className="qd-day-now">截至 {snap.now}</span></div>
    <div className="qd-day-lanes" role="group" aria-label="全天计划与 Agent 执行时间线">
      <div className="qd-day-lane" style={{height: Math.max(27, plans.count * 10 + 12)}}><span className="qd-day-lane-label">计划</span><div className="qd-day-track">
        {plans.lanes.map(({interval: {plan, from, to}, lane}) => {
          return <button type="button" key={plan.id} className="qd-day-plan" style={{ left: `${from}%`, width: `${to - from}%`, top: lane * 10 + 8 }} title={`${plan.title} · ${plan.start} · ${formatDuration(plan.minutes)}`} aria-label={`计划：${plan.title}，${plan.start}，${formatDuration(plan.minutes)}`} onClick={() => plan.taskId ? onLocate(plan.taskId, plan.workItemId) : onSchedule()} />;
        })}
        <i className="qd-day-now-line" style={{ left: `${now}%` }} />
      </div></div>
      {agents.map(agent => { const layout = dashboardLanes(intervals.filter(interval => interval.agentId === agent.id)); return <div className="qd-day-lane" key={agent.id} style={{...tint(agent.color), height: Math.max(27, layout.count * 10 + 12)}}><span className="qd-day-lane-label" title={agent.name}><i />{agent.short}</span><div className="qd-day-track">
        {layout.lanes.map(({interval, lane}) => {
          const title = (interval.taskId && snap.tasks[interval.taskId]?.title) || '历史活动';
          const description = `${agent.name} · ${title} · ${interval.startLabel}—${interval.endLabel}`;
          const style = { left: `${interval.from / 14.4}%`, width: `${(interval.to - interval.from) / 14.4}%`, top: lane * 10 + 8 };
          return interval.taskId ? <button type="button" key={interval.id} className="qd-day-segment" style={style} title={description} aria-label={description} onClick={() => onLocate(interval.taskId!, interval.workItemId)} /> : <span key={interval.id} className="qd-day-segment" style={style} title={description} aria-label={description} />;
        })}<i className="qd-day-now-line" style={{ left: `${now}%` }} />
      </div></div>; })}
      {!agents.length && <p className="qd-day-empty">还没有执行记录</p>}
      <div className="qd-day-axis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  </section>;
}

function TaskDashboard({ onTasks, onResults }: { onTasks: () => void; onResults?: () => void }) {
  const { snap, openWorkspace, locateTask, locateWorkItem, selectWork } = useWorkdeck();
  const [filter, setFilter] = useState<OverviewBucket | "all">("all");
  const { rows, counts } = useMemo(() => dashboardOverview(snap), [snap]);
  const visible = rows.filter(row => filter === "all" || row.bucket === filter);
  const waiting = rows.filter(row => row.bucket === "attention");
  const reports = rows.flatMap(row => completedResults(snap, row.task.id, null).map(report => ({ ...report, task: row.task })));
  const latest = [...reports].sort((a, b) => {
    const stamp = (at: string) => { try { return Date.parse(instant(at, snap.date, snap.project.timeZone)) || 0; } catch { return 0; } };
    return stamp(b.at) - stamp(a.at);
  })[0];
  let offset = 0;
  const segments = BUCKETS.map(bucket => { const length = rows.length ? counts[bucket] / rows.length * 100 : 0; const segment = { bucket, length, offset }; offset += length; return segment; });
  const select = (taskId: string, selected: string | null = null) => openWorkspace(taskId, { view: "results", selected, focus: true });
  const locate = (taskId: string, itemId?: string) => itemId ? locateWorkItem(taskId, itemId) : locateTask(taskId);
  const showSchedule = () => { onTasks(); window.dispatchEvent(new CustomEvent("quandeck:show-schedule")); };
  return <section className="qd-task-dimension" aria-label="当前项目任务看板">
    <div className="qd-overview-charts">
      <section className="qd-task-distribution" aria-labelledby="distribution-title">
        <header className="qd-dash-section-head"><h2 id="distribution-title">任务分布</h2><span>主任务</span></header>
        <div className="qd-distribution-body">
          <button type="button" className="qd-distribution-ring" onClick={() => setFilter("all")} aria-label={`全部 ${rows.length} 个主任务，${counts.done} 个已完成；查看全部`}>
            <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" className="qd-ring-base" />{segments.filter(segment => segment.length > 0).map(segment => <circle key={segment.bucket} className={`qd-ring-piece tone-${segment.bucket}`} cx="80" cy="80" r="64" pathLength="100" strokeDasharray={`${Math.max(.2, segment.length - 1.5)} ${100 - Math.max(.2, segment.length - 1.5)}`} strokeDashoffset={-segment.offset} />)}</svg>
            <span><strong>{rows.length}</strong><small>主任务</small></span>
          </button>
          <nav className="qd-distribution-legend" aria-label="按主任务状态筛选" title="同一主任务只归入一种状态，待处理优先显示">
            {BUCKETS.filter(bucket => bucket !== "cancelled" || counts.cancelled > 0).map(bucket => <button type="button" key={bucket} className={`${filter === bucket ? "is-on" : ""} tone-${bucket}`} aria-pressed={filter === bucket} onClick={() => setFilter(filter === bucket ? "all" : bucket)}><i /><span>{OVERVIEW_LABELS[bucket]}</span><strong>{counts[bucket]}</strong></button>)}
          </nav>
        </div>
      </section>
      <DayActivity snap={snap} onLocate={locate} onSchedule={showSchedule} />
    </div>
    <div className="qd-overview-work">
      <section className="qd-dash-progress" aria-labelledby="dashboard-tasks">
        <header className="qd-dash-section-head"><h2 id="dashboard-tasks">主任务进展{filter !== "all" && <span> / {OVERVIEW_LABELS[filter]}</span>}</h2><button type="button" onClick={filter !== "all" ? () => setFilter("all") : onTasks}>{filter !== "all" ? "全部任务" : "管理任务"}<Icon name="arrow-right" size={14} /></button></header>
        <div className="qd-dash-progress-list">
          {visible.map((row, index) => <div className="qd-dash-task-wrap" key={row.task.id}><button type="button" className="qd-dash-task" onClick={() => select(row.task.id)} aria-label={`查看 ${row.task.title} 的任务、方法与结果`}>
            <span className="qd-dash-task-index"><TaskIcon snapshot={snap} taskId={row.task.id} size={24} /></span>
            <span className="qd-dash-task-content"><span className="qd-dash-task-title"><strong>{row.task.title}</strong><span className={`qd-dash-state tone-${row.bucket}`}>{OVERVIEW_LABELS[row.bucket]}</span></span>
              <span className="qd-dash-task-meta">{row.total ? <><b>{row.completed}</b> / {row.total} {row.children.length ? "一级子任务" : "步骤"}</> : row.task.estimate ? `预计 ${formatDuration(row.task.estimate)}` : row.task.completion ? "任务已完成" : "待开始"}{row.running && row.bucket === "attention" && <em>其他分支仍在推进</em>}</span>
              {row.total > 0 && <span className="qd-dash-task-bars" role="img" aria-label={`${row.completed} / ${row.total} ${row.children.length ? '一级子任务' : '步骤'}已完成`}>
                {row.children.length ? row.children.map(item => <i key={item.id} className={`work-${item.status}`} title={`${item.title} · ${WORK_LABEL[item.status]}`} />) : <i className="qd-dash-step-track"><i style={{ width: `${row.completed / row.total * 100}%` }} /></i>}
              </span>}
            </span><Icon name="chevron-right" size={16} />
          </button><DeleteWorkButton projectId={snap.project.id} taskId={row.task.id} title={row.task.title} /></div>)}
          {!visible.length && <div className="qd-dash-empty"><Icon name="check-circle" size={24} /><p>{rows.length ? "这个状态下还没有任务" : "从一件想做的事开始"}</p><button type="button" className="qd-link" onClick={rows.length ? () => setFilter("all") : onTasks}>{rows.length ? "查看全部任务" : "记录任务"}<Icon name="arrow-right" size={14} /></button></div>}
        </div>
      </section>
      <aside className="qd-dash-sidebar">
        <section className="qd-dash-attention" aria-labelledby="attention-title"><header className="qd-dash-section-head"><h2 id="attention-title">等你推进 <span>{waiting.length}</span></h2><Icon name="reply" size={16} /></header>
          {waiting.length ? waiting.map(row => <button type="button" className="qd-dash-question" key={row.task.id} onClick={() => { locateTask(row.task.id); selectWork(row.task.id, row.pendingItem?.id ?? null); }}><strong className="qd-task-name"><TaskIcon snapshot={snap} taskId={row.task.id} workItemId={row.pendingItem?.id} size={18} /><span>{row.pendingItem?.title ?? row.task.title}</span></strong><p>{row.question}</p><span>{row.pendingItem ? row.task.title : row.session ? snap.agents.find(agent => agent.id === row.session?.agentId)?.name : "任务验收"}<Icon name="arrow-right" size={15} /></span></button>) : <div className="qd-dash-clear"><Icon name="check-circle" size={22} /><p>当前没有待处理事项</p></div>}
        </section>
        <section className="qd-dash-delivery" aria-labelledby="delivery-title"><header className="qd-dash-section-head"><h2 id="delivery-title">已积累的成果</h2><span>{reports.length} 份</span></header>{latest ? <button type="button" className="qd-dash-delivery-preview" onClick={() => select(latest.task.id, latest.itemId ?? null)}><TaskIcon snapshot={snap} taskId={latest.task.id} workItemId={latest.itemId} size={20} /><strong>{latest.title}</strong><p>{latest.text}</p></button> : <p className="qd-dash-no-results">完成的任务会把结果留在这里。</p>}<button type="button" className="qd-dash-results-link" onClick={() => onResults ? onResults() : rows[0] ? select(rows[0].task.id) : onTasks()}>进入成果看板<Icon name="arrow-right" size={15} /></button></section>
      </aside>
    </div>
  </section>;
}

function StateBar({ counts, total, label }: { counts: Record<OverviewBucket, number>; total: number; label: string }) {
  return <div className="qd-portfolio-statebar" role="img" aria-label={`${label}：${BUCKETS.map(bucket => `${OVERVIEW_LABELS[bucket]} ${counts[bucket]}`).join('，')}`}>
    {BUCKETS.filter(bucket => counts[bucket] > 0).map(bucket => <i key={bucket} className={`tone-${bucket}`} style={{ flex: counts[bucket] }} title={`${OVERVIEW_LABELS[bucket]} ${counts[bucket]}`} />)}
    {!total && <span />}
  </div>;
}

function ProjectDashboard({ onTasks, onCreateProject, onEditProject }: {
  onTasks: () => void; onCreateProject: () => void; onEditProject?: (id: string) => void;
}) {
  const { snap, projectSnapshots, switchProject, openWorkspace } = useWorkdeck();
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const portfolio = useMemo(() => portfolioOverview([...projectSnapshots, snap]), [projectSnapshots, snap]);
  const { projects, totalTasks, counts, reports, humanReports, agentReports, unknownReports } = portfolio;
  const visible = projects.filter(project => matchesProjectFilter(project, filter));
  const enter = async (id: string) => { if (await switchProject(id)) onTasks(); };
  const openReport = async (report: typeof reports[number]) => {
    if (await switchProject(report.projectId)) openWorkspace(report.taskId, { view: 'results', selected: report.itemId ?? null, focus: true });
  };
  if (!projects.length) return <section className="qd-project-empty" aria-labelledby="project-empty-title">
    <div className="qd-project-empty-map" aria-hidden="true"><span className="qd-project-empty-root"><Icon name="folder" size={27} /></span><i /><div><span><Icon name="check-square" size={20} />任务</span><span><Icon name="message" size={20} />方法</span><span><Icon name="box" size={20} />成果</span></div></div>
    <h2 id="project-empty-title">先建一个项目</h2><p>把想做的事放在一起，自己完成，或交给 Agent。</p>
    <button type="button" className="qd-btn primary" onClick={onCreateProject}><Icon name="plus" size={16} />新建项目</button>
  </section>;
  return <div className="qd-project-dimension">
    <section className="qd-portfolio-summary" aria-label="全部项目概况">
      <div className="qd-portfolio-counts"><span><strong>{projects.length}</strong><small>项目</small></span><span><strong>{totalTasks}</strong><small>主任务</small></span><span><strong>{counts.done}</strong><small>已完成</small></span><span><strong>{reports.length}</strong><small>成果</small></span></div>
      <div className="qd-portfolio-global-chart"><header><h2>任务分布</h2><span>{totalTasks ? `${Math.round(counts.done / totalTasks * 100)}% 已完成` : '等待第一项任务'}</span></header><StateBar counts={counts} total={totalTasks} label="全部项目主任务" /><div className="qd-portfolio-chart-legend">{BUCKETS.filter(bucket => bucket !== 'cancelled' || counts.cancelled).map(bucket => <span className={`tone-${bucket}`} key={bucket}><i />{OVERVIEW_LABELS[bucket]}<b>{counts[bucket]}</b></span>)}</div></div>
    </section>
    <div className="qd-portfolio-body">
      <section className="qd-project-lanes" aria-labelledby="portfolio-projects-title">
        <header className="qd-dash-section-head"><h2 id="portfolio-projects-title">项目进展</h2><span>{projects.length} 个项目</span></header>
        <nav className="qd-project-filters" aria-label="按项目状态筛选">{([
          ['all', '全部', projects.length], ['active', '未完成', projects.length - portfolio.completedProjects], ['attention', '待处理', portfolio.attentionProjects], ['done', '已完成', portfolio.completedProjects],
        ] as [ProjectFilter, string, number][]).map(([key, name, count]) => <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? 'is-on' : ''} onClick={() => setFilter(key)}>{name}<span>{count}</span></button>)}</nav>
        <div className="qd-project-lane-list">{visible.map(project => <article key={project.id} className={`qd-project-lane ${snap.project.id === project.id ? 'is-current' : ''}`}>
          <button type="button" className="qd-project-lane-open" aria-label={`进入项目 ${project.name}`} onClick={() => { void enter(project.id); }}>
            <span className="qd-project-lane-icon" style={tint(project.snap.project.color || '#ad4a37')}><Icon name="folder" size={19} /></span>
            <span className="qd-project-lane-content"><span className="qd-project-lane-title"><strong>{project.name}</strong>{project.hasAttention ? <em>待处理 {project.counts.attention}</em> : project.finished ? <em className="is-done">已完成</em> : !project.total ? <em className="is-empty">待开始</em> : null}</span>
              {project.snap.project.description && <span className="qd-project-description">{project.snap.project.description}</span>}
              <StateBar counts={project.counts} total={project.total} label={project.name} />
              <span className="qd-project-lane-meta"><span><b>{project.done}</b> / {project.total} 主任务</span><span>{project.reports.length} 份成果</span>{snap.project.id === project.id && <span className="qd-project-current">当前项目</span>}</span>
            </span><Icon name="arrow-right" size={17} />
          </button>
          <DeleteWorkButton projectId={project.id} title={project.name} />
          {onEditProject && <button type="button" className="qd-project-edit" aria-label={`编辑项目 ${project.name}`} onClick={() => onEditProject(project.id)}><Icon name="pencil" size={14} /></button>}
        </article>)}</div>
        {!visible.length && <div className="qd-dash-empty"><p>这个状态下还没有项目</p><button type="button" className="qd-link" onClick={() => setFilter('all')}>查看全部项目<Icon name="arrow-right" size={14} /></button></div>}
      </section>
      <aside className="qd-portfolio-aside">
        <section className="qd-portfolio-contribution" aria-labelledby="contribution-title"><header className="qd-dash-section-head"><h2 id="contribution-title">成果来自哪里</h2><span>{reports.length} 份</span></header>
          <div className="qd-contribution-bars" role="img" aria-label={`人工 ${humanReports} 份，Agent ${agentReports} 份${unknownReports ? `，来源待确认 ${unknownReports} 份` : ''}`}>
            <div><span><Icon name="user" size={14} />自己完成</span><div><i style={{width: `${reports.length ? humanReports / reports.length * 100 : 0}%`}} /></div><b>{humanReports}</b></div>
            <div><span><Icon name="box" size={14} />Agent 完成</span><div><i style={{width: `${reports.length ? agentReports / reports.length * 100 : 0}%`}} /></div><b>{agentReports}</b></div>
            {unknownReports > 0 && <small>来源待确认 {unknownReports} 份</small>}
          </div>
        </section>
        <section className="qd-portfolio-latest" aria-labelledby="portfolio-latest-title"><header className="qd-dash-section-head"><h2 id="portfolio-latest-title">最近成果</h2><Icon name="box" size={15} /></header>
          {reports.slice(0, 4).map(report => <button type="button" className="qd-portfolio-report" key={`${report.projectId}:${report.id}`} onClick={() => { void openReport(report); }}><span className="qd-portfolio-report-dot"><TaskIcon snapshot={projects.find(project => project.id === report.projectId)!.snap} taskId={report.taskId} workItemId={report.itemId} size={20} /></span><span><small>{report.projectName}<span> / </span>{report.origin === 'human' ? '自己完成' : report.agentId || report.sessionId ? 'Agent 完成' : '成果'}</small><strong>{report.title}</strong><p>{report.text || '查看成果内容'}</p></span><Icon name="chevron-right" size={14} /></button>)}
          {!reports.length && <p className="qd-portfolio-no-output">提交的文字、链接和文件，会在这里自动归集。</p>}
        </section>
      </aside>
    </div>
  </div>;
}

export function Dashboard({ onTasks, onResults, onCreateProject, onEditProject }: {
  onTasks: () => void; onResults?: () => void; onCreateProject: () => void; onEditProject?: (id: string) => void;
}) {
  const { snap, projectSnapshots, switchProject } = useWorkdeck();
  const [dimension, setDimension] = useState<'projects' | 'tasks'>('projects');
  return <main className="qd-overview">
    <header className="qd-overview-header"><div><p>{snap.dateLabel}</p><h1>{dimension === 'projects' ? '项目总览' : '任务总览'}</h1></div><button type="button" className="qd-btn primary" onClick={dimension === 'projects' || !snap.project.id ? onCreateProject : onTasks}><Icon name="plus" size={16} />{dimension === 'projects' || !snap.project.id ? '新建项目' : '记录任务'}</button></header>
    <div className="qd-dashboard-toolbar"><nav className="qd-dashboard-dimensions" aria-label="总览维度"><button type="button" aria-pressed={dimension === 'projects'} onClick={() => setDimension('projects')}><Icon name="folder" size={15} />项目</button><button type="button" aria-pressed={dimension === 'tasks'} onClick={() => setDimension('tasks')}><Icon name="check-square" size={15} />任务</button></nav>
      {dimension === 'tasks' && snap.project.id && <label className="qd-dashboard-project-select"><Icon name="folder" size={14} /><select aria-label="任务看板项目" value={snap.project.id} onChange={event => { void switchProject(event.target.value); }}>{projectSnapshots.map(project => <option key={project.project.id} value={project.project.id}>{project.project.name}</option>)}</select></label>}
      {dimension === 'projects' && snap.project.id && <span className="qd-dashboard-scope">全部项目</span>}
    </div>
    {dimension === 'projects' || !snap.project.id ? <ProjectDashboard onTasks={onTasks} onCreateProject={onCreateProject} onEditProject={onEditProject} /> : <TaskDashboard key={snap.project.id} onTasks={onTasks} onResults={onResults} />}
  </main>;
}
