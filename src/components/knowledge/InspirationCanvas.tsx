import { useEffect, useMemo, useRef, useState } from "react";
import {
  connectInspirations,
  describeInspiration,
  emptyInspirationBoard,
  insertInspiration,
  removeInspiration,
  reverseInspiration,
  type InspirationBoard,
  type InspirationLink,
  type IdeaCard,
  type InspirationNode,
} from "../../data/inspirationCanvas";
import { KNOWLEDGE_FILES, type KnowledgeLibrary, type KnowledgeNote } from "../../data/knowledgeNotes";
import { mutateKnowledge } from "../../data/knowledgeStore";
import { Icon } from "../ui/Icon";
import { InspirationStage, type CanvasSelection } from "./InspirationStage";
import { InspirationPicker } from "./InspirationPicker";
import { LinkCard, NoteFileCard, safeNoteUrl } from "./NoteInlineCards";
import { saveOutputFile, removeOutputFile } from "../../data/outputFiles";
import type { OutputAttachment } from "../../data/types";
import { plainNoteBody } from "./NoteWriter";
import "./inspiration-canvas.css";

function noteText(note?: KnowledgeNote) {
  return note ? plainNoteBody(note.body).replace(/\s+/g, " ").trim() : "";
}

function LinkField({
  label,
  value,
  multiline,
  change,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  change: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const sequence = useRef(0);
  const [failed, setFailed] = useState(false);
  async function save(text: string) {
    const ticket = ++sequence.current;
    const success = await change(text);
    if (ticket === sequence.current) setFailed(!success);
  }
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const props = {
    value: draft,
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      void save(e.target.value);
    },
  };
  return (
    <div className="qd-logic-field-group">
      <label className="qd-logic-field">
        <span>{label}</span>
        {multiline ? (
          <textarea
            {...props}
            rows={3}
            maxLength={1800}
            placeholder="写下要怎么衔接，或为什么这样安排"
          />
        ) : (
          <input {...props} maxLength={36} placeholder="例如：前往" />
        )}
      </label>
      {failed && (
        <button className="qd-logic-retry" onClick={() => void save(draft)}>
          重试保存{label}
        </button>
      )}
    </div>
  );
}

function EvidenceNote({ node, library, step, open }: {
  node?: InspirationNode; library: KnowledgeLibrary; step: string; open: (id: string) => void;
}) {
  if (!node) return null;
  const idea = node.idea;
  const source = idea?.source;
  const note = library.notes.find(n => n.id === (source?.noteId ?? node.noteId));
  const version = source && note?.revision !== source.revision ? note?.history.find(v => v.revision === source.revision) : note;
  const quote = source && version ? version[source.field].slice(source.start,source.end) : '';
  return <div className="qd-logic-evidence">
    <small>{step}</small><strong>{idea?.title || note?.title || '来源已移除'}</strong>
    {idea?.detail && <p>{idea.detail}</p>}
    {idea?.reference && ('url' in idea.reference ?
      <LinkCard url={idea.reference.url} label={idea.title}/> :
      <NoteFileCard noteId={node.noteId} file={idea.reference.file} label={idea.title}/>)}
    {note && <button onClick={() => open(note.id)}>{idea ? note.title : '打开原笔记'}<Icon name="external" size={14}/></button>}
    {quote && <blockquote>{quote}</blockquote>}
    {source && !version && <small>原笔记有更新，提炼自第 {source.revision} 版。</small>}
    {!idea && note && <p>{noteText(note).slice(0,180)}</p>}
  </div>;
}

