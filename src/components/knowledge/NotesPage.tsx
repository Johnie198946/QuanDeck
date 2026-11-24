import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { desktopHost } from '../../integration/desktop';
import { fileSize, downloadOutputFile, saveOutputFile, readOutputBlob, removeOutputFile } from '../../data/outputFiles';
import {
  KNOWLEDGE_FILES, locateSelection, makeSelection, noteLinks, updateNote,
  type KnowledgeLibrary, type KnowledgeNote, type NoteExpansion, type NoteSelection,
} from '../../data/knowledgeNotes';
import { mutateKnowledge } from '../../data/knowledgeStore';
import type { OutputAttachment } from '../../data/types';
import { Icon } from '../ui/Icon';

const blankNote = (): KnowledgeNote => {
  const at = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '未命名', body: '', createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] };
};
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

function NotePicture({ noteId, file }: { noteId: string; file: OutputAttachment }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = '', live = true;
    const host = desktopHost();
    const load = host?.readKnowledgeImage ? host.readKnowledgeImage(noteId, file.id).then(bytes => new Blob([Uint8Array.from(bytes)], { type: file.type })) : readOutputBlob(KNOWLEDGE_FILES, file.id);
    load.then(blob => { if (!live) return; current = URL.createObjectURL(blob); setUrl(current); }).catch(() => {});
    return () => { live = false; if (current) URL.revokeObjectURL(current); };
  }, [noteId, file.id, file.type]);
  return url ? <img src={url} alt={file.name} loading="lazy" /> : null;
}

export type NoteDraft = { text: string; files: File[] };

