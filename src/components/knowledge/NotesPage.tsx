import type { NoteTableSizes } from '../../data/noteTableSizes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { NoteWorkspaceAnswer } from './NoteWorkspaceAnswer';
import type { WorkspaceTarget } from '../../data/workspaceQuestion';
import { NoteAnswerBody } from './NoteAnswerBody';
import { desktopHost } from '../../integration/desktop';
import {
  KNOWLEDGE_FILES, makeSelection, locateSelection, questionContext, noteChanges, noteLinks, publicNoteLinks,
  type KnowledgeLibrary, type KnowledgeNote, type NoteExpansion,
} from '../../data/knowledgeNotes';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { addNoteTodo, deleteKnowledgeNote, purgeDeletedNoteFiles, mutateKnowledge, removeNoteTodo, setNoteTodoCompleted } from '../../data/knowledgeStore';
import { noteProgressRows, projectProgressMarks } from './noteProgressRows';
import { noteTodosForBody } from '../../data/noteTodos';
import { NoteTaskDialog, type NoteTaskSource } from './NoteTaskDialog';
import type { OutputAttachment } from '../../data/types';
import { Icon } from '../ui/Icon';
import { useNoteAnnotations } from './useNoteAnnotations';
import { useHomeClock } from '../homepage/homeClock';
import { NoteWriter, plainNoteBody, type WriterHandle } from './NoteWriter';
import { blankNote, discardNoteDraft, noteDraftFiles, editDraft, flushDraft, isNotePicture, noteDraftSession, syncSavedNote, unpublishedNotes, uploadNoteFiles, type DraftSession } from './noteDraft';
import { NoteReceiptMarks, type OpenNoteReceipt } from './NoteReceiptMarks';
import { projectNoteReceipts, unreadReceiptCount, type ReceiptAnchor } from '../../data/noteReceipts';
import type { Snapshot } from '../../data/types';
import type { NoteSelection } from '../../data/knowledgeNotes';
import { NoteReader } from './NoteReader';
import { activeNoteQuestion, askNoteQuestion, noteQuestionBusy, noteQuestionState, pendingNoteAnswer } from './noteQuestion';
import type { QuestionMaterials } from '../../data/knowledgeNotes';
import { NoteSelectionPrompt, NoteFollowUp } from './NoteSelectionPrompt';
import type { SelectedPassage } from './noteSelectionRange';
import { NoteThumbnail, readNotePicture } from './NoteThumbnail';
import './notes.css';
import './note-answer.css';

export type NoteDraft = { text: string; files: File[] };
const asError = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const clockTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const calendarDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
function listDate(value: string, today: Date, yesterday: Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { group: '更早', label: '日期未知' };
  if (date.toDateString() === today.toDateString()) return { group: '今天', label: clockTime.format(date) };
  if (date.toDateString() === yesterday.toDateString()) return { group: '昨天', label: clockTime.format(date) };
  return { group: '更早', label: (today.getFullYear() === date.getFullYear() ? calendarDate : fullDate).format(date) };
}
const editedAt = (at: string) => new Date(at).toLocaleString('zh-CN');
const fileStamp = (files: OutputAttachment[]) => files.map(file => file.id).join('|');

function useImageUrls(noteId: string, files: OutputAttachment[], body: string) {
  const needed = useMemo(() => {
    const ids = new Set(Array.from(body.matchAll(/\(attachment:([0-9a-z-]+)\)/gi), match => match[1]));
    return files.filter(file => isNotePicture(file) && ids.has(file.id));
  }, [body, fileStamp(files)]);
  const signature = fileStamp(needed);
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    let active = true;
    void Promise.allSettled(needed.map(async file => {
      const blob = await readNotePicture(noteId, file);
      if (active) next.set(file.id, URL.createObjectURL(blob));
    })).then(() => { if (active) setUrls(next); });
    return () => { active = false; next.forEach(url => URL.revokeObjectURL(url)); };
  }, [noteId, signature]);
  return urls;
}

