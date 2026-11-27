import { useEffect, useMemo, useRef, useState } from "react";
import {
  canRefreshInspiration,
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
import { mutateKnowledge, purgeDeletedNoteFiles } from "../../data/knowledgeStore";
import { Icon } from "../ui/Icon";
import { InspirationStage, type CanvasSelection } from "./InspirationStage";
import { InspirationPicker } from "./InspirationPicker";
import { LinkCard, NoteFileCard, safeNoteUrl } from "./NoteInlineCards";
import { saveOutputFile, removeOutputFile } from "../../data/outputFiles";
import type { OutputAttachment } from "../../data/types";
import { plainNoteBody } from "./NoteWriter";
import { activeMethodBoard, appendMethodFragment, editableMethodBoard, methodBoards, methodFileIds, switchMethodBoard } from "../../data/methodBoards";
import { pruneMethodLinks } from "../../data/deleteKnowledgeNote";
import { MethodLibraryDialog, type BoardAction } from "./MethodLibraryDialog";
import { MethodImportDialog } from "./MethodImportDialog";
import { IdeaCardEditor } from "./IdeaCardEditor";
import { MethodStepDetails } from "./MethodStepDetails";
import type { IconName } from "../ui/Icon";
import "./inspiration-canvas.css";
import "./method-workbench.css";

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
  const note = library.notes.find(n => n.id === (source?.noteId ?? node.idea?.method?.sourceNote?.id ?? node.noteId));
  const version = source && note?.revision !== source.revision ? note?.history.find(v => v.revision === source.revision) : note;
  const quote = source && version ? version[source.field].slice(source.start,source.end) : '';
  return <div className="qd-logic-evidence">
    <small>{step}</small><strong>{idea?.title || note?.title || '来源已移除'}</strong>
    {idea?.detail && <p>{idea.detail}</p>}
    {idea?.method && <MethodStepDetails idea={idea}/>}
    {idea?.reference && ('url' in idea.reference ?
      <LinkCard url={idea.reference.url} label={idea.title}/> :
      <NoteFileCard noteId={node.noteId} file={idea.reference.file} label={idea.title}/>)}
    {note && <button onClick={() => open(note.id)}>{idea ? note.title : '打开原笔记'}<Icon name="external" size={14}/></button>}
    {quote && !idea?.method && <blockquote>{quote}</blockquote>}
    {source && !version && <small>原笔记有更新，提炼自第 {source.revision} 版。</small>}
    {!idea && note && <p>{noteText(note).slice(0,180)}</p>}
  </div>;
}

