import { useEffect, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Composer } from "./Composer";
import { SessionEntry } from "./SessionEntry";
import { TaskRow } from "./TaskRow";
import { TextBlock } from "./TextBlock";
import { MergeCollapseSlot } from "./MergeFx";

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
  const { snap, api, mergeFx } = useWorkdeck();
  // 关联成功后，源行在原位置留一个收起中的占位
  const slot =
    mergeFx?.snapshot &&
    !snap.journal.blocks.some((b) => b.kind === "session" && b.sessionId === mergeFx.sessionId)
      ? mergeFx
      : null;
  const tracked = snap.agents.filter((a) => a.tracked && a.connection === "healthy").length;

  return (
    <section className="qd-journal" aria-label="今日日记">
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
          <p className="qd-journal-meta">
            {snap.dateLabel} · 自动记录 {tracked} 个 Agent
          </p>

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
                在下方写一行，回车记录。
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="qd-composer-wrap">
        <Composer />
      </div>
    </section>
  );
}
