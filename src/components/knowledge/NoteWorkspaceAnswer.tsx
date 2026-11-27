import { useState } from "react";
import { areas, type WorkspaceAnswer, type WorkspaceTarget } from "../../data/workspaceQuestion";
import type { KnowledgeLibrary } from "../../data/knowledgeNotes";
import { DeferredNoteImage } from "./NoteThumbnail";
import { Icon } from "../ui/Icon";
import "./note-workspace-answer.css";

import { NoteAnswerChart } from "./NoteAnswerChart";

export function NoteCompletionChart({ result }: { result: WorkspaceAnswer }) {
  const counts = result.noteList?.counts;
  if (!counts) return null;
  return (
    <NoteAnswerChart
      chart={{
        title: "清单完成情况",
        type: "donut",
        labels: ["已划线", "未划线", "部分划线"],
        series: [{ label: "条目数", values: [counts.struck, counts.open, counts.partial] }],
      }}
    />
  );
}

export function NoteWorkspaceAnswer({
  result,
  onOpen,
  library,
}: {
  result: WorkspaceAnswer;
  library?: KnowledgeLibrary;
  onOpen: (target: WorkspaceTarget) => void;
}) {
  const [limit, setLimit] = useState(6);
  const partial = new Set(
    result.noteList?.items
      .filter((item) => item.status === "partial")
      .map((item) => item.noteId + "@" + item.start),
  );
  const groups = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const key =
      row.group +
      (result.area === "notes" && row.target.page === "notes" ? "\u0000" + row.target.id : "");
    const items = groups.get(key);
    if (items) items.push(row);
    else groups.set(key, [row]);
  }
  let remaining = limit;
  return (
    <section className="qd-workspace-answer" aria-label="工作台查询结果">
      <header>
        <small>
          <Icon name="search" size={12} />
          {areas[result.area]}
        </small>
        <strong>{result.summary}</strong>
        <span>{result.rule}</span>
      </header>
      <NoteCompletionChart result={result} />
      {[...groups].map(([key, items]) => {
        const visible = items.slice(0, Math.max(0, remaining));
        remaining -= visible.length;
        if (!visible.length) return null;
        return (
          <div className="qd-workspace-group" key={key}>
            <h4>
              {items[0].group}
              <span>{items.length}</span>
            </h4>
            <ul>
              {visible.map((row, i) => (
                <li key={i}>
                  <button type="button" onClick={() => onOpen(row.target)}>
                    <span>
                      {row.number && <b>第 {row.number} 项 · </b>}
                      {row.label}
                      {row.target.page === "notes" &&
                        partial.has(row.target.id + "@" + row.target.selection?.offset) && (
                          <small>（部分划线）</small>
                        )}
                    </span>
                    <Icon name="arrow-right" size={14} />
                  </button>
                  {!!row.images?.length && row.target.page === "notes" && (
                    <details>
                      <summary>查看附图（{row.images.length}）</summary>
                      {row.images.map((img, index) => {
                        const target = row.target;
                        const note =
                          target.page === "notes" && library?.notes.find((n) => n.id === target.id);
                        const file = note && note.attachments.find((f) => f.id === img.id);
                        return file && note ? (
                          <DeferredNoteImage
                            key={index}
                            noteId={note.id}
                            file={file}
                            alt={img.name}
                          />
                        ) : (
                          <span key={index}>{img.name}</span>
                        );
                      })}
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {limit < result.rows.length && (
        <button type="button" className="qd-link" onClick={() => setLimit(limit + 20)}>
          再看 {Math.min(20, result.rows.length - limit)} 条
        </button>
      )}
    </section>
  );
}
