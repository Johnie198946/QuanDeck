import { businessTasks } from '../../data/businessTasks';
import { useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import type { RailPanel } from "../../state/WorkdeckContext";
import { formatDuration } from "../../data/format";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { AgentRoster } from "./AgentRoster";
import { TaskScope } from "./TaskScope";
import { orchOf } from "../../data/orchestration";
import { deriveProjectActivity, waitingCount, needsAttention } from "../../data/projectActivity";
import { ProjectActivityRow } from "./ProjectActivityRow";
import { AgentsPanel } from "./panels/AgentsPanel";
import { StatsPanel } from "./panels/StatsPanel";
import { RecentPanel } from "./panels/RecentPanel";
import { nowQueueView } from "../../data/nowQueue";
import type { NowQueueCommand } from "../../data/nowQueue";
import './now-queue.css';

const NOW_LIMIT = 3;

export function ExecutionRail() {
  const { snap, railPanel, setRailPanel, scope, api, toast } = useWorkdeck();
  const scopeOrch = scope ? orchOf(snap, scope.taskId) : null;
  const activity = deriveProjectActivity(snap);
  const [section, setSection] = useState<"now" | "tools">("now");
  const [showAll, setShowAll] = useState(false);
  const [editing,setEditing] = useState(false);
  const [moving,setMoving] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const attention = activity.entries.filter(needsAttention);
  const queue=nowQueueView(activity.entries.filter(entry => !needsAttention(entry)),snap.nowQueue,NOW_LIMIT);
  const all = queue.all;
  const visible = showAll ? all : queue.compact;
  const hidden = all.length - visible.length;
  const manage=async(command:NowQueueCommand)=>{setBusy(true);try{await api.manageNow(command);}catch(error){toast(error instanceof Error?error.message:'未能更新当前执行列表','error');}finally{setBusy(false);setMoving(null);}};
  const move=(id:string,beforeId:string|null)=>manage({type:'move',id,beforeId,view:showAll?'all':'compact'});
  const recentCount = businessTasks(snap).length;

  const entries: {
    key: Exclude<RailPanel, null>;
    icon: IconName;
    label: string;
    sub: string;
    count?: string;
  }[] = [
    {
      key: "stats",
      icon: "chart",
      label: "统计",
      sub: `今日协作 ${formatDuration(snap.stats.collabMinutes)}`,
    },
    {
      key: "recent",
      icon: "message",
      label: "最近任务",
      sub: "主任务与子任务",
      count: String(recentCount),
    },
  ];

  return (
    <aside className="qd-rail qd-rail-with-dock" aria-label="Agent 与执行">
      <div className="qd-rail-body" aria-hidden={railPanel ? true : undefined}>
        <div className="qd-agent-dock-wrap"><AgentRoster entries={activity.entries} /></div>
        <div className="qd-rail-scroll">
          {attention.length > 0 && <section className="qd-attention-queue" aria-label="需要你处理的执行">
            <header><h2>需要你处理</h2><span>{attention.length} 项</span></header>
            <div>{attention.map(entry => <ProjectActivityRow key={entry.id} entry={entry} />)}</div>
          </section>}
          {scopeOrch ? (
            <TaskScope key={scopeOrch.taskId} o={scopeOrch} />
          ) : (
            <>
              <header className="qd-rail-head">
                <h2>当前执行</h2>
                <span className="qd-rail-count" aria-live="polite">
                  {activity.counts.running} 运行 · {waitingCount(activity.counts)} 等我
                  {activity.counts.queued ? ` · ${activity.counts.queued} 排队` : ""}
                  {activity.counts.failed ? ` · ${activity.counts.failed} 异常` : ""}
                </span>
              </header>


              <nav className="qd-rail-tabs qd-rail-tabs-quiet" aria-label="执行侧栏">
                {([["now", "进行中"], ["tools", "更多"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>)}
              </nav>
              {section === "now" && <>
              <div className="qd-now-toolbar"><span>{showAll?'全部执行':'当前关注'}</span>{queue.all.length>0&&<button type="button" className="qd-link" aria-pressed={editing} onClick={()=>setEditing(!editing)}>{editing?'完成整理':'整理'}</button>}</div>
              {visible.length === 0 && (
                <div className="qd-empty small">
                  {queue.hidden.length?'当前关注为空。':attention.length?'待处理事项见上方。':'当前没有运行中的执行。'}
                  {queue.hidden.length?'可在下方恢复已移出的执行。':attention.length?'可以先处理授权、回复或异常。':''}
                </div>
              )}

              <div className={`qd-now-list ${editing?'is-editing':''}`} aria-label={showAll?'全部执行排序':'当前关注排序'}>{visible.map((entry,index)=><div key={entry.id} className={`qd-now-item ${moving===entry.id?'is-moving':''}`} data-now-id={entry.id} onDragOver={e=>{if(moving){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{if(moving){e.preventDefault();e.stopPropagation();if(moving!==entry.id)void move(moving,entry.id);}}}>
                {editing&&<div className="qd-now-controls"><button type="button" className="qd-icon-btn" draggable={!busy} aria-label={`拖动排序 ${entry.title}`} title="拖动排序；也可用上移、下移" onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('application/quandeck-now',entry.id);e.dataTransfer.effectAllowed='move';setMoving(entry.id);}} onDragEnd={()=>setMoving(null)}><Icon name="grip" size={15}/></button><button type="button" className="qd-link" disabled={busy||index===0} aria-label={`上移 ${entry.title}`} onClick={()=>void move(entry.id,visible[index-1].id)}>上移</button><button type="button" className="qd-link" disabled={busy||index===visible.length-1} aria-label={`下移 ${entry.title}`} onClick={()=>void move(entry.id,visible[index+2]?.id??null)}>下移</button><button type="button" className="qd-link" disabled={busy} aria-label={`移出当前关注 ${entry.title}`} onClick={()=>void manage({type:'hide',id:entry.id})}>移出</button></div>}
                <ProjectActivityRow entry={entry}/>
              </div>)}</div>
              {queue.hidden.length>0&&<details className="qd-now-removed"><summary>已移出 {queue.hidden.length}</summary><p>移出只隐藏卡片，记录与状态保留。</p>{queue.hidden.map(entry=><div key={entry.id}><span>{entry.title}</span><button type="button" className="qd-link" disabled={busy} aria-label={`恢复 ${entry.title}`} onClick={()=>void manage({type:'restore',id:entry.id})}>恢复</button></div>)}</details>}

              {all.length > NOW_LIMIT ? (
                <button
                  type="button"
                  className="qd-text-btn"
                  onClick={() => setShowAll((v) => !v)}
                  aria-expanded={showAll}
                >
                  {showAll ? "收起" : `查看全部执行（还有 ${hidden} 项）`}
                  <Icon name={showAll ? "chevron-down" : "arrow-right"} size={15} />
                </button>
              ) : null}

              </>}
              {section === "tools" && <nav className="qd-entries" aria-label="展开更多">
                {entries.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    className="qd-entry"
                    onClick={() => setRailPanel(e.key)}
                    aria-haspopup="dialog"
                  >
                    <Icon name={e.icon} size={19} />
                    <span className="qd-entry-main">
                      <strong>{e.label}</strong>
                      <small>{e.sub}</small>
                    </span>
                    {e.count && <span className="qd-entry-count">{e.count}</span>}
                    <Icon name="chevron-right" size={16} />
                  </button>
                ))}
              </nav>}
            </>
          )}
        </div>

      </div>

      <div
        className={`qd-panel ${railPanel ? "is-open" : ""}`}
        role="dialog"
        aria-label="展开面板"
        aria-hidden={!railPanel}
      >
        {railPanel && (
          <>
            <header className="qd-panel-head">
              <button
                type="button"
                className="qd-back"
                onClick={() => setRailPanel(null)}
                autoFocus
              >
                <Icon name="chevron-left" size={17} />
                执行
              </button>
              <h2>
                {railPanel === "agents"
                  ? "Agents"
                  : entries.find((e) => e.key === railPanel)?.label}
              </h2>
              <button
                type="button"
                className="qd-icon-btn"
                onClick={() => setRailPanel(null)}
                aria-label="关闭面板"
              >
                <Icon name="close" size={17} />
              </button>
            </header>
            <div className="qd-panel-body">
              {railPanel === "agents" && <AgentsPanel />}
              {railPanel === "stats" && <StatsPanel />}
              {railPanel === "recent" && <RecentPanel />}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
