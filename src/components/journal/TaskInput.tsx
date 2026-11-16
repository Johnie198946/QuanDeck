import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { taskSessions } from '../../data/derive';
import { canReplyToTask, readTaskInputDraft, storeTaskInputDraft, clearTaskInputDraft, newTaskInputDraft, sameTaskInputDraft, hasTaskInput, taskInputClipboardFiles, type TaskInputDraft } from '../../data/taskInput';
import { saveOutputFile, removeOutputFile, downloadOutputFile, fileSize } from '../../data/outputFiles';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import type { CommandResult, OutputAttachment } from '../../data/types';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { Icon } from '../ui/Icon';

type SavedInput = { id: string; text: string; at?: string; attachments?: OutputAttachment[] };
const fileLabel = (file: OutputAttachment) => file.type.startsWith('image/') ? '图片' : file.name.split('.').at(-1)?.slice(0, 6).toUpperCase() || '文件';
function SavedInputs({ inputs, projectId, onClose }: { inputs: SavedInput[]; projectId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="qd-input-reader" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><span>任务资料</span><h2 id={titleId}>已保存的补充</h2></div><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button></header>
    <div className="qd-input-reader-body">{error && <p role="alert">{error}</p>}{inputs.map((input, index) => <article key={input.id}><span className="qd-input-number">补充 {index + 1}</span>{input.text && <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }) => <span>{alt || '图片'}</span> }}>{input.text}</ReactMarkdown>}{!!input.attachments?.length && <ul className="qd-input-files">{input.attachments.map(file => <li key={file.id}><span className="qd-input-file-kind">{fileLabel(file)}</span><button type="button" title={`下载 ${file.name}`} onClick={() => void downloadOutputFile(projectId, file).catch(cause => setError(cause instanceof Error ? cause.message : '无法读取附件'))}><span>{file.name}</span><small>{fileSize(file.size)} · 下载</small></button></li>)}</ul>}</article>)}</div>
  </dialog>, document.body);
}
function readDraft(key: string) {
  try { return readTaskInputDraft(localStorage, key); } catch { return newTaskInputDraft(); }
}

