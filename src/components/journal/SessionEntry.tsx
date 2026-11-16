import { businessTasks } from '../../data/businessTasks';
import { useState } from "react";
import { clockTime } from "../../data/format";
import type { CSSProperties } from "react";
import { sessionView, taskView } from "../../data/derive";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { StatusPill } from "../ui/StatusPill";
import { InlineSessionRecord, sourceText } from "./InlineSessionRecord";

/**
 * 外部客户端新开的会话，自动记入日记（不是新派发）。沿用日记行样式：小会话图标、时间、来源、状态与细左线。
 * 拖到已有 TODO，或用“合并到待办”（键盘可达）选择目标，两条合为一条；归档会话只关联为历史。
 */
export function SessionEntry({ sessionId }: { sessionId: string }) {
  const { snap, api, toast, locateTask, drag, setDrag, agentOf, linking, mergeErrors, linkWithFx } = useWorkdeck();
  const session = snap.sessions[sessionId];
  const [menu, setMenu] = useState(false);
  const merging = sessionId in linking;
  const error = mergeErrors[sessionId];
  if (!session) return null;
  const agent = agentOf(session.agentId);
  const archived = session.status === "archived";
  const dragging = drag?.type === "session" && drag.sessionId === sessionId;
  const candidates = businessTasks(snap).filter(task => taskView(snap, task) !== "done");

  // 与拖放共用同一关联与动效流程；未收到成功结果前本行保留
  const merge = async (taskId: string) => {
    setMenu(false);
    await linkWithFx(sessionId, taskId);
  };

  return (
    <div
      data-session-entry={sessionId}
      aria-busy={merging || undefined}
      className={`qd-session-entry ${merging ? "is-busy" : ""} ${menu || dragging || merging ? "is-selected" : ""}`}
      style={{ "--agent": agent.color } as CSSProperties}
      onDragOver={event => { if (drag?.type === 'task') { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; } }}
      onDrop={event => { if (drag?.type !== 'task') return; event.preventDefault(); const taskId = drag.taskId; setDrag(null); void linkWithFx(sessionId, taskId); }}
    >
      <div className="qd-task-line">
        <span
          className="qd-grip"
          draggable={!merging}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "link";
            e.dataTransfer.setData("text/plain", `quandeck-session:${sessionId}`);
            setDrag({ type: "session", sessionId });
          }}
          onDragEnd={() => setDrag(null)}
          title={archived ? "拖到待办上关联为历史" : "拖到已有待办上合并"}
          aria-hidden="true"
        >
          <Icon name="grip" size={16} />
        </span>
        <span className="qd-session-glyph" aria-hidden="true">
          <Icon name="message" size={15} />
        </span>
        <div className="qd-task-main">
          <div className="qd-task-head">
            <h3 className="qd-task-title is-session">{session.title}</h3>
            <StatusPill view={sessionView(session)} />
          </div>
          <p className="qd-auto-note">
            <span className="qd-session-time">{clockTime(session.startedAt, snap.project.timeZone)}</span>
            {sourceText(session, agent.name).replace(" · 自动记入", "")} · 未关联
          </p>
        </div>
        <div className="qd-task-actions qd-entry-actions">
          <button
            type="button"
            className="qd-btn ghost small"
            aria-haspopup="dialog"
            aria-expanded={menu}
            disabled={merging}
            onClick={() => setMenu((v) => !v)}
          >
            <Icon name="merge" size={15} />
            {merging ? "正在关联…" : "合并到待办"}
          </button>
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            label="选择要合并的待办"
            className="qd-target-menu"
          >
            <div className="qd-menu-title">
              {archived ? "关联为历史（不会重新执行）" : "关联到待办"}
            </div>
            <button type="button" className="qd-menu-item" onClick={async () => {
              setMenu(false);
              try { const result = await api.createTaskFromSession(sessionId); if (result.ok && result.taskId) locateTask(result.taskId); else toast(result.message ?? '无法创建任务', 'error'); }
              catch (error) { toast(error instanceof Error ? error.message : '无法创建任务', 'error'); }
            }}><Icon name="plus" size={15} />新建任务并关联</button>
            {candidates.length === 0 && <p className="qd-muted pad">没有未完成的待办</p>}
            {candidates.map((t) => (
              <button key={t.id} type="button" className="qd-menu-item" onClick={() => merge(t.id)}>
                <span className="qd-menu-item-main">
                  <strong>
                    {t.title}
                    {t.estimate != null && <span className="qd-estimate"> · {t.estimate}m</span>}
                  </strong>
                </span>
              </button>
            ))}
          </Popover>
        </div>
      </div>
      {error && (
        <div className="qd-callout tone-error qd-merge-error" role="alert">
          <span>关联失败：{error.message}。本条记录已保留。</span>
          <button
            type="button"
            className="qd-callout-action"
            disabled={merging}
            onClick={() => merge(error.taskId)}
          >
            重试关联
          </button>
        </div>
      )}
      <div className="qd-records">
        <InlineSessionRecord session={session} showStatus={false} taskDone={false} hideSource />
      </div>
    </div>
  );
}
