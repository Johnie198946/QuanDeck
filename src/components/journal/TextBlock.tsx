import { useEffect, useRef, useState } from "react";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";
import { useDispatch } from "./TaskRow";
import { DispatchButton } from "./DispatchButton";

/** 自由文字行：点击编辑；悬停／聚焦出现“转 TODO”和纸飞机（点击才原位转为任务）。 */
export function TextBlock({ blockId, text }: { blockId: string; text: string }) {
  const { api } = useWorkdeck();
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(text), [text]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [editing, draft]);

  const save = () => {
    setEditing(false);
    const t = draft.trim();
    if (!t) api.deleteBlock(blockId);
    else if (t !== text) api.updateText(blockId, t);
  };

  return (
    <div className="qd-text-block" data-journal-block={blockId} tabIndex={-1}>
      {editing ? (
        <textarea
          ref={ref}
          className="qd-text-input"
          value={draft}
          autoFocus
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setDraft(text);
              setEditing(false);
            }
          }}
          aria-label="编辑日记段落"
        />
      ) : (
        <p
          className="qd-text"
          tabIndex={0}
          onClick={() => {
            if (!window.getSelection()?.toString()) setEditing(true);
          }}
          onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        >
          {text}
        </p>
      )}
      {!editing && (
        <div className="qd-text-actions">
          <button
            type="button"
            className="qd-icon-btn"
            onClick={() => api.convertTextToTask(blockId)}
            aria-label="原位转为 TODO"
            title="转为 TODO"
          >
            <Icon name="check-square" size={17} />
          </button>
          <DispatchButton
            label="这一行"
            onDispatch={async (agentId) => {
              const taskId = await api.convertTextToTask(blockId);
              dispatch(taskId, agentId);
            }}
          />
        </div>
      )}
    </div>
  );
}