function NoteEditor({ note, library, onOpenWorkspaceSource, projects, isSaved, initialDraft, onSaved, targetTodo, targetLine, quote, selection, receiptAnchors, onOpenReceipt }: {
  library:KnowledgeLibrary; onOpenWorkspaceSource:(target:WorkspaceTarget)=>void;
  selection?: NoteSelection; receiptAnchors?: ReceiptAnchor[]; onOpenReceipt: OpenNoteReceipt;
  note: KnowledgeNote; projects: Snapshot[]; isSaved: boolean; initialDraft?: NoteDraft; targetTodo?: string; targetLine?: number; quote?: string; onSaved: (note: KnowledgeNote) => void;
}) {
  const session = useMemo(() => noteDraftSession(note, isSaved, initialDraft?.text), [note.id]);
  const view = useSyncExternalStore(session.observe, () => session.view);
  const saved = view.saved ?? (isSaved ? note : undefined);
  const asking = useSyncExternalStore(session.observe, () => noteQuestionBusy(session));
  const pendingAnswer = useSyncExternalStore(session.observe, () => pendingNoteAnswer(session));
  const storedAnswers = isSaved ? note.expansions : saved?.expansions;
  const expansions = useMemo(() => pendingAnswer && !storedAnswers?.some(item => item.id === pendingAnswer.id)
    ? [...(storedAnswers ?? []), pendingAnswer] : storedAnswers ?? [], [storedAnswers, pendingAnswer]);
  const [passage, setPassage] = useState<SelectedPassage>();
  const [followUpTarget,followUp]=useState<NoteExpansion>();
  const [taskSource, setTaskSource] = useState<NoteTaskSource>();
  const todos = useMemo(() => noteTodosForBody(isSaved ? note : saved ?? note, view.body), [isSaved, note, saved, view.body]);
  const projectMarks = useMemo(()=>projectProgressMarks(note.id,projects),[note.id,projects]);
  const progressRows = useMemo(()=>noteProgressRows(todos,view.body,projectMarks),[todos,view.body,projectMarks]);
  const inlineTodos = useMemo(() => todos.filter(todo => !todo.follows), [todos]);
  const childTarget = targetTodo && todos.find(todo => todo.id === targetTodo && todo.follows);
  const inlineTarget = childTarget ? inlineTodos.find(todo => todo.lineIndex === childTarget.lineIndex)?.id : targetTodo;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const shell = useRef<HTMLElement>(null);
  const writer = useRef<WriterHandle | undefined>(undefined);
  const chooseFiles = useRef<HTMLInputElement>(null);
  const chooseImages = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLInputElement>(null);
  const initialFiles = useRef(false);
  const pending = useRef(false);
  const previousRevision = useRef(saved?.revision);
  const localBody = useRef<string | undefined>(undefined);
  const [indexedBody, setIndexedBody] = useState(view.body);
  const sourceBody = localBody.current === view.body ? indexedBody : view.body;
  useEffect(() => {
    if (indexedBody === view.body) return;
    if (localBody.current !== view.body) { setIndexedBody(view.body); return; }
    const timer = window.setTimeout(() => setIndexedBody(view.body), 350);
    return () => window.clearTimeout(timer);
  }, [view.body, indexedBody]);
  const refreshIndex = useCallback(() => {
    if (sourceBody !== view.body) flushSync(() => setIndexedBody(view.body));
  }, [sourceBody, view.body]);
  const questionAnchor = useSyncExternalStore(session.observe, () => activeNoteQuestion(session));
  const answerAnchors = useMemo(() => questionAnchor ? [...expansions,questionAnchor] : expansions,[expansions,questionAnchor]);
  useNoteAnnotations(shell, sourceBody, answerAnchors);
  const currentFiles = saved?.attachments ?? [];
  const imageReferences = [view.body, ...expansions.map(item => item.answer)].join('\n');
  const loadedImages = useImageUrls(note.id, currentFiles, imageReferences);
  const imageUrls = useMemo(() => new Map([...session.previews, ...loadedImages]), [session, view, loadedImages]);

  useEffect(() => {
    if (isSaved) syncSavedNote(session, note);
  }, [isSaved, note, session]);

  useEffect(() => {
    if (view.saved && view.saved.revision !== previousRevision.current) {
      previousRevision.current = view.saved.revision;
      onSaved(view.saved);
    }
  }, [view.saved, onSaved]);

  const record = useCallback(() => void flushDraft(session, true).catch(() => {}), [session]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') record(); };
    window.addEventListener('pagehide', record);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', record);
      document.removeEventListener('visibilitychange', hidden);
      record();
    };
  }, [record]);

  function addFiles(files: File[], range?: Range) {
    let next = range;
    uploadNoteFiles(session, files, (file, url, id) => {
      next = writer.current?.insertFile(file, url, id, next);
    }, (from, to) => { writer.current?.replaceFile(from, to); });
  }

  useEffect(() => {
    if (initialFiles.current || !initialDraft?.files.length) return;
    initialFiles.current = true;
    addFiles(initialDraft.files);
  }, [session, initialDraft]);

  const dismissPassage = useCallback(() => setPassage(undefined), []);
  const editBody = (body: string, tableSizes?: NoteTableSizes) => { localBody.current = body; editDraft(session, { body, tableSizes }); dismissPassage(); setMessage(''); };
  const setWriter = (handle: WriterHandle) => { writer.current = handle; };

  async function action(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try { await operation(); }
    catch (error) { setMessage(asError(error)); }
    finally { pending.current = false; setBusy(false); }
  }

  async function savedLine(index: number) {
    const expected = session.view.body.split('\n')[index];
    const latest = await flushDraft(session, true);
    const storedLine = latest?.body.split('\n')[index];
    // A line may contain both pictures and documents. Resolve only this session's
    // upload tokens so a different file, changed label or action still fails.
    const finalized = expected?.replace(/\(attachment:(pending-[0-9a-f-]+)\)/gi, (reference, id: string) =>
      session.uploadedIds.has(id) ? '(attachment:' + session.uploadedIds.get(id) + ')' : reference);
    if (!latest || !expected?.trim() || storedLine !== finalized) throw new Error('原行已变化，请重新选择');
    return latest;
  }
  const addTodo = (index: number) => void action(async () => {
    const latest = await savedLine(index);
    await addNoteTodo(latest.id, index, latest.body);
  });
  const sendLine = (lineIndex: number, text: string) => void action(async () => {
    const latest = await savedLine(lineIndex);
    const lines = latest.body.split('\n');
    const offset = lines.slice(0,lineIndex).reduce((total,line) => total + line.length + 1, 0);
    setTaskSource({ noteId: latest.id, noteTitle: latest.title, text, lineIndex, selection:makeSelection(latest.body,offset,offset + lines[lineIndex].length),
      todoId: latest.todos?.find(todo => todo.lineIndex === lineIndex)?.id });
  });

  const sendSelection = (settings = false) => void action(async () => {
    if (!passage) return;
    const latest = await flushDraft(session, true);
    if (!latest) throw new Error('请先保存选段');
    const at = latest.body === view.body && latest.body.slice(passage.selection.offset, passage.selection.offset + passage.selection.quote.length) === passage.selection.quote
      ? passage.selection.offset : locateSelection(latest.body, passage.selection);
    if (at === undefined) throw new Error('原文位置已变，请重新选择');
    const selection = makeSelection(latest.body, at, at + passage.selection.quote.length);
    const lineIndex = latest.body.slice(0,at).split('\n').length - 1;
    const fullLine = selection.quote === latest.body.split('\n')[lineIndex];
    setTaskSource({noteId:latest.id,noteTitle:latest.title,text:selection.quote,lineIndex,selection,selected:true,settings,
      todoId:fullLine ? latest.todos?.find(item => item.lineIndex === lineIndex)?.id : undefined});
    dismissPassage();
  });

  const share = () => void action(async () => {
    const latest = await flushDraft(session, true);
    const title = latest?.title ?? view.title;
    const text = [plainNoteBody(latest?.body ?? view.body),
      ...((latest?.expansions ?? []).flatMap(item => ['', item.question, item.answer]))].join('\n').trim();
    const data = { title, text, noteId: latest?.id };
    if (await desktopHost()?.shareKnowledgeNote?.(data)) return;
    if (navigator.share && (!navigator.canShare || navigator.canShare({ title, text }))) {
      try { await navigator.share({ title, text }); return; }
      catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
    }
    await navigator.clipboard.writeText([title, text].filter(Boolean).join('\n\n'));
    setMessage('已复制笔记');
  });

  function openSource(target:WorkspaceTarget) {
    if(target.page==='notes'){
      const original=target.id===note.id?{...note,body:session.view.body}:library.notes.find(n=>n.id===target.id);
      if(!original){setMessage('这篇原笔记已删除');return;}
      if(target.selection && locateSelection(original.body,target.selection)===undefined){
        setMessage('这段原文已修改，暂时无法定位');return;
      }
    }
    onOpenWorkspaceSource(target);
  }

  function workspaceSource(selection:NoteSelection) {
    const current={...note,body:session.view.body,title:session.view.title};
    return {projects, noteId:note.id, selection, library:{...library,notes:[current,...library.notes.filter(n=>n.id!==current.id)]}};
  }

  function ask(question: string, usePublicSources: boolean, materials:QuestionMaterials) {
    if (!passage || !question.trim() || asking) return;
    askNoteQuestion(session, passage.selection, passage.label, question, usePublicSources ? links : undefined,materials,undefined,workspaceSource(passage.selection));
    dismissPassage();
  }

  const importTranscript = (file?: File) => void action(async () => {
    if (!file) return;
    if (file.size > 200000) throw new Error('转写文件过长，请分段导入');
    const text = await file.text();
    if (session.view.body.length + text.length > 49_000) throw new Error('笔记正文过长，请分段导入');
    writer.current?.insertText('\n' + text);
  });

  const hasSelection = !!passage;
  const links = useMemo(() => hasSelection ? publicNoteLinks(view.body) : [], [hasSelection, view.body]);
  const changes = useMemo(() => saved ? noteChanges(saved) : [], [saved]);
  const issue = message || view.error;
  return <section ref={shell} className="qd-note-edit" aria-label="笔记编辑器"
    onBlur={event => {
      if (!event.relatedTarget || !(event.relatedTarget instanceof Node) || shell.current?.contains(event.relatedTarget)) return;
      record();
    }}>
    <NoteWriter progressRows={progressRows} focusOnMount={!isSaved} text={view.body} indexedText={sourceBody} refreshIndex={refreshIndex} disabled={busy} imageUrls={imageUrls} draftFiles={addFiles}
      noteId={note.id} uploadedIds={session.uploadedIds} files={currentFiles} incoming={view.incoming}
      todos={inlineTodos} targetTodo={inlineTarget} targetLine={targetLine} targetQuote={quote} targetSelection={selection} onAddTodo={addTodo} onSendLine={sendLine}
      onRemoveTodo={id => void action(() => removeNoteTodo(note.id, id))}
      onCompleteTodo={(id, completed) => void action(() => setNoteTodoCompleted(note.id, id, completed))}
      tableSizes={view.tableSizes} onEdit={editBody} onSelection={setPassage} editor={setWriter} onChoosePicture={() => chooseImages.current?.click()}
      onAttach={() => chooseFiles.current?.click()} onTranscript={() => transcript.current?.click()}>
      <header className="qd-note-edit-head">
        <div className="qd-note-title-field">
          <input aria-label="笔记标题" className="qd-note-title" value={view.title === '未命名' ? '' : view.title}
            maxLength={100} placeholder="笔记标题" onChange={event => editDraft(session, { title: event.target.value })} />
          <small className="qd-note-save-state" role="status">
            {issue || (view.saving ? '正在保存…' : view.dirty ? '正在编辑，停顿 30 秒后保存' : saved ? '已保存 · ' + editedAt(saved.updatedAt) : '新笔记')}
          </small>
        </div>
        <NoteReader tableSizes={view.tableSizes} noteId={note.id} title={view.title} body={view.body}
          files={currentFiles} incoming={view.incoming} imageUrls={imageUrls} expansions={expansions} />
        <button type="button" className="qd-note-share" aria-label="分享笔记" title="分享笔记"
          disabled={busy || (!view.title.trim() && !view.body.trim() && !saved?.attachments.length && !view.incoming.length)} onClick={share}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 8H5v13h14V8h-4M12 14V2m-4 4 4-4 4 4"/>
          </svg>
        </button>
      </header>
    </NoteWriter>
    {!!receiptAnchors?.length && <NoteReceiptMarks sheet={shell} body={sourceBody} indexed={sourceBody===view.body} noteId={note.id} anchors={receiptAnchors} read={note.readReceiptIds} onOpen={onOpenReceipt}/> }
    <input type="file" multiple hidden ref={chooseFiles} aria-label="选择附件"
      onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden ref={chooseImages} aria-label="选择图片"
      onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden ref={transcript} aria-label="选择转写文件"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; importTranscript(file); }} />
    {followUpTarget && <NoteFollowUp answer={followUpTarget} onDismiss={()=>followUp(undefined)} onAsk={(question,materials)=>{
      askNoteQuestion(session,followUpTarget.selection,followUpTarget.selection.quote,question,undefined,materials,followUpTarget.id,workspaceSource(followUpTarget.selection));
      followUp(undefined);
    }}/>}
    {taskSource && <NoteTaskDialog source={taskSource} onOpenTask={onOpenReceipt} onClose={() => setTaskSource(undefined)} />}
    {passage && !asking && <NoteSelectionPrompt passage={passage} surrounding={questionContext(view.title,view.body,passage.selection)} busy={busy} error={message}
      hasPublicLinks={links.length > 0} onSend={sendSelection} onDismiss={dismissPassage} onAsk={ask}/>}
    {(expansions.length>0 || questionAnchor) && <div className="qd-note-expansions" aria-label="选段补充">
      {questionAnchor && <section className="qd-note-expansion" data-answer-id={questionAnchor.id}>
        <header className="qd-answer-heading"><Icon name="bulb" size={16}/><strong>{questionAnchor.question}</strong></header>
        <NoteAnswerStatus session={session} imageUrls={imageUrls}/>
      </section>}
      {expansions.map(item =>
      <Expansion onOpenSource={openSource} key={item.id} item={item} onFollowUp={()=>followUp(item)} body={view.body} imageUrls={imageUrls} disabled={busy || item.id === pendingAnswer?.id} onJump={() => writer.current?.focusQuote(item.selection)}
        onRemove={() => void action(async () => { await mutateKnowledge(library => {
          const stored = library.notes.find(value => value.id === note.id);
          if (stored) stored.expansions = stored.expansions.filter(value => value.id !== item.id);
        }); })} />)}
    </div>}
    {!!changes.length && <ChangeLog changes={changes} />}
  </section>;
}