export function TaskInput({ taskId }: { taskId: string }) {
  const { snap, api, agentOf } = useWorkdeck();
  const task = snap.tasks[taskId], projectId = snap.project.id;
  const storageKey = `quandeck.task-input.${projectId}.${taskId}`, fieldId = useId();
  const [draft, setDraft] = useState(() => readDraft(storageKey));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [target, setTarget] = useState(''), [expanded, setExpanded] = useState(() => hasTaskInput(readDraft(storageKey)));
  const [showInputs, setShowInputs] = useState(false), [previews, setPreviews] = useState<Record<string, string>>({});
  const pending = useRef<string | null>(null), activeKey = useRef<string | null>(storageKey), draftRef = useRef(draft);
  const picker = useRef<HTMLInputElement>(null), field = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLButtonElement>(null);
  const ownedUrls = useRef(new Set<string>());
  const runtime = api as Partial<RuntimeCommands>;
  const targets = taskSessions(snap, task).filter(session => canReplyToTask(snap, session));
  const selected = targets.find(session => session.id === target) ?? targets[0];
  const inputs = task.inputs as SavedInput[] | undefined;
  const remainingFiles = MAX_TASK_ATTACHMENTS - new Set([...(task.attachments ?? []), ...(draft.attachments ?? [])].map(file => file.id)).size;

  useEffect(() => {
    activeKey.current = storageKey; pending.current = null;
    const current = readDraft(storageKey); draftRef.current = current; setDraft(current);
    setExpanded(hasTaskInput(current)); setError(''); setNotice(''); setBusy(false); setTarget(''); setShowInputs(false); setPreviews({});
    return () => { if (activeKey.current === storageKey) activeKey.current = null; for (const url of ownedUrls.current) URL.revokeObjectURL(url); ownedUrls.current.clear(); };
  }, [storageKey]);
  const updateDraft = (next: TaskInputDraft) => {
    draftRef.current = next; setDraft(next); setNotice(''); setError('');
    try { storeTaskInputDraft(localStorage, storageKey, next); }
    catch { setError('草稿暂时只保留在此窗口，请保存到任务后再离开。'); }
  };
  const changeText = (text: string) => updateDraft(newTaskInputDraft(text, draftRef.current.attachments));
  const open = () => { setExpanded(true); requestAnimationFrame(() => field.current?.focus()); };
  const upload = async (files: File[]) => {
    if (!files.length || pending.current) return;
    setExpanded(true); setError(''); setNotice('');
    if (files.length > remainingFiles) { setError(`任务最多保留 ${MAX_TASK_ATTACHMENTS} 个附件，还可添加 ${Math.max(0, remainingFiles)} 个。`); return; }
    const oversized = files.find(file => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) { setError(`${oversized.name} 超过 25 MB，请选择较小的文件。`); return; }
    const requestId = crypto.randomUUID(), submitted = draftRef.current, created: OutputAttachment[] = [];
    const isCurrent = () => activeKey.current === storageKey && pending.current === requestId;
    pending.current = requestId; setBusy(true);
    try {
      for (const file of files) created.push(await saveOutputFile(projectId, file));
      // A delayed upload stays with the task where it began, even after navigation.
      const current = isCurrent() ? draftRef.current : readDraft(storageKey);
      const next = newTaskInputDraft(current.text, [...(current.attachments ?? []), ...created]);
      if (isCurrent()) {
        updateDraft(next);
        const images = Object.fromEntries(created.flatMap((file, index) => {
          if (!file.type.startsWith('image/')) return [];
          const url = URL.createObjectURL(files[index]); ownedUrls.current.add(url); return [[file.id, url]];
        }));
        setPreviews(value => ({ ...value, ...images }));
      } else storeTaskInputDraft(localStorage, storageKey, next);
    } catch (cause) {
      // Files have not been registered in the task or sent at this stage.
      await Promise.all(created.map(file => removeOutputFile(projectId, file.id).catch(() => {})));
      if (isCurrent()) { draftRef.current = submitted; setDraft(submitted); setError(cause instanceof Error ? cause.message : '附件未能保存，请重试。'); }
    } finally { if (isCurrent()) { pending.current = null; setBusy(false); } }
  };
  const removeDraftFile = (id: string) => {
    updateDraft(newTaskInputDraft(draftRef.current.text, draftRef.current.attachments?.filter(file => file.id !== id)));
    if (previews[id]) { URL.revokeObjectURL(previews[id]); ownedUrls.current.delete(previews[id]); setPreviews(value => { const next = { ...value }; delete next[id]; return next; }); }
    // Preserve bytes: a previous save may have succeeded even when its receipt was lost.
  };
  const submit = async (send: boolean) => {
    if (pending.current || !hasTaskInput(draftRef.current)) return;
    const submitted = draftRef.current, requestId = crypto.randomUUID();
    const isCurrent = () => activeKey.current === storageKey && pending.current === requestId;
    pending.current = requestId; setBusy(true); setError(''); setNotice('');
    try {
      if (send && (!selected || !runtime.controlSession)) throw new Error('会话状态已变化，请先保存到任务或打开会话。');
      // Atomic note + attachment association; the runtime exports these exact IDs before replying.
      const addInput = api.addTaskInput as (projectId: string, taskId: string, text: string, inputId: string, attachments?: OutputAttachment[]) => Promise<CommandResult>;
      const saved = await addInput.call(api, projectId, taskId, submitted.text.trim(), submitted.id, submitted.attachments ?? []);
      if (!saved.ok) throw new Error(saved.message ?? '未能保存，请重试。');
      if (send) {
        const sent = await runtime.controlSession!(selected.id, 'reply', { prompt: submitted.text.trim() || '请查看我补充的附件。', inputId: submitted.id, attachmentIds: (submitted.attachments ?? []).map(file => file.id) });
        if (!sent.ok) throw new Error(`已保存到任务，发送未完成：${sent.message ?? '请重试或查看会话。'}`);
      }
      try { clearTaskInputDraft(localStorage, storageKey, submitted); } catch { /* Retry remains safe with the same input ID. */ }
      if (isCurrent() && sameTaskInputDraft(draftRef.current, submitted)) {
        const next = newTaskInputDraft(); draftRef.current = next; setDraft(next); setExpanded(false); setPreviews({});
        for (const url of ownedUrls.current) URL.revokeObjectURL(url); ownedUrls.current.clear();
        setNotice(send ? `已发送给 ${agentOf(selected.agentId).name}` : '已保存，下次派发时交给 Agent');
        requestAnimationFrame(() => opener.current?.focus());
      }
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '操作失败，输入内容已保留。'); }
    finally { if (isCurrent()) { pending.current = null; setBusy(false); } }
  };

  return <div className={`qd-task-input${expanded ? ' is-expanded' : ''}`} aria-busy={busy}>
    <div className="qd-input-entry">
      <button ref={opener} type="button" className="qd-input-open" aria-expanded={expanded} aria-controls={`${fieldId}-editor`} onClick={expanded ? () => { setExpanded(false); opener.current?.focus(); } : open}><Icon name="plus" size={15}/><span>{expanded ? '补充要求与资料' : hasTaskInput(draft) ? '继续编辑补充' : '补充要求、进展或资料…'}</span>{hasTaskInput(draft) && <small>草稿</small>}</button>
      {!!inputs?.length && <button type="button" className="qd-text-btn qd-input-history-link" onClick={() => setShowInputs(true)}>已保存 {inputs.length} 条<Icon name="chevron-right" size={13}/></button>}
    </div>
    {expanded && <div id={`${fieldId}-editor`} className="qd-input-editor">
      <label className="qd-visually-hidden" htmlFor={fieldId}>补充要求或记录进展</label>
      <textarea ref={field} id={fieldId} value={draft.text} disabled={busy} rows={3} placeholder="写下具体要求，也可以粘贴图片或添加文件…"
        onChange={event => changeText(event.target.value)} aria-describedby={`${fieldId}-feedback`}
        onPaste={event => { const files = taskInputClipboardFiles(event.clipboardData); if (files.length) { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); if (text) { const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd; changeText(draft.text.slice(0, start) + text + draft.text.slice(end)); } void upload(files); } }}
        onKeyDown={event => { if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit(false); } }} />
      {!!draft.attachments?.length && <ul className="qd-input-files" aria-label="待保存的附件">{draft.attachments.map(file => <li key={file.id}>{previews[file.id] ? <img src={previews[file.id]} alt={`${file.name} 缩略图`}/> : <span className="qd-input-file-kind">{fileLabel(file)}</span>}<span className="qd-input-file-name" title={file.name}>{file.name}<small>{fileSize(file.size)}</small></span><button type="button" className="qd-icon-btn" aria-label={`移除待保存附件 ${file.name}`} disabled={busy} onClick={() => removeDraftFile(file.id)}><Icon name="close" size={13}/></button></li>)}</ul>}
      <div className="qd-task-input-actions">
        <button type="button" className="qd-text-btn" disabled={busy || remainingFiles <= 0} onClick={() => picker.current?.click()} title="添加图片、视频、PDF、Excel、Word 等资料，每个最多 25 MB"><Icon name="folder" size={15}/>添加资料</button>
        <input ref={picker} type="file" multiple hidden aria-label="添加补充附件" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files); }}/>
        <span className="qd-input-file-help">图片 · 视频 · PDF · Excel · Word</span>
        {targets.length > 1 && <select aria-label="选择续谈会话" value={selected?.id ?? ''} onChange={event => setTarget(event.target.value)} disabled={busy}>{targets.map(session => <option value={session.id} key={session.id}>{agentOf(session.agentId).name} · {session.title}</option>)}</select>}
        <button type="button" className="qd-btn ghost" disabled={busy || !hasTaskInput(draft)} onClick={() => void submit(false)}>{busy ? '处理中…' : '保存到任务'}</button>
        {selected && runtime.controlSession && <button type="button" className="qd-btn primary" disabled={busy || !hasTaskInput(draft)} onClick={() => void submit(true)}>发给 {agentOf(selected.agentId).name}</button>}
      </div>
    </div>}
    {(expanded || error || notice) && <p id={`${fieldId}-feedback`} role={error ? 'alert' : 'status'} className={`qd-input-feedback${error ? ' is-error' : ''}`}>{error || notice || (busy ? '正在保存…' : '保存到任务，下次执行时使用。⌘ / Ctrl + Enter 保存')}</p>}
    {showInputs && <SavedInputs projectId={projectId} inputs={inputs ?? []} onClose={() => setShowInputs(false)} />}
  </div>;
}
