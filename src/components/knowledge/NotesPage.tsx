import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { desktopHost } from '../../integration/desktop';
import { fileSize, downloadOutputFile, readOutputBlob } from '../../data/outputFiles';
import {
  KNOWLEDGE_FILES, locateSelection, makeSelection, noteChanges, noteLinks,
  type KnowledgeLibrary, type KnowledgeNote, type NoteExpansion, type NoteSelection,
} from '../../data/knowledgeNotes';
import { mutateKnowledge } from '../../data/knowledgeStore';
import type { OutputAttachment } from '../../data/types';
import { Icon } from '../ui/Icon';
import { NoteWriter, plainNoteBody, type WriterHandle } from './NoteWriter';
import { blankNote, editDraft, flushDraft, isNotePicture, noteDraftSession, syncSavedNote, unpublishedNotes, uploadNoteFiles } from './noteDraft';
import './notes.css';

export type NoteDraft = { text: string; files: File[] };
const asError = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
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
      const host = desktopHost();
      const blob = host?.readKnowledgeImage
        ? new Blob([Uint8Array.from(await host.readKnowledgeImage(noteId, file.id))], { type: file.type })
        : await readOutputBlob(KNOWLEDGE_FILES, file.id);
      if (active) next.set(file.id, URL.createObjectURL(blob));
    })).then(() => { if (active) setUrls(next); });
    return () => { active = false; next.forEach(url => URL.revokeObjectURL(url)); };
  }, [noteId, signature]);
  return urls;
}