function NoteAnswerStatus({ session,imageUrls }: {session:DraftSession;imageUrls:ReadonlyMap<string,string>}) {
  const state = useSyncExternalStore(session.observe, () => noteQuestionState(session));
  if (!state) return null;
  if (state.status === 'failed') return <div role="alert">{state.message} <button type="button" className="qd-link" onClick={state.retry}>{state.answer ? '重试保存' : '重试提问'}</button></div>;
  if (state.status !== 'waiting') return null;
  return <><small className="qd-note-question-status" role="status">{state.stage === 'reconnecting' ? '正在重新连接' : state.text ? '正在回答' : '等待回答'}<AnswerElapsed since={state.since}/></small>
    {state.text && <NoteAnswerBody text={state.text} imageUrls={imageUrls}/>}</>;
}

function AnswerElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - since) / 1000);
  return seconds >= 5 ? <span aria-hidden="true"> · {seconds} 秒</span> : null;
}

function ChangeLog({ changes }: { changes: ReturnType<typeof noteChanges> }) {
  const [open, setOpen] = useState(false);
  return <details className="qd-note-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>改动记录</summary>
    {open && <div className="qd-note-change-scroll"><table aria-label="笔记改动记录">
      <thead><tr><th scope="col">时间</th><th scope="col">位置</th><th scope="col">操作</th><th scope="col">改动前</th><th scope="col">改动后</th></tr></thead>
      <tbody>{changes.slice().reverse().map(({ at, field, before, after }, index) => <tr key={at + ':' + index}>
        <td><time dateTime={at}>{editedAt(at)}</time></td><td>{field}</td><td>{!before ? '增加' : !after ? '删除' : '修改'}</td>
        <td>{before ? plainNoteBody(before) : '—'}</td><td>{after ? plainNoteBody(after) : '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </details>;
}

function Expansion({ item, onOpenSource, body, imageUrls, disabled, onJump, onRemove, onFollowUp }: {
  onOpenSource:(target:WorkspaceTarget)=>void;
  onFollowUp: () => void;
  item: NoteExpansion; body: string; imageUrls: ReadonlyMap<string, string>; disabled: boolean; onJump: () => void; onRemove: () => void;
}) {
  const at = locateSelection(body, item.selection);
  const inlineQuery = item.workspace && at !== undefined && plainNoteBody(item.selection.quote).trim() === item.question.trim();
  return <section className="qd-note-expansion" data-answer-id={item.id} data-inline-query={inlineQuery || undefined}>
    <header className="qd-answer-heading"><Icon name="bulb" size={17}/><strong>{item.question}</strong>
      <button type="button" className="qd-icon-btn" disabled={disabled} aria-label="移除这条补充" onClick={onRemove}><Icon name="close" size={15} /></button></header>
    <div className="qd-expansion-anchor">
      {at === undefined ? <span>原文位置已变化</span> : <button type="button" className="qd-link" onClick={onJump}>查看所选原文</button>}
      <blockquote data-answer-quote>{plainNoteBody(item.selection.quote)}</blockquote>
    </div>
    {[...(item.workspace?[item.workspace]:[]),...(item.additionalReads??[])].map((read,i)=><NoteWorkspaceAnswer key={i} result={read} onOpen={onOpenSource}/>)}
    {item.workspace?.area==='notes' && item.workspace.rule?.startsWith('检查了') ?
      <details><summary>查看 Agent 解读</summary><NoteAnswerBody text={item.answer} imageUrls={imageUrls}/></details>
      : <NoteAnswerBody text={item.answer} imageUrls={imageUrls}/>}
    <footer><button type="button" className="qd-link" disabled={disabled} onClick={onFollowUp}>追问</button>{item.conversationMode === 'replayed' && <small> · 已带入此前问答</small>}</footer>
    {!!item.sources?.length && <details className="qd-web-evidence"><summary>查阅来源 · {item.sources.length} 条</summary>
      <ol>{item.sources.map((source,index) => <li key={source.url+'-'+index}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.label && <small> · {source.label}</small>}
        <p>{source.excerpt}</p><small>{new Date(source.checkedAt).toLocaleDateString('zh-CN')} 读取</small></li>)}</ol>
    </details>}
    {!!item.unreadSources?.length && <details className="qd-web-evidence is-unread"><summary>未核实 · {item.unreadSources.length} 条</summary>
      <ul>{item.unreadSources.map((source,index) => <li key={index}>
        {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a> : <strong>{source.label}</strong>}
        <p>{source.reason}</p>
      </li>)}</ul>
    </details>}
  </section>;
}

function ReceiptBadge({count}:{count:number}) {
  return count > 0 ? <span className="qnr-badge" aria-label={count+'条未读回执'}>{count>99?'99+':count}</span> : null;
}

export function NotesWorkspace({ library, onOpenWorkspaceSource, target, todoId, lineIndex, quote, selection, initialDraft, error, projects, onOpenReceipt }: { onOpenWorkspaceSource:(target:WorkspaceTarget)=>void; selection?: NoteSelection; projects: Snapshot[]; onOpenReceipt: OpenNoteReceipt; library: KnowledgeLibrary; target?: string | null; todoId?: string; lineIndex?: number; quote?: string; initialDraft?: NoteDraft; error?: string }) {
  const [selected, setSelected] = useState<string | undefined>();
  const [staged, setStaged] = useState<{ note: KnowledgeNote; draft?: NoteDraft }>();
  const [latest, setLatest] = useState<KnowledgeNote>();
  const [firstSheet,setFirstSheet] = useState(blankNote);
  const [,refreshDraftList]=useState(0);
  useEffect(()=>{
    const changed=()=>refreshDraftList(value=>value+1);
    window.addEventListener('quandeck:note-draft-list',changed);
    return ()=>window.removeEventListener('quandeck:note-draft-list',changed);
  },[]);
  const [deleting,setDeleting]=useState<KnowledgeNote>();
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteError,setDeleteError]=useState('');
  const [cleanupError,setCleanupError]=useState(false);
  const deletionIds=useMemo(()=>new Set(library.deletedNoteIds),[library.deletedNoteIds]);
  const seenDeletions=useRef(new Set<string>());
  useLayoutEffect(()=>{
    for(const id of deletionIds) if(!seenDeletions.current.has(id)){
      seenDeletions.current.add(id);
      const pending=noteDraftFiles(id);
      if(pending.length) void deleteKnowledgeNote(id,pending).catch(()=>setCleanupError(true));
      discardNoteDraft(id);
    }
    if(deletionIds.has(firstSheet.id)) setFirstSheet(blankNote());
  },[deletionIds,firstSheet.id]);
  const cleanup=useCallback(()=>{setCleanupError(false);void purgeDeletedNoteFiles().catch(()=>setCleanupError(true));},[]);
  const cleanupKey=JSON.stringify(library.orphanedNoteFiles??[]);
  useEffect(()=>{if(cleanupKey!=='[]') cleanup();},[cleanupKey,cleanup]);
  async function confirmDelete(){
    if(!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteKnowledgeNote(deleting.id,noteDraftFiles(deleting.id));
      discardNoteDraft(deleting.id);
      if(latest?.id===deleting.id) setLatest(undefined);
      if(staged?.note.id===deleting.id) setStaged(undefined);
      if(selected===deleting.id) setSelected(undefined);
      setDeleting(undefined);
    } catch(error){setDeleteError(asError(error));}
    finally {setDeleteBusy(false);}
  }
  const [filter, setFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const filterField = useRef<HTMLInputElement>(null);
  const today = useHomeClock();
  const receipts = useMemo(() => projectNoteReceipts(projects,library.notes,today.getTime()),[projects,library.notes,today]);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const seenDraft = useRef<NoteDraft | undefined>(undefined);
  useLayoutEffect(() => {
    if (!initialDraft || seenDraft.current === initialDraft) return;
    seenDraft.current = initialDraft;
    const note = blankNote();
    setSelected(note.id);
    setStaged({ note, draft: initialDraft });
  }, [initialDraft]);
  useEffect(() => { if (target && library.notes.some(note => note.id === target)) setSelected(target); }, [target, selection, todoId, lineIndex, quote, library.notes.some(note => note.id === target)]);
  const saved = new Map(library.notes.map(note => [note.id, note]));
  if (latest && !deletionIds.has(latest.id) && !saved.has(latest.id)) saved.set(latest.id, latest);
  const visible = [...saved.values(), ...unpublishedNotes(new Set([...saved.keys(),...deletionIds]))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const chosen = visible.find(note => note.id === selected) ?? (staged && !deletionIds.has(staged.note.id) && selected === staged.note.id ? staged.note : visible[0]) ?? firstSheet;
  const create = () => {
    setFilter('');
    const note = blankNote();
    setSelected(note.id);
    setStaged({ note });
  };

  const query = filter.trim().toLocaleLowerCase();
  const entries = visible.filter(note => !query || note.title.toLocaleLowerCase().includes(query) ||
    note.body.toLocaleLowerCase().includes(query)).map(note => ({ note, ...listDate(note.updatedAt, today, yesterday) }));
  return <>
    {error && <p className="qd-knowledge-message" role="status">{error}</p>}
    {cleanupError && <p role="status" className="qd-knowledge-message">笔记附件尚未清理完。 <button type="button" onClick={cleanup}>重试清理</button></p>}
    {deleting && <ConfirmDialog title={'删除「'+deleting.title+'」？'}
      text="这篇笔记、待办提醒、关联的灵感与笔记附件将一起删除。已发到项目的独立任务和其他笔记共用的附件会保留。"
      confirmLabel="删除笔记" onConfirm={()=>void confirmDelete()} onClose={()=>{if(!deleteBusy)setDeleting(undefined);}} busy={deleteBusy} error={deleteError}/>}
    <div className="qd-knowledge-split qd-notebook">
      <aside className="qd-knowledge-list" aria-label="笔记列表">
        <header className="qd-notes-list-actions">
          <button className="qd-btn primary" type="button" onClick={create}><Icon name="plus" size={16}/>新建</button>
          <button type="button" className="qd-icon-btn" aria-expanded={searchOpen} aria-label="搜索笔记" title="搜索笔记"
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen) setFilter('');
              else requestAnimationFrame(() => filterField.current?.focus());
            }}><Icon name="search" size={19}/></button>
        </header>
        {searchOpen && <input ref={filterField} className="qd-note-filter" type="search" aria-label="筛选笔记" placeholder="搜索标题或正文"
          value={filter} onChange={event => setFilter(event.target.value)} onKeyDown={event => {
            if (event.key === 'Escape') { setSearchOpen(false); setFilter(''); }
          }} />}
        {entries.length ? <ul>{entries.map(({note: item, group, label}, index) => <li key={item.id}>
          {(index === 0 || group !== entries[index - 1].group) && <h3 className="qd-note-group">{group}</h3>}
          <div className="qd-note-list-row">
          <button type="button" aria-current={chosen.id === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}>
            <NoteThumbnail note={item} icon={noteLinks(item.body).length ? 'link' : 'pencil'}/>
            <strong className="qnr-note-name"><span>{item.title}</span><ReceiptBadge count={unreadReceiptCount(receipts.get(item.id),item.readReceiptIds)}/></strong>
            <small><time dateTime={item.updatedAt}>{label}</time></small>
          </button>
          <button type="button" className="qd-note-delete" aria-label="删除笔记" title="删除笔记"
            onClick={()=>{setDeleteError('');setDeleting(item);}}><Icon name="trash" size={16}/></button>
          </div>
        </li>)}</ul> : <p className="qd-knowledge-list-empty">{query ? '没有匹配的笔记' : '写下第一篇笔记，就会出现在这里。'}</p>}
      </aside>
      <NoteEditor library={library} onOpenWorkspaceSource={onOpenWorkspaceSource} projects={projects} key={chosen.id} receiptAnchors={receipts.get(chosen.id)} onOpenReceipt={onOpenReceipt} selection={chosen.id === target ? selection : undefined} targetTodo={chosen.id === target ? todoId : undefined} targetLine={chosen.id === target ? lineIndex : undefined} quote={chosen.id === target ? quote : undefined} note={chosen} isSaved={saved.has(chosen.id)}
        initialDraft={staged?.note.id === chosen.id ? staged.draft : undefined} onSaved={setLatest} />
    </div>
  </>;
}
