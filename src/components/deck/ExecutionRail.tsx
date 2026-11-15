import { useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import type { RailPanel } from "../../state/WorkdeckContext";
import { formatDuration } from "../../data/format";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { AgentTargets } from "./AgentTargets";
import { AgentRoster } from "./AgentRoster";
import { TaskScope } from "./TaskScope";
import { orchOf } from "../../data/orchestration";
import { deriveProjectActivity, waitingCount } from "../../data/projectActivity";
import { ProjectActivityRow } from "./ProjectActivityRow";
import { AgentsPanel } from "./panels/AgentsPanel";
import { StatsPanel } from "./panels/StatsPanel";
import { RecentPanel } from "./panels/RecentPanel";

const NOW_LIMIT = 3;

export function ExecutionRail() {
  const { snap, railPanel, setRailPanel, scope } = useWorkdeck();
  const scopeOrch = scope ? orchOf(snap, scope.taskId) : null;
  const activity = deriveProjectActivity(snap);
  const [showAll, setShowAll] = useState(false);
  const all = activity.entries;
  const visible = showAll ? all : all.slice(0, NOW_LIMIT);
  const hidden = all.length - visible.length;
  const recentCount = Object.keys(snap.tasks).length;
  const groups = [
    { key: "waiting", label: "等你处理", tone: "waiting", states: ["waiting_reply", "waiting_permission"] },
    { key: "attention", label: "需要注意", tone: "error", states: ["failed"] },
    { key: "running", label: "正在进行", tone: "running", states: ["running"] },
    { key: "queued", label: "排队", tone: "muted", states: ["queued"] },
  ].map(g => ({ ...g, items: visible.filter(i => g.states.includes(i.state)), total: all.filter(i => g.states.includes(i.state)).length })).filter(g => g.items.length > 0);

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
    <aside className="qd-rail" aria-label="当前执行">
      <div className="qd-rail-body" aria-hidden={railPanel ? true : undefined}>
        {/* 待处理／运行列表在自己的区域滚动；Agent 名单固定在下方，首屏可见 */}
        <div className="qd-rail-scroll">
          {scopeOrch ? (
            <TaskScope key={scopeOrch.taskId} o={scopeOrch} />
          ) : (
            <>
              <header className="qd-rail-head">
                <h2>执行</h2>
                <span className="qd-rail-count" aria-live="polite">
                  {activity.counts.running} 运行 · {waitingCount(activity.counts)} 等我
                  {activity.counts.queued ? ` · ${activity.counts.queued} 排队` : ""}
                </span>
              </header>

              <AgentTargets />

              {groups.length === 0 && (
                <div className="qd-empty small">
                  当前没有运行或等待的执行。
                  <br />
                  在日记里点纸飞机，或把任务拖到 Agent 上。
                </div>
              )}

              {groups.map((g) => (
                <section key={g.key} className="qd-rail-group" aria-label={g.label}>
                  <h3 className={`qd-group-title tone-${g.tone}`}>
                    <span className="qd-group-dot" aria-hidden="true" />
                    {g.label}
                    <span className="qd-group-count">({g.total})</span>
                  </h3>
                  <div className="qd-exec-list">
                    {g.items.map((entry) => <ProjectActivityRow key={entry.id} entry={entry} />)}
                  </div>
                </section>
              ))}

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

              <nav className="qd-entries" aria-label="展开更多">
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
              </nav>
            </>
          )}
        </div>
        <div className="qd-rail-roster">
          <AgentRoster compact />
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
