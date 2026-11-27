import { useState } from "react";
import type { NoteExpansion } from "../../data/knowledgeNotes";
import { confirmNoteAction } from "../../data/knowledgeStore";

const verbs = {
  strike: "加删除线",
  unstrike: "去掉删除线",
  replace: "替换文字",
  append: "追加文字",
  complete_todo: "完成待办",
  reopen_todo: "重新打开待办",
};
export function NoteActionReview({
  item,
  noteId,
  disabled,
}: {
  item: NoteExpansion;
  noteId: string;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = item.actionPlan;
  if (!plan) return null;
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await confirmNoteAction(noteId, item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="qn-note-action" aria-label="笔记修改">
      <strong>
        {plan.status === "applied"
          ? "已保存的修改"
          : plan.status === "failed"
            ? "未应用的修改"
            : "待确认的修改"}
      </strong>
      <ul>
        {plan.changes.map((c, i) => (
          <li key={i}>
            <b>{verbs[c.operation]}</b> · 《{c.noteTitle}》<p>{c.label}</p>
            {c.text && <blockquote>{c.text}</blockquote>}
          </li>
        ))}
      </ul>
      {plan.status === "pending" && (
        <button
          type="button"
          className="qd-link"
          disabled={busy || disabled}
          onClick={() => void confirm()}
        >
          {busy ? "正在保存…" : "确认修改笔记"}
        </button>
      )}
      {plan.message && <p role="status">{plan.message}</p>}
      {error && error !== plan.message && <p role="alert">{error}</p>}
    </section>
  );
}