function NoteEditor({ note, isSaved, initialDraft, onSaved }: {
  note: KnowledgeNote; isSaved: boolean; initialDraft?: NoteDraft; onSaved: (note: KnowledgeNote) => void;
}) {
  const session = useMemo(() => noteDraftSession(note, isSaved, initialDraft?.text), [note.id]);
  const view = useSyncExternalStore(session.observe, () => session.view);
  const saved = view.saved ?? (isSaved ? note : undefined);
  const [selection, setSelection] = useState<NoteSelection>();
  const [question, setQuestion] = useState('');
  const [usePublicSources, setReadPublic] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const shell = useRef<HTMLElement>(null);
  const writer = useRef<WriterHandle | undefined>(undefined);
  const chooseFiles = useRef<HTMLInputElement>(null);
  const chooseImages = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLInputElement>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const initialFiles = useRef(false);
  const pending = useRef(false);
  const previousRevision = useRef(saved?.revision);
  const currentFiles = saved?.attachments ?? [];
  const loadedImages = useImageUrls(note.id, currentFiles, view.body);
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

  function addFiles(files: File[], inline = false, range?: Range) {
    uploadNoteFiles(session, files, inline ? (file, url, id) => writer.current?.insertPicture(file, url, id, range) : undefined,
      (from, to) => { writer.current?.replacePicture(from, to); });
  }

  useEffect(() => {
    if (initialFiles.current || !initialDraft?.files.length) return;
    initialFiles.current = true;
    addFiles(initialDraft.files, true);
  }, [session, initialDraft]);

  const changeSelection = useCallback((value?: NoteSelection) => setSelection(value), []);
  const editBody = (body: string) => { editDraft(session, { body }); setSelection(undefined); setAsking(false); setMessage(''); };
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

  const ask = () => void action(async () => {
    if (!selection || !question.trim()) return;
    const host = desktopHost();
    if (!host?.expandKnowledge) throw new Error('请在桌面版连接支持分析的 Agent 后提问');
    const latest = await flushDraft(session, true);
    if (!latest) return;
    const at = locateSelection(latest.body, selection);
    if (at === undefined) throw new Error('原文位置有变，请重新选择');
    const anchor = makeSelection(latest.body, at, at + selection.quote.length);
    const result = await host.expandKnowledge({ noteId: latest.id, revision: latest.revision, selection: anchor, question: question.trim(), ...(usePublicSources ? { usePublicSources: true } : {}) });
    await mutateKnowledge(library => {
      const item = library.notes.find(item => item.id === latest.id);
      if (!item || item.revision !== latest.revision) throw new Error('原文已更新，请重新选择后提问');
      item.expansions.push({ id: crypto.randomUUID(), at: new Date().toISOString(), selection: anchor,
        question: question.trim(), answer: result.answer, sourceIds: result.sourceIds, ...(result.sources?.length && { sources: result.sources }) });
    });
    setQuestion(''); setReadPublic(false); setAsking(false);
    if (result.note) setMessage(result.note);
  });

  const importTranscript = (file?: File) => void action(async () => {
    if (!file) return;
    if (file.size > 200000) throw new Error('转写文件过长，请分段导入');
    const text = await file.text();
    if (session.view.body.length + text.length > 49_000) throw new Error('笔记正文过长，请分段导入');
    writer.current?.insertText('\n' + text);
  });

  const inlineId = (file: OutputAttachment) => view.body.includes(`(attachment:${file.id})`);
  const attachments = [...currentFiles, ...view.incoming].filter(file => !inlineId(file));
  const links = noteLinks(view.body);
  const changes = saved ? noteChanges(saved) : [];
  const issue = message || view.error;
  return <section ref={shell} className="qd-note-edit" aria-label="笔记编辑器"
    onBlur={event => {
      if (!event.relatedTarget || !(event.relatedTarget instanceof Node) || shell.current?.contains(event.relatedTarget)) return;
      record();
    }}>
    <header className="qd-note-edit-head">
      <div className="qd-note-title-field">
        <input aria-label="笔记标题" className="qd-note-title" value={view.title === '未命名' ? '' : view.title}
          maxLength={100} placeholder="笔记标题" onChange={event => editDraft(session, { title: event.target.value })} />
        <small className="qd-note-save-state" role="status">
          {issue || (view.saving ? '正在保存…' : view.dirty ? '正在编辑，停顿 30 秒后保存' : saved ? '已保存 · ' + editedAt(saved.updatedAt) : '新笔记')}
        </small>
      </div>
      <button type="button" className="qd-note-share qd-btn ghost" aria-label="分享笔记" title="分享笔记"
        disabled={busy || (!view.title.trim() && !view.body.trim() && !saved?.attachments.length && !view.incoming.length)} onClick={share}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 8H5v13h14V8h-4M12 14V2m-4 4 4-4 4 4"/>
        </svg>
        <span>分享</span>
      </button>
    </header>
    <NoteWriter text={view.body} disabled={busy} imageUrls={imageUrls} draftFiles={(files, range) => addFiles(files, true, range)}
      onEdit={editBody} onSelection={changeSelection} editor={setWriter} onChoosePicture={() => chooseImages.current?.click()}
      onAttach={() => chooseFiles.current?.click()} onTranscript={() => transcript.current?.click()} />
    <input type="file" multiple hidden ref={chooseFiles} aria-label="选择附件"
      onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden ref={chooseImages} aria-label="选择图片"
      onChange={event => { addFiles(Array.from(event.currentTarget.files ?? []), true); event.currentTarget.value = ''; }} />
    <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden ref={transcript} aria-label="选择转写文件"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; importTranscript(file); }} />
    {selection && !asking && <button type="button" className="qd-btn ghost qd-note-ask" onMouseDown={event => event.preventDefault()}
      onClick={() => { setAsking(true); requestAnimationFrame(() => questionField.current?.focus()); }}><Icon name="bulb" size={15} /> 就这段提问</button>}
    {asking && selection && <form className="qd-note-expansion is-prompt" onSubmit={event => { event.preventDefault(); ask(); }}>
      <blockquote>{selection.quote}</blockquote>
      <textarea ref={questionField} aria-label="补充问题" value={question} maxLength={1200} onChange={event => setQuestion(event.target.value)} placeholder="想了解什么？" />
      {links.some(url => url.startsWith('https://')) && <label className="qd-note-read-links">
        <input type="checkbox" checked={usePublicSources} onChange={event => setReadPublic(event.target.checked)} />读取笔记里的公开网页并交给 AI 分析
      </label>}
      <div><button type="submit" className="qd-btn primary" disabled={!question.trim() || busy}>{busy ? '正在补充…' : '问 AI 并追加'}</button>
        <button type="button" className="qd-btn ghost" disabled={busy} onClick={() => { setAsking(false); setQuestion(''); setReadPublic(false); }}>取消</button></div>
    </form>}
    {!!saved?.expansions.length && <div className="qd-note-expansions" aria-label="选段补充">{saved.expansions.map(item =>
      <Expansion key={item.id} item={item} body={view.body} disabled={busy} onJump={() => writer.current?.focusQuote(item.selection.quote)}
        onRemove={() => void action(async () => { await mutateKnowledge(library => {
          const stored = library.notes.find(value => value.id === note.id);
          if (stored) stored.expansions = stored.expansions.filter(value => value.id !== item.id);
        }); })} />)}
    </div>}
    {!!attachments.length && <section className="qd-note-sources" aria-label="附件">
      <h3>附件</h3>
      {attachments.map(file => <button className="qd-note-attachment" type="button" key={file.id}
        onClick={() => void action(async () => { await flushDraft(session); await downloadOutputFile(KNOWLEDGE_FILES, file); })}>
        <Icon name="folder" size={15} /><span>{file.name}</span><small>{fileSize(file.size)}</small>
      </button>)}
    </section>}
    {!!changes.length && <ChangeLog changes={changes} />}
  </section>;
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