function NoteEditor({ note, pendingDraft, onDraftSaved, onError }: { note: KnowledgeNote | undefined; pendingDraft?: NoteDraft; onDraftSaved: (note: KnowledgeNote) => void; onError: (text: string) => void }) {
  const [title, setTitle] = useState(pendingDraft ? '' : note?.title ?? '');
  const [pendingFiles, setPendingFiles] = useState(() => pendingDraft?.files ?? []);
  const [body, setBody] = useState(pendingDraft?.text ?? note?.body ?? '');
  const [baseline, setBaseline] = useState(() => ({ title: note?.title ?? '', body: note?.body ?? '', revision: note?.revision }));
  const [selection, setSelection] = useState<NoteSelection>();
  const [question, setQuestion] = useState('');
  const [readPublic, setReadPublic] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const original = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLInputElement>(null);
  const quoteField = useRef<HTMLTextAreaElement>(null);
  const pendingAnchor = useRef<{ at: number; length: number } | undefined>(undefined);
  const submitting = useRef(false);
  const changed = pendingDraft ? !!(title.trim() || body.trim() || pendingFiles.length) : body !== baseline.body || title !== baseline.title;

  useEffect(() => {
    if (reading || !pendingAnchor.current || !original.current) return;
    const { at, length } = pendingAnchor.current;
    pendingAnchor.current = undefined;
    original.current.focus();
    original.current.setSelectionRange(at, at + length);
    setSelection(makeSelection(body, at, at + length));
  }, [reading]);

  useEffect(() => {
    if (note?.revision === baseline.revision || changed) return;
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setBaseline({ title: note?.title ?? '', body: note?.body ?? '', revision: note?.revision });
  }, [note?.revision, changed, baseline.revision]);

  async function action(operation: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    onError('');
    try { await operation(); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); submitting.current = false; }
  }

  async function save() {
    if (!note) throw new Error('请先新建笔记');
    let saved: KnowledgeNote | undefined;
    if (pendingDraft) {
      const storedFiles: OutputAttachment[] = [];
      try {
        if (pendingFiles.length > 20) throw new Error('每条笔记最多保存 20 个附件');
        for (const file of pendingFiles) storedFiles.push(await saveOutputFile(KNOWLEDGE_FILES, file));
        saved = { ...updateNote(note, { title, body }, new Date().toISOString()), attachments: storedFiles };
        await mutateKnowledge(library => { library.notes.push(saved!); });
        setTitle(saved.title);
        setBaseline({ title: saved.title, body: saved.body, revision: saved.revision });
        setPendingFiles([]);
        onDraftSaved(saved);
        return saved;
      } catch (error) {
        await Promise.allSettled(storedFiles.map(file => removeOutputFile(KNOWLEDGE_FILES, file.id)));
        throw error;
      }
    }
    await mutateKnowledge(library => {
      const index = library.notes.findIndex(item => item.id === note.id);
      if (index < 0) throw new Error('没有找到笔记');
      const current = library.notes[index];
      if (baseline.revision !== current.revision) throw new Error('这条笔记已在其他窗口更新，请重新打开后保存');
      saved = updateNote(current, { title, body }, new Date().toISOString());
      library.notes[index] = saved;
    });
    setTitle(saved!.title);
    setBaseline({ title: saved!.title, body: saved!.body, revision: saved!.revision });
    return saved!;
  }

  const ask = () => void action(async () => {
    if (!note || !selection || !question.trim()) return;
    const host = desktopHost();
    if (!host?.expandKnowledge) throw new Error('请在桌面版连接支持分析的 Agent 后提问');
    const saved = await save();
    const at = locateSelection(saved.body, selection);
    if (at === undefined) throw new Error('原文位置有变，请重新选择');
    const anchor = makeSelection(saved.body, at, at + selection.quote.length);
    const result = await host.expandKnowledge({ noteId: saved.id, revision: saved.revision, selection: anchor, question: question.trim(), ...(readPublic ? { usePublicSources: true } : {}) });
    await mutateKnowledge(library => {
      const item = library.notes.find(item => item.id === saved.id && !item.archivedAt);
      if (!item || item.revision !== saved.revision) throw new Error('原文已更新，请重新选择后提问');
      item.expansions.push({ id: crypto.randomUUID(), at: new Date().toISOString(), selection: anchor,
        question: question.trim(), answer: result.answer, sourceIds: result.sourceIds, ...(result.sources?.length && { sources: result.sources }) });
    });
    setQuestion('');
    setReadPublic(false);
    setAsking(false);
    setReading(true);
    if (result.note) onError(result.note);
  });

  const attach = (incoming: File[]) => void action(async () => {
    if (!note || !incoming.length) return;
    if (pendingDraft) {
      if (pendingFiles.length + incoming.length > 20) throw new Error('每条笔记最多保存 20 个附件');
      setPendingFiles(previous => [...previous, ...incoming]);
      return;
    }
    if (incoming.length + note.attachments.length > 20) throw new Error('每条笔记最多保存 20 个附件');
    const uploaded: OutputAttachment[] = [];
    try {
      for (const file of incoming) uploaded.push(await saveOutputFile(KNOWLEDGE_FILES, file));
      await mutateKnowledge(library => {
        const item = library.notes.find(item => item.id === note.id && !item.archivedAt);
        if (!item || item.attachments.length + uploaded.length > 20) throw new Error('笔记已归档或附件达到 20 个');
        item.attachments.push(...uploaded);
      });
    } catch (error) {
      await Promise.allSettled(uploaded.map(file => removeOutputFile(KNOWLEDGE_FILES, file.id)));
      throw error;
    }
  });

  const restoreHistory = (version: { title: string; body: string }) => {
    setTitle(version.title);
    setBody(version.body);
    setSelection(undefined);
    setReading(false);
  };

  const exportNote = () => {
    if (!note) return;
    const markdown = [title, '', body, ...note.expansions.flatMap(item => ['', '> ' + item.selection.quote, item.question, item.answer])].join('\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) + '.md';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const selectionChanged = () => {
    const node = original.current;
    if (!node || node.selectionStart === node.selectionEnd) return;
    const anchor = makeSelection(body, node.selectionStart, node.selectionEnd);
    setSelection(anchor.quote.trim() ? anchor : undefined);
  };

  function format(prefix: string, suffix = '') {
    const input = original.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end } = input;
    setBody(body.slice(0, start) + prefix + body.slice(start, end) + suffix + body.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }

  if (!note) return <div className="qd-knowledge-empty"><h2>记下一件事</h2><p>一段文字、一张图，或一个链接。</p></div>;

  const renderExpansion = (item: NoteExpansion) => <Expansion key={item.id} item={item} body={body} readonly={!!note.archivedAt || busy}
    onJump={at => {
      pendingAnchor.current = { at, length: item.selection.quote.length };
      if (reading) setReading(false);
      else {
        original.current?.focus();
        original.current?.setSelectionRange(at, at + item.selection.quote.length);
        setSelection(makeSelection(body, at, at + item.selection.quote.length));
      }
    }}
    onRemove={() => void action(async () => { await mutateKnowledge(library => {
      const stored = library.notes.find(value => value.id === note.id && !value.archivedAt);
      if (stored) stored.expansions = stored.expansions.filter(value => value.id !== item.id);
    }); })} />;
  const preview = reading ? readingSections(body, note.expansions) : undefined;

  return <section className="qd-note-edit" aria-label="笔记正文">
    <div className="qd-note-edit-head">
      <div className="qd-note-title-field">
        <input aria-label="笔记标题" className="qd-note-title" value={title === '未命名' && !body ? '' : title} maxLength={100} placeholder="笔记标题"
          readOnly={!!note.archivedAt || busy} onChange={event => setTitle(event.target.value)} />
        <small>{note.archivedAt ? '已归档' : changed ? '有未保存的修改' : '已保存'} · {new Date(note.updatedAt).toLocaleString('zh-CN')}</small>
      </div>
      {!note.archivedAt && <button type="button" className="qd-btn primary" disabled={!changed || busy} onClick={() => void action(async () => { await save(); })}>保存</button>}
      {!pendingDraft && <button type="button" className="qd-icon-btn" aria-label="笔记选项" aria-expanded={menu} onClick={() => setMenu(value => !value)}>⋯</button>}
      {menu && <div className="qd-knowledge-menu">
        <button type="button" onClick={exportNote}>导出正文</button>
        <button type="button" disabled={busy} onClick={() => void action(async () => {
          if (!note.archivedAt && changed) await save();
          await mutateKnowledge(library => {
            const item = library.notes.find(item => item.id === note.id);
            if (!item) return;
            if (item.archivedAt) delete item.archivedAt;
            else item.archivedAt = new Date().toISOString();
          });
          setMenu(false);
        })}>{note.archivedAt ? '恢复笔记' : '归档'}</button>
      </div>}
    </div>
    {!note.archivedAt && !reading && <div className="qd-note-toolbar" role="toolbar" aria-label="笔记格式">
      <button type="button" onClick={() => { setTitle(note.title); setBody(note.body); setBaseline({ title: note.title, body: note.body, revision: note.revision }); }}>撤销未保存修改</button>
      <button type="button" onClick={() => format('**', '**')}>加粗</button>
      <button type="button" onClick={() => format('\n- ')}>列表</button>
      <button type="button" onClick={() => format('[', '](https://)')}>插入链接</button>
      <button type="button" onClick={() => files.current?.click()}>插入附件</button>
      <button type="button" onClick={() => transcript.current?.click()}>导入转写</button>
      <button type="button" onClick={() => { setReading(true); setAsking(false); }}>阅读原文</button>
    </div>}
    {preview && <div className="qd-note-reading">
      <button type="button" className="qd-link" onClick={() => setReading(false)}>返回编辑</button>
      {preview.map((section, index) => <section key={index}>
        {section.text && <ReactMarkdown skipHtml components={{ a: props => <a href={props.href} target="_blank" rel="noreferrer">{props.children}</a>, img: props => <span>{props.alt}</span> }}>{section.text}</ReactMarkdown>}
        {section.expansions.map(renderExpansion)}
      </section>)}
    </div>}
    {!preview && <textarea ref={original} aria-label="笔记正文" className="qd-note-body" placeholder="在这里记录。选中文字后，可以就地请 AI 补充。"
      value={body} onChange={event => { setBody(event.target.value); setSelection(undefined); setAsking(false); }}
      onPaste={event => { const images = Array.from(event.clipboardData.files); if (!note.archivedAt && images.length) { event.preventDefault(); attach(images); } }}
      onDragOver={event => { if (!note.archivedAt && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => { const incoming = Array.from(event.dataTransfer.files); if (!note.archivedAt && incoming.length) { event.preventDefault(); attach(incoming); } }}
      onSelect={selectionChanged} onMouseUp={selectionChanged} onKeyUp={selectionChanged} readOnly={!!note.archivedAt || busy} maxLength={50000} />}
    <input type="file" multiple hidden ref={files} aria-label="选择附件" onChange={event => { attach(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden ref={transcript} aria-label="选择转写文件" onChange={event => {
      const input = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!input) return;
      void action(async () => {
        if (input.size > 200000) throw new Error('转写文件过长，请分段导入');
        const text = await input.text();
        if (body.length + text.length > 49000) throw new Error('笔记正文过长，请分段导入');
        setBody(previous => [previous, '', text].join('\n'));
        if (pendingDraft) {
          if (pendingFiles.length >= 20) throw new Error('每条笔记最多保存 20 个附件');
          setPendingFiles(previous => [...previous, input]);
        } else await attachTranscript(input);
      });
    }} />
    {!reading && !note.archivedAt && !pendingDraft && selection && !asking && <button type="button" className="qd-btn ghost" onClick={() => { setAsking(true); requestAnimationFrame(() => quoteField.current?.focus()); }}><Icon name="bulb" size={15} /> 就这段提问</button>}
    {!reading && !note.archivedAt && !pendingDraft && asking && selection && <form className="qd-note-expansion is-prompt" onSubmit={event => { event.preventDefault(); ask(); }}>
      <blockquote>{selection.quote}</blockquote>
      <textarea ref={quoteField} aria-label="补充问题" value={question} maxLength={1200} onChange={event => setQuestion(event.target.value)} placeholder="想了解什么？" />
      {noteLinks(body).some(url => url.startsWith('https://')) && <label className="qd-note-read-links">
        <input type="checkbox" checked={readPublic} onChange={event => setReadPublic(event.target.checked)} />
        读取笔记里的公开网页并交给 AI 分析
      </label>}
      <div><button type="submit" className="qd-btn primary" disabled={!question.trim() || busy}>{busy ? '正在补充…' : '问 AI 并追加'}</button>
        <button type="button" className="qd-btn ghost" disabled={busy} onClick={() => { setAsking(false); setQuestion(''); setReadPublic(false); }}>取消</button></div>
    </form>}
    {!preview && !!note.expansions.length && <div className="qd-note-expansions" aria-label="选段补充">{note.expansions.map(renderExpansion)}</div>}
    {(note.attachments.length > 0 || noteLinks(body).length > 0) && <section className="qd-note-sources" aria-label="原始资料">
      <h3>原始资料</h3>
      {noteLinks(body).map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><Icon name="external" size={14} /> {url}</a>)}
      {note.attachments.map(file => <button className="qd-note-attachment" type="button" key={file.id} onClick={() => void action(() => downloadOutputFile(KNOWLEDGE_FILES, file))}>
        {/^(image\/(png|jpeg|gif|webp))$/.test(file.type) && <NotePicture noteId={note.id} file={file} />}
        <span>{file.name}</span><small>{fileSize(file.size)}</small>
      </button>)}
    </section>}
    {pendingDraft && !!pendingFiles.length && <section className="qd-note-sources"><h3>待保存附件</h3>{pendingFiles.map((item, index) => <div key={index} className="qd-note-pending-file">
      <span>{item.name} · {fileSize(item.size)}</span>
      <button type="button" className="qd-icon-btn" aria-label={'移除 ' + item.name} onClick={() => setPendingFiles(files => files.filter((_, at) => at !== index))}><Icon name="close" size={15}/></button>
    </div>)}</section>}
    {!!note.history.length && <details className="qd-note-history"><summary>原文历史 · {note.history.length} 版</summary>
      {[...note.history].reverse().map(version => <details key={version.revision}><summary>{version.title} · {new Date(version.at).toLocaleString('zh-CN')}</summary>
        <p>{version.body}</p>{!note.archivedAt && <button type="button" className="qd-link" onClick={() => restoreHistory(version)}>复制到当前草稿</button>}</details>)}
    </details>}
  </section>;

  async function attachTranscript(file: File) {
    if (!note) return;
    const saved = await saveOutputFile(KNOWLEDGE_FILES, file);
    try {
      await mutateKnowledge(library => {
        const item = library.notes.find(item => item.id === note.id && !item.archivedAt);
        if (!item || item.attachments.length >= 20) throw new Error('笔记已归档或附件达到 20 个');
        item.attachments.push(saved);
      });
    } catch (error) {
      await removeOutputFile(KNOWLEDGE_FILES, saved.id).catch(() => {});
      throw error;
    }
  }
}

function readingSections(body: string, expansions: NoteExpansion[]) {
  const groups = new Map<number, NoteExpansion[]>();
  const moved: NoteExpansion[] = [];
  for (const item of expansions) {
    const offset = locateSelection(body, item.selection);
    if (offset === undefined) { moved.push(item); continue; }
    const end = body.indexOf('\n', offset + item.selection.quote.length);
    const anchor = end < 0 ? body.length : end;
    groups.set(anchor, [...(groups.get(anchor) ?? []), item]);
  }
  let start = 0;
  const sections = [...groups.entries()].sort(([a], [b]) => a - b).map(([end, expansions]) => {
    const text = body.slice(start, end);
    start = end;
    return { text, expansions };
  });
  sections.push({ text: body.slice(start), expansions: moved });
  return sections;
}

function Expansion({ item, body, readonly, onJump, onRemove }: {
  item: NoteExpansion; body: string; readonly: boolean; onJump: (at: number) => void; onRemove: () => void;
}) {
  const at = locateSelection(body, item.selection);
  return <section className="qd-note-expansion">
    <div className="qd-expansion-anchor">
      {at === undefined ? <span>原文位置已变化</span> : <button type="button" className="qd-link" onClick={() => onJump(at)}>查看所选原文</button>}
      {!readonly && <button type="button" className="qd-icon-btn" aria-label="移除这条补充" onClick={onRemove}><Icon name="close" size={15} /></button>}
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
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState('');
  const [staged, setStaged] = useState<{note: KnowledgeNote; draft: NoteDraft}>();
  useEffect(() => {
    setStaged(initialDraft ? { note: blankNote(), draft: initialDraft } : undefined);
  }, [initialDraft]);
  const visible = library.notes.filter(note => !!note.archivedAt === showArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  useEffect(() => {
    if (!target) return;
    const note = library.notes.find(note => note.id === target);
    if (note) { setSelected(note.id); setShowArchived(!!note.archivedAt); }
  }, [target, library.notes.some(note => note.id === target)]);

  const note = staged?.note ?? visible.find(item => item.id === selected) ?? visible[0];
  const create = () => {
    setMessage('');
    setShowArchived(false);
    setStaged({ note: blankNote(), draft: { text: '', files: [] } });
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.qd-note-title')?.focus());
  };

  return <>
    <header className="qd-knowledge-head"><h1>帮你记</h1></header>
    {(message || error) && <p className="qd-knowledge-message" role="status">{message || error}</p>}
    <div className="qd-knowledge-split">
      <aside className="qd-knowledge-list" aria-label="笔记列表">
        <div className="qd-knowledge-list-actions"><button className="qd-btn primary" type="button" onClick={create}><Icon name="plus" size={15}/>新建</button>
          <button type="button" className="qd-link" aria-pressed={showArchived} onClick={() => { setShowArchived(value => !value); setSelected(undefined); }}>{showArchived ? '当前笔记' : '已归档'}</button></div>
        {visible.length ? <ul>{visible.map(item => <li key={item.id}>
          <button type="button" aria-current={note?.id === item.id ? 'true' : undefined} onClick={() => { setStaged(undefined); setSelected(item.id); setMessage(''); }}>
            <strong>{item.title}</strong>
            <small>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small>
          </button>
        </li>)}</ul> : <p className="qd-knowledge-list-empty">{showArchived ? '暂无归档' : '暂无笔记'}</p>}
      </aside>
      <NoteEditor key={note?.id} note={note} pendingDraft={staged?.draft} onDraftSaved={item => { setStaged(undefined); setSelected(item.id); setShowArchived(false); }} onError={setMessage} />
    </div>
  </>;
}
