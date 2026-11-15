import { useMemo, useState } from "react";
import { deriveProjectActivity, waitingCount } from "../../data/projectActivity";
import type { ActivityState, ProjectActivityEntry } from "../../data/projectActivity";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";

const labels: Record<ActivityState, string> = { running: "运行中", queued: "排队", waiting_reply: "待回复", waiting_permission: "待权限", failed: "失败" };

/** Project-wide summary. Uses the same snapshot reducer as the journal, rail and future native menu. */
export function MenuBarSummary() {
  const { snap, selectWork, locateTask, closeWorkspace, openAttemptSource, openSourceSession } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const activity = useMemo(() => deriveProjectActivity(snap), [snap]);
  const { counts } = activity;
  const waiting = waitingCount(counts);
  const text = `${counts.running} 运行 · ${waiting} 等我`;
  const source = (entry: ProjectActivityEntry) => {
    setOpen(false);
    if (entry.taskId && entry.attemptId) openAttemptSource(entry.taskId, entry.attemptId);
    else if (entry.sessionId) openSourceSession(entry.sessionId);
  };
  const locate = (entry: ProjectActivityEntry) => {
    setOpen(false);
    closeWorkspace();
    if (entry.taskId && entry.itemId) selectWork(entry.taskId, entry.itemId);
    else if (entry.taskId) requestAnimationFrame(() => locateTask(entry.taskId!));
    else if (entry.sessionId) source(entry);
  };
  return <div className="qd-menubar">
    <button type="button" className={`qd-menubar-btn ${waiting ? "has-wait" : ""}`} aria-label={`当前项目：${text}，${counts.queued} 排队，${counts.failed} 失败`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name="inbox" size={15} />
      <span className="qd-menubar-full">{text}</span><span className="qd-menubar-short">{counts.running} 运行 · {waiting} 等我</span>
    </button>
    <Popover open={open} onClose={() => setOpen(false)} label="当前项目执行状态" className="qd-menubar-pop qd-project-activity">
      <header><strong>项目执行</strong><span>{snap.project.name}</span></header>
      <div className="qd-activity-counts" aria-label="项目状态分类">
        <span>{counts.running} 运行</span><span>{counts.queued} 排队</span><span>{counts.waitingReply} 待回复</span><span>{counts.waitingPermission} 待权限</span>{counts.failed > 0 && <span>{counts.failed} 失败</span>}
      </div>
      {activity.groups.length === 0 && <p className="qd-muted pad">当前没有运行或等待的执行。</p>}
      {activity.groups.map(group => <section className="qd-activity-group" key={group.id}>
        <h3>{group.title}</h3>
        <ul>{group.entries.map(entry => <li key={entry.id}>
          <button type="button" className="qd-activity-entry" onClick={() => locate(entry)}>
            <span className={`qd-activity-dot is-${entry.state}`} />
            <span><strong>{entry.title}</strong><small>{labels[entry.state]}{entry.detail ? ` · ${entry.detail}` : ""}</small></span>
          </button>
          {(entry.sessionId || entry.attemptId) && <button type="button" className="qd-icon-btn" aria-label={`打开 ${entry.title} 的源会话`} title="回到 Agent 会话" onClick={() => source(entry)}><Icon name="external" size={15} /></button>}
        </li>)}</ul>
      </section>)}
    </Popover>
  </div>;
}