function Expansion({ item, body, disabled, onJump, onRemove }: {
  item: NoteExpansion; body: string; disabled: boolean; onJump: () => void; onRemove: () => void;
}) {
  const at = locateSelection(body, item.selection);
  return <section className="qd-note-expansion">
    <div className="qd-expansion-anchor">
      {at === undefined ? <span>原文位置已变化</span> : <button type="button" className="qd-link" onClick={onJump}>查看所选原文</button>}
      <button type="button" className="qd-icon-btn" disabled={disabled} aria-label="移除这条补充" onClick={onRemove}><Icon name="close" size={15} /></button>
    </div>
    <blockquote>{item.selection.quote}</blockquote>
    <strong>{item.question}</strong>
    <p>{item.answer}</p>
    {!!item.sources?.length && <details><summary>查阅来源 · {item.sources.length} 条</summary>
      <ol>{item.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
        <p>{source.excerpt}</p><small>{new Date(source.checkedAt).toLocaleDateString('zh-CN')} 读取</small></li>)}</ol>
    </details>}
  </section>;
}

export function NotesWorkspace({ library, target, initialDraft, error }: { library: KnowledgeLibrary; target?: string | null; initialDraft?: NoteDraft; error?: string }) {
  const [selected, setSelected] = useState<string | undefined>();
  const [staged, setStaged] = useState<{ note: KnowledgeNote; draft?: NoteDraft }>();
  const [latest, setLatest] = useState<KnowledgeNote>();
  const seenDraft = useRef<NoteDraft | undefined>(undefined);
  useEffect(() => {
    if (!initialDraft || seenDraft.current === initialDraft) return;
    seenDraft.current = initialDraft;
    const note = blankNote();
    setSelected(note.id);
    setStaged({ note, draft: initialDraft });
  }, [initialDraft]);
  useEffect(() => { if (target && library.notes.some(note => note.id === target)) setSelected(target); }, [target, library.notes.some(note => note.id === target)]);
  const saved = new Map(library.notes.map(note => [note.id, note]));
  if (latest && !saved.has(latest.id)) saved.set(latest.id, latest);
  const visible = [...saved.values(), ...unpublishedNotes(new Set(saved.keys()))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const chosen = visible.find(note => note.id === selected) ?? (staged && selected === staged.note.id ? staged.note : visible[0]);
  const create = () => {
    const note = blankNote();
    setSelected(note.id);
    setStaged({ note });
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.qd-note-title')?.focus());
  };

  return <>
    <header className="qd-knowledge-head"><h1>帮你记</h1></header>
    {error && <p className="qd-knowledge-message" role="status">{error}</p>}
    <div className="qd-knowledge-split qd-notebook">
      <aside className="qd-knowledge-list" aria-label="笔记列表">
        <div className="qd-knowledge-list-actions"><button className="qd-btn primary" type="button" onClick={create}><Icon name="plus" size={15}/>新建</button></div>
        {visible.length ? <ul>{visible.map(item => <li key={item.id}>
          <button type="button" aria-current={chosen?.id === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}>
            <strong>{item.title}</strong>
            <small>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small>
          </button>
        </li>)}</ul> : <p className="qd-knowledge-list-empty">暂无笔记</p>}
      </aside>
      {chosen ? <NoteEditor key={chosen.id} note={chosen} isSaved={saved.has(chosen.id)}
        initialDraft={staged?.note.id === chosen.id ? staged.draft : undefined} onSaved={setLatest} />
        : <div className="qd-knowledge-empty"><h2>记下一件事</h2><p>一段文字、一张图，或一个链接。</p></div>}
    </div>
  </>;
}
