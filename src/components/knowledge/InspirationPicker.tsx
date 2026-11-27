import { useEffect, useRef, useState } from "react";
import type { IdeaCard } from "../../data/inspirationCanvas";
import type { KnowledgeNote } from "../../data/knowledgeNotes";
import { desktopHost } from "../../integration/desktop";
import { Icon } from "../ui/Icon";
import { NoteThumbnail } from "./NoteThumbnail";

export function InspirationPicker({
  notes,
  placed,
  manual,
  add,
  close,
}: {
  notes: KnowledgeNote[];
  placed: Set<string>;
  manual: boolean;
  add: (cards: IdeaCard[]) => Promise<boolean>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<IdeaCard[]>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!manual && !ideas) {
        const host = desktopHost();
        if (!host?.extractInspirations)
          throw Error("请在桌面版连接 Agent 后提炼，或手动新建灵感。");
        const extracted = await host.extractInspirations(selected);
        setIdeas(extracted);
        setChosen(extracted.filter((c) => !placed.has(c.id)).map((c) => c.id));
      } else {
        const cards: IdeaCard[] = manual
          ? [
              {
                id: "idea-" + crypto.randomUUID(),
                idea: { title: title.trim(), detail: detail.trim(), origin: "manual" },
              },
            ]
          : ideas!.filter((c) => chosen.includes(c.id) && !placed.has(c.id));
        if (await add(cards)) close();
        else setError("画布保存失败，请关闭窗口查看原因，或重试。");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
          : "暂时无法提炼，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const matches = notes.filter((note) =>
    (note.title + " " + note.body).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <dialog
      ref={dialog}
      className="qd-logic-picker"
      aria-labelledby="idea-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div>
        <header>
          <h3 id="idea-picker-title">
            {manual ? "新建灵感" : ideas ? "选取灵感" : "从笔记提炼灵感"}
          </h3>
          <button aria-label="关闭" onClick={close}>
            <Icon name="close" size={17} />
          </button>
        </header>
        {manual ? (
          <div className="qd-idea-write">
            <label className="qd-logic-field">
              <span>灵感</span>
              <input
                autoFocus
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="qd-logic-field">
              <span>补充说明（可选）</span>
              <textarea
                value={detail}
                maxLength={3000}
                onChange={(e) => setDetail(e.target.value)}
              />
            </label>
          </div>
        ) : ideas ? (
          <>
            {!ideas.length && (
              <p>这些笔记中暂未提炼出观点或做法。可以换一组笔记，也可以手动新建灵感。</p>
            )}
            <ul>
              {ideas.map((card) => (
                <li key={card.id}>
                  <label className="qd-idea-option">
                    <input
                      type="checkbox"
                      checked={placed.has(card.id) || chosen.includes(card.id)}
                      disabled={placed.has(card.id) || busy}
                      onChange={() => setChosen(toggle(chosen, card.id))}
                    />
                    <span>
                      <b>{card.idea.title}</b>
                      <small>
                        {notes.find((n) => n.id === card.idea.source?.noteId)?.title}
                        {placed.has(card.id) ? " · 已在画布" : ""}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <label className="qd-logic-search">
              <Icon name="search" size={16} />
              <input
                autoFocus
                aria-label="搜索笔记"
                placeholder="搜索笔记"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <ul>
              {matches.map((note) => (
                <li key={note.id}>
                  <label className="qd-idea-option">
                    <input
                      type="checkbox"
                      checked={selected.includes(note.id)}
                      disabled={busy}
                      onChange={() => setSelected(toggle(selected, note.id))}
                    />
                    <NoteThumbnail note={note} />
                    <span>{note.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            {!matches.length && (
              <p>
                {notes.length ? "没有匹配的笔记。" : "还没有可提炼的笔记，可以先手动新建灵感。"}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="qd-logic-error">
            {error}
          </p>
        )}
        <footer>
          {ideas ? (
            <button className="qd-idea-back" onClick={() => setIdeas(undefined)}>
              重新选笔记
            </button>
          ) : (
            <span>{manual ? "" : "已选 " + selected.length + " 篇笔记"}</span>
          )}
          <button
            disabled={busy || (manual ? !title.trim() : ideas ? !chosen.length : !selected.length)}
            onClick={() => void submit()}
          >
            {busy
              ? manual || ideas
                ? "正在保存…"
                : "正在提炼…"
              : manual
                ? "加入画布"
                : ideas
                  ? "加入画布（" + chosen.length + "）"
                  : "灵感提炼"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