const blank = emptyInspirationBoard();
type CanvasProps = {
  initialSelection?: CanvasSelection;
  initialTemplateId?: string;
  library: KnowledgeLibrary;
  onOpenNote: (id: string) => void;
};
export function InspirationCanvas(props: CanvasProps) {
  const current = activeMethodBoard(props.library);
  return <CanvasEditor key={[current?.id,props.initialTemplateId,props.initialSelection?.kind,props.initialSelection?.id].join(':')} {...props}/>;
}
function CanvasEditor({initialSelection, initialTemplateId, library, onOpenNote}: CanvasProps) {
  const current = activeMethodBoard(library);
  const board = current?.board ?? blank;
  const [action,setAction] = useState<BoardAction|undefined>(initialTemplateId ? 'templates' : undefined);
  const [drawer,setDrawer] = useState(Boolean(initialSelection));
  const [expanded,setExpanded] = useState(false);
  const [importing,setImporting] = useState(false);
  const [menu,setMenu] = useState(false);
  const [picker, setPicker] = useState<"extract" | "manual" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selection, select] = useState<CanvasSelection>(initialSelection ?? null);
  const [wireFrom, setWireFrom] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [inserted, setInserted] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const notes = useMemo(
    () => {
      const originals = new Map(library.notes.map(note => [note.id,note]));
      return new Map(board.nodes.map(node => {
        const note = originals.get(node.idea?.source?.noteId ?? node.idea?.method?.sourceNote?.id ?? node.noteId);
        const title = node.idea?.title || note?.title || "原笔记已移除";
        const typeLabel = node.idea?.method?.component || (node.idea?.origin === "manual" ? "我的灵感" : node.idea?.origin === "reference" ? "参考资料" : node.idea ? "笔记中的灵感" : "原有笔记");
        return [node.noteId,{title, note, typeLabel}];
      }));
    },
    [library.notes,board.nodes],
  );
  const placed = new Map(board.nodes.map(node => [node.noteId,node]));
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

  async function write(update:(fresh:KnowledgeLibrary)=>void, cleanup=false) {
    setError("");
    setPending(count=>count+1);
    try {
      const result=await mutateKnowledge(fresh=>{
        const before=cleanup ? methodFileIds(fresh) : undefined;
        update(fresh);
        if(cleanup) pruneMethodLinks(fresh);
        if(before?.size) {
          const after=methodFileIds(fresh);
          const removed=[...before].filter(id=>!after.has(id));
          if(removed.length)fresh.orphanedNoteFiles=[...new Set([...(fresh.orphanedNoteFiles??[]),...removed])];
        }
      });
      if(cleanup && result.orphanedNoteFiles?.length) void purgeDeletedNoteFiles().catch(()=>setError("已删除，参考文件将在下次清理。"));
      return result;
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"画布保存失败，请重试。");
    } finally {setPending(count=>count-1);}
  }
  function edit(update:(draft:InspirationBoard,fresh:KnowledgeLibrary)=>void,cleanup=false) {
    if(!current) return Promise.resolve(undefined);
    return write(fresh=>update(editableMethodBoard(fresh,current.id),fresh),cleanup);
  }
  async function importFragment(fragment:InspirationBoard) {
    const result=await edit((draft,fresh)=>{
      for(const node of fragment.nodes) {
        const src=node.idea?.source;
        const origin=src?{id:src.noteId,revision:src.revision}:node.idea?.method?.sourceNote;
        if(origin && !fresh.notes.some(note=>note.id===origin.id && note.revision===origin.revision && !note.archivedAt)) throw Error("导入的笔记已更新，请重新识别。");
      }
      appendMethodFragment(draft,fragment);
    });
    if(result && fragment.nodes[0]) {setInserted(fragment.nodes[0].noteId);selectItem(null);}
    return !!result;
  }
  async function addCards(cards: IdeaCard[], referenceFor?: string) {
    if (!cards.length) return false;
    const result = await edit((draft,fresh) => {
      for (const {id,idea} of cards) {
        if (idea.source && !fresh.notes.some(n => n.id === idea.source!.noteId && n.revision === idea.source!.revision && !n.archivedAt))
          throw Error("提炼后的原笔记有更新，请重新提炼。");
        const prior = placed.get(id)?.idea;
        if (prior && canRefreshInspiration(prior,idea)) {
          const target = draft.nodes.find(node => node.noteId === id);
          if (!target?.idea || target.idea.origin !== "extracted" || target.idea.source?.noteId !== idea.source?.noteId)
            throw Error("画布上的灵感已变化，请重新提炼。");
          if (canRefreshInspiration(target.idea,idea)) {
            if (target.idea.title !== prior.title || target.idea.detail !== prior.detail)
              throw Error("这条灵感刚更新过，请重新提炼。");
            target.idea = idea;
          }
        } else {
          insertInspiration(draft,id,idea);
        }
        if (referenceFor && draft.nodes.some(n => n.noteId === referenceFor)) {
          const link = connectInspirations(draft,referenceFor,id);
          link.label = "参考";
        }
      }
    });
    if (result) {
      selectItem({kind:"note",id:cards[0].id}); setInserted(cards[0].id);
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
    setDrawer(!!item);setMenu(false);
  }
  function connect(from: string, to: string) {
    setWireFrom(null);
    select(null);
    void edit((draft) => {
      connectInspirations(draft, from, to);
    }).then((result) => {
      const link = result && methodBoards(result).find(item=>item.id===current?.id)?.board.links.find(
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
  function tool(icon:IconName,label:string,run:()=>void) {
    return <button type="button" aria-label={label} title={label} onClick={run}><Icon name={icon} size={18}/><span>{label}</span></button>;
  }
  function clear() {selectItem(null);setWireFrom(null);}
  const available=methodBoards(library);
  return (
    <section ref={wrap} className="qd-inspiration" aria-label="灵感逻辑" tabIndex={0} onPaste={current?transfer:undefined} onDrop={current?transfer:undefined}
      onKeyDown={e=>{if(e.key==="Escape" && !(e.target as Element).closest("dialog"))clear();}}
      onDragOver={event => { if (current && event.dataTransfer.types.some(t => ["Files","text/uri-list","text/plain"].includes(t))) event.preventDefault(); }}>
      <div className="qd-logic-board">
        <header className="qd-method-head">
          <div className="qd-method-head-start">
            {current && <label className="qd-board-switch"><Icon name="merge" size={17}/><select aria-label="切换画布" value={current.id} onChange={e=>{const id=e.target.value;void write(fresh=>switchMethodBoard(fresh,id));}}>
              {available.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
            </select><Icon name="chevron-down" size={14}/></label>}
            <button className="qd-method-new" title="新建画布" aria-label="新建画布" onClick={()=>setAction("create")}><Icon name="plus" size={16}/></button>
            {current && <div className="qd-board-menu">
              <button title="画布设置" aria-label="画布设置" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name="sliders" size={16}/></button>
              {menu && <div>{tool("pencil","重命名画布",()=>{setMenu(false);setAction("rename");})}{tool("trash","删除画布",()=>{setMenu(false);setAction("delete");})}</div>}
            </div>}
          </div>
          <div className="qd-method-head-end">
            <button onClick={()=>setAction("templates")}><Icon name="folder" size={16}/><span>方法模板库</span></button>
            {current && <button className="qd-method-save" disabled={!board.nodes.length} onClick={()=>setAction("save")}><Icon name="inbox" size={16}/><span>存为模板</span></button>}
          </div>
        </header>
        {error && <p className="qd-method-error" role="alert">{error}<button aria-label="关闭提示" onClick={()=>setError("")}><Icon name="close" size={14}/></button></p>}
        {current ? <>
        <nav aria-label="画布工具" className="qd-method-rail" data-expanded={expanded}>
          <button aria-label={expanded?"折叠工具栏":"展开工具栏"} aria-expanded={expanded} title={expanded?"折叠工具栏":"展开工具栏"} onClick={()=>setExpanded(!expanded)}><Icon name={expanded?"chevron-left":"chevron-right"} size={16}/><span>画布工具</span></button>
          {tool("plus","新建灵感",()=>setPicker("manual"))}
          {tool("bulb","灵感提炼",()=>setPicker("extract"))}
          {tool("merge","导入方法",()=>setImporting(true))}
          {tool("attachment","加入参考",()=>fileInput.current?.click())}
          {tool("help-circle","画布说明",()=>{select(null);setMenu(false);setDrawer(!drawer || !!selection);})}
        </nav>
        <input ref={fileInput} type="file" multiple hidden onChange={e => { void addReferences(Array.from(e.target.files ?? []),""); e.target.value = ""; }}/>
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
        <div className="qd-method-count" role="status">{pending?"正在保存…":board.nodes.length+" 张卡片 · "+board.links.length+" 条连线"}</div>
        </> : <div className="qd-method-blank"><Icon name="merge" size={28}/><h3>新建你的第一张画布</h3><button className="qd-method-main-action" onClick={()=>setAction("create")}>创建画布</button></div>}
      </div>
      {current && drawer && <aside className="qd-logic-inspector" aria-label="画布说明">
        <header>
          <Icon name={edge ? "link" : selectedNode ? "pencil" : "help-circle"} size={17} />
          <h3>{edge ? "连线说明" : selectedNode ? "卡片详情" : "画布说明"}</h3>
          <button aria-label="关闭说明" onClick={clear}><Icon name="close" size={17}/></button>
        </header>
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
                  },true).then(result=>{if(result)clear();})
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
            {selectedNode.idea && <IdeaCardEditor key={selectedNode.noteId} node={selectedNode} save={async (original,next)=>{
              const saved=await edit(draft=>{
                const target=draft.nodes.find(n=>n.noteId===selectedNode.noteId);
                if(!target?.idea || JSON.stringify(target.idea)!==JSON.stringify(original)) throw Error("卡片刚有变化，请关闭编辑后再试。");
                target.idea=next;
              });
              return Boolean(saved);
            }}/>}
            {board.links
              .filter(
                (link) => link.from === selectedNode.noteId || link.to === selectedNode.noteId,
              )
              .map((link) => (
                <button
                  key={link.id}
                  className="qd-logic-neighbour"
                  onClick={() => selectItem({ kind: "link", id: link.id })}
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
                  void edit((draft) => removeInspiration(draft, selectedNode.noteId),true).then(result => {if(result)clear();})
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
      </aside>}
      {action && <MethodLibraryDialog key={action} initialTemplateId={initialTemplateId} action={action} current={current} library={library} write={write} close={()=>setAction(undefined)}/>}
      {importing && <MethodImportDialog notes={library.notes.filter(n=>!n.archivedAt)} close={()=>setImporting(false)} apply={importFragment}/>}
      {picker && <InspirationPicker notes={library.notes.filter(n => !n.archivedAt)} placed={placed}
        manual={picker === "manual"} add={addCards} close={() => setPicker(null)}/>}
    </section>
  );
}
