import { useEffect, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Composer } from "./Composer";
import { SuggestionNotice } from './SuggestionNotice';
import { SessionEntry } from "./SessionEntry";
import { TaskRow } from "./TaskRow";
import { TextBlock } from "./TextBlock";
import { MergeCollapseSlot } from "./MergeFx";
import { usePreferences } from "../../state/preferences";
import type { LogDensity } from "../../state/preferences";
import './session-log.css';

function InlineEditable({
  value,
  onSave,
  className,
  label,
  as: Tag,
}: {
  value: string;
  onSave: (v: string) => void;
  className: string;
  label: string;
  as: "h1" | "p";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  if (editing)
    return (
      <input
        className={`${className} qd-inline-input`}
        value={draft}
        autoFocus
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <Tag
      className={`${className} qd-editable`}
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
      title="点击编辑"
    >
      {value}
    </Tag>
  );
}

export function Journal() {
  const {preferences,update} = usePreferences();
  const { snap, api, mergeFx, drag, setDrag, toast, locateTask } = useWorkdeck();
  // 关联成功后，源行在原位置留一个收起中的占位
  const slot =
    mergeFx?.snapshot &&
    !snap.journal.blocks.some((b) => b.kind === "session" && b.sessionId === mergeFx.sessionId)
      ? mergeFx
      : null;
  const tracked = snap.agents.filter((a) => a.tracked && a.connection === "healthy").length;

  return (
    <section className="qd-journal" aria-label="项目任务">
      <div className="qd-journal-scroll">
        <div className="qd-journal-inner">
          <InlineEditable
            as="h1"
            className="qd-page-title"
            label="编辑日记标题"
            value={snap.journal.title}
            onSave={(title) => api.updateJournal({ title })}
          />
          <InlineEditable
            as="p"
            className="qd-summary"
            label="编辑今日摘要"
            value={snap.journal.summary}
            onSave={(summary) => api.updateJournal({ summary })}
          />
          <div className="qd-journal-meta-row"><p className="qd-journal-meta">
            {snap.dateLabel}{tracked > 0 ? ` · ${tracked} 个 Agent 已连接` : ""}
          </p><label className="qd-log-density">记录<select aria-label="执行记录密度" value={preferences.logDensity} onChange={e=>update({logDensity:e.target.value as LogDensity})}><option value="brief">简略</option><option value="standard">标准</option><option value="detailed">详细</option></select></label></div>
          <SuggestionNotice />

          <div className="qd-blocks">
            {slot && slot.afterBlockId === null && <MergeCollapseSlot key={slot.key} fx={slot} />}
            {snap.journal.blocks.map((b) => {
              const node =
                b.kind === "text" ? (
                  <TextBlock key={b.id} blockId={b.id} text={b.text} />
                ) : b.kind === "task" ? (
                  <TaskRow key={b.id} taskId={b.taskId} />
                ) : (
                  <SessionEntry key={b.id} sessionId={b.sessionId} />
                );
              return slot && slot.afterBlockId === b.id
                ? [node, <MergeCollapseSlot key={`slot-${slot.key}`} fx={slot} />]
                : node;
            })}
            {snap.journal.blocks.length === 0 && (
              <div className="qd-empty">
                添加第一项任务，由你完成，或交给 Agent。
              </div>
            )}
            {drag?.type === 'session' && <div className="qd-empty" role="region" aria-label="放开会话新建任务"
              style={{ border: '1px dashed var(--qd-border, #c7cbd1)', borderRadius: 8, padding: 20 }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; }}
              onDrop={async event => { event.preventDefault(); const sessionId = drag.sessionId; setDrag(null); try { const result = await api.createTaskFromSession(sessionId); if (result.ok && result.taskId) locateTask(result.taskId); else toast(result.message ?? '关联失败', 'error'); } catch (error) { toast(error instanceof Error ? error.message : '关联失败', 'error'); } }}>放到这里，新建关联任务</div>}
          </div>
        </div>
      </div>
      <div className="qd-composer-wrap">
        <Composer />
      </div>
    </section>
  );
}