const blank = emptyInspirationBoard();
export function InspirationCanvas({
  library,
  onOpenNote,
}: {
  library: KnowledgeLibrary;
  onOpenNote: (id: string) => void;
}) {
  const board = library.inspirationCanvas ?? blank;
  const [picker, setPicker] = useState<"extract" | "manual" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selection, select] = useState<CanvasSelection>(null);
  const [wireFrom, setWireFrom] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [inserted, setInserted] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const notes = useMemo(
    () => {
      const originals = new Map(library.notes.map(note => [note.id,note]));
      return new Map(board.nodes.map(node => {
        const note = originals.get(node.idea?.source?.noteId ?? node.noteId);
        const title = node.idea?.title || note?.title || "原笔记已移除";
        const typeLabel = node.idea?.origin === "manual" ? "我的灵感" : node.idea?.origin === "reference" ? "参考资料" : node.idea ? "笔记中的灵感" : "原有笔记";
        return [node.noteId,{title, note, typeLabel}];
      }));
    },
    [library.notes,board.nodes],
  );
  const placed = new Set(board.nodes.map((node) => node.noteId));
  const edge =
    selection?.kind === "link" ? board.links.find((link) => link.id === selection.id) : undefined;
  const selectedNode =
    selection?.kind === "note"
      ? board.nodes.find((node) => node.noteId === selection.id)
      : undefined;


  useEffect(() => {
    if (picker || !inserted || !wrap.current) return;
    const node = Array.from(wrap.current.querySelectorAll<HTMLElement>("[data-drag-note]")).find(
      (el) => el.dataset.dragNote === inserted,
    );
    if (!node) return;
    const frame = wrap.current.querySelector<HTMLElement>(".qd-logic-stage-scroll")!;
    const nodeRect = node.getBoundingClientRect(),
      frameRect = frame.getBoundingClientRect();
    if (
      nodeRect.right > frameRect.right ||
      nodeRect.left < frameRect.left ||
      nodeRect.bottom > frameRect.bottom ||
      nodeRect.top < frameRect.top
    )
      frame.scrollBy(
        nodeRect.left - frameRect.left - (frame.clientWidth - nodeRect.width) / 2,
        nodeRect.top - frameRect.top - (frame.clientHeight - nodeRect.height) / 2,
      );
    setInserted(null);
  }, [picker, inserted, board.nodes]);

  async function edit(mutate: (draft: InspirationBoard, fresh: KnowledgeLibrary) => void) {
    setError("");
    setPending((count) => count + 1);
    try {
      return await mutateKnowledge((fresh) => {
        mutate((fresh.inspirationCanvas ??= emptyInspirationBoard()), fresh);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "画布保存失败，请重试。");
    } finally {
      setPending((count) => count - 1);
    }
  }
  async function addCards(cards: IdeaCard[], referenceFor?: string) {
    if (!cards.length) return false;
    const result = await edit((draft,fresh) => {
      for (const {id,idea} of cards) {
        if (idea.source && !fresh.notes.some(n => n.id === idea.source!.noteId && n.revision === idea.source!.revision && !n.archivedAt))
          throw Error("提炼后的原笔记有更新，请重新提炼。");
        insertInspiration(draft,id,idea);
        if (referenceFor && draft.nodes.some(n => n.noteId === referenceFor)) {
          const link = connectInspirations(draft,referenceFor,id);
          link.label = "参考";
        }
      }
    });
    if (result) {
      select({kind:"note",id:cards[0].id}); setInserted(cards[0].id);
    }
    return !!result;
  }
  async function addReferences(files: File[], rawUrl: string) {
    const saved: OutputAttachment[] = [];
    let persisted = false;
    try {
      const cards: IdeaCard[] = [];
      for (const file of files) {
        const stored = await saveOutputFile(KNOWLEDGE_FILES,file);
        saved.push(stored);
        cards.push({id:"ref-" + stored.id,idea:{origin:"reference",title:stored.name,detail:"",reference:{file:stored}}});
      }
      const url = safeNoteUrl(rawUrl.trim());
      if (!files.length && url) cards.push({id:"ref-" + crypto.randomUUID(),idea:{origin:"reference",title:new URL(url).host,detail:"",reference:{url}}});
      persisted = await addCards(cards, selectedNode?.idea?.origin === 'reference' ? undefined : selectedNode?.noteId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "参考资料保存失败"); }
    finally { if (!persisted) await Promise.allSettled(saved.map(file => removeOutputFile(KNOWLEDGE_FILES,file.id))); }
  }
  function transfer(event: React.DragEvent | React.ClipboardEvent) {
    if ((event.target as Element).closest("input,textarea,dialog,[contenteditable=true]")) return;
    const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
    const files = Array.from(data.files);
    const url = data.getData("text/uri-list").split(/\r?\n/).find(line => line && !line.startsWith("#")) || data.getData("text/plain");
    if (!files.length && !safeNoteUrl(url.trim())) return;
    event.preventDefault();
    void addReferences(files,url);
  }
  function selectItem(item: CanvasSelection) {
    select(item);
    if (item?.kind === "link" && matchMedia("(max-width: 780px)").matches) {
      requestAnimationFrame(() =>
        wrap.current?.querySelector(".qd-logic-inspector")?.scrollIntoView({ block: "nearest" }),
      );
    }
  }
  function connect(from: string, to: string) {
    setWireFrom(null);
    select(null);
    void edit((draft) => {
      connectInspirations(draft, from, to);
    }).then((result) => {
      const link = result?.inspirationCanvas?.links.find(
        (item) => item.from === from && item.to === to,
      );
      if (link) selectItem({ kind: "link", id: link.id });
    });
  }
  async function setField(original: InspirationLink, field: "label" | "detail", value: string) {
    const saved = await edit((draft) => {
      const target = draft.links.find((item) => item.id === original.id);
      if (!target) throw new Error("这条连线已移除。");
      if (field === "detail" && target.from !== original.from) target.reverseDetail = value;
      else target[field] = value;
    });
    return Boolean(saved);
  }
  return (
    <section ref={wrap} className="qd-inspiration" aria-label="灵感逻辑" tabIndex={0} onPaste={transfer} onDrop={transfer}
      onDragOver={event => { if (event.dataTransfer.types.some(t => ["Files","text/uri-list","text/plain"].includes(t))) event.preventDefault(); }}>
      <div className="qd-logic-board">
        <header className="qd-logic-board-head">
          <div>
            <h2>
              <Icon name="merge" size={19} />
              方法画布
            </h2>
            <small>
              {board.nodes.length} 张卡片<span>·</span>
              {board.links.length} 条连线
            </small>
          </div>
          <div className="qd-idea-tools">
            <button type="button" onClick={() => setPicker("manual")}><Icon name="plus" size={15}/>新建灵感</button>
            <button type="button" title="选择参考文件，也可在画布粘贴网址、截图或拖入文件" onClick={() => fileInput.current?.click()}><Icon name="link" size={15}/>加入参考</button>
            <button className="qd-logic-add" onClick={() => setPicker("extract")}><Icon name="bulb" size={16}/>灵感提炼</button>
            <input ref={fileInput} type="file" multiple hidden onChange={e => { void addReferences(Array.from(e.target.files ?? []),""); e.target.value = ""; }}/>
          </div>
        </header>
        <InspirationStage
          board={board}
          notes={notes}
          selection={selection}
          select={selectItem}
          wireFrom={wireFrom}
          setWireFrom={setWireFrom}
          connect={connect}
          insert={() => setPicker("extract")}
          move={async (id, point) => {
            await edit((draft) => {
              const node = draft.nodes.find((n) => n.noteId === id);
              if (node) {
                node.x = point.x;
                node.y = point.y;
              }
            });
          }}
        />
        <div className="qd-logic-board-foot">
          <span>
            <i />
            手动连线
          </span>
          <span>{pending ? "正在保存…" : error ? "保存遇到问题" : "本地画布"}</span>
        </div>
      </div>
      <aside className="qd-logic-inspector" aria-label="画布说明">
        <header>
          <Icon name={edge ? "link" : selectedNode ? "pencil" : "bulb"} size={17} />
          <h3>{edge ? "连线说明" : selectedNode ? "卡片详情" : "连线说明"}</h3>
        </header>
        {error && !picker && (
          <p className="qd-logic-error" role="alert">
            {error}
          </p>
        )}
        {edge ? (
          <div className="qd-logic-inspector-body" key={edge.id + ":" + edge.from}>
            <div className="qd-logic-route">
              <b>{notes.get(edge.from)?.title || "原笔记已移除"}</b>
              <span>
                {edge.label || "接着"} <Icon name="arrow-right" size={13} />
              </span>
              <b>{notes.get(edge.to)?.title || "原笔记已移除"}</b>
            </div>
            <p className="qd-logic-sentence">
              {describeInspiration(
                notes.get(edge.from)?.title || "起点笔记",
                notes.get(edge.to)?.title || "终点笔记",
                edge.label,
              )}
            </p>
            <LinkField
              label="连线名称"
              value={edge.label}
              change={(v) => setField(edge, "label", v)}
            />
            <LinkField
              label="补充说明"
              value={edge.detail}
              multiline
              change={(v) => setField(edge, "detail", v)}
            />
            <div className="qd-logic-actions">
              <button onClick={() => void edit((draft) => reverseInspiration(draft, edge.id))}>
                <Icon name="refresh" size={14} />
                反转方向
              </button>
              <button
                onClick={() =>
                  void edit((draft) => {
                    draft.links = draft.links.filter((link) => link.id !== edge.id);
                  })
                }
              >
                <Icon name="trash" size={14} />
                删除连线
              </button>
            </div>
            <div className="qd-logic-sources">
              <EvidenceNote node={board.nodes.find(n => n.noteId === edge.from)} library={library} step="起点" open={onOpenNote}/>
              <EvidenceNote node={board.nodes.find(n => n.noteId === edge.to)} library={library} step="终点" open={onOpenNote}/>
            </div>
          </div>
        ) : selectedNode ? (
          <div className="qd-logic-inspector-body">
            <EvidenceNote node={selectedNode} library={library} step={notes.get(selectedNode.noteId)!.typeLabel} open={onOpenNote} />
            {board.links
              .filter(
                (link) => link.from === selectedNode.noteId || link.to === selectedNode.noteId,
              )
              .map((link) => (
                <button
                  key={link.id}
                  className="qd-logic-neighbour"
                  onClick={() => select({ kind: "link", id: link.id })}
                >
                  {notes.get(link.from)?.title || "起点"} <span>{link.label || "接着"} →</span>{" "}
                  {notes.get(link.to)?.title || "终点"}
                </button>
              ))}
            <div className="qd-logic-actions">
              <button onClick={() => setWireFrom(selectedNode.noteId)}>
                <Icon name="link" size={14} />
                从这里连线
              </button>
              <button
                onClick={() =>
                  void edit((draft) => removeInspiration(draft, selectedNode.noteId)).then(
                    (result) => {
                      if (result && wireFrom === selectedNode.noteId) setWireFrom(null);
                      const ref = selectedNode.idea?.reference;
                      if (result && ref && "file" in ref) void removeOutputFile(KNOWLEDGE_FILES,ref.file.id).catch(() => setError("卡片已移除，参考文件未能清理"));
                    },
                  )
                }
              >
                <Icon name="trash" size={14} />
                从画布移除
              </button>
            </div>
          </div>
        ) : (
          <div className="qd-logic-instructions">
            <p>这些灵感之间，是什么关系？</p>
            <ol>
              <li>选几篇笔记提炼观点，或自己写一个灵感。</li>
              <li>把起点右侧的圆点拖到下一张卡片。</li>
              <li>选中连线，写下它们如何衔接。也可在画布粘贴网址、截图或拖入参考文件。</li>
            </ol>
          </div>
        )}
      </aside>
      {picker && <InspirationPicker notes={library.notes.filter(n => !n.archivedAt)} placed={placed}
        manual={picker === "manual"} add={addCards} close={() => setPicker(null)}/>}
    </section>
  );
}
