import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { saveOutputFile, removeOutputFile, downloadOutputFile, fileSize } from '../../data/outputFiles';
import type { OutputAttachment } from '../../data/types';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from '../../data/taskAttachments';
import { Icon } from '../ui/Icon';
import './task-attachments.css';

export function checkPendingFiles(files: File[], existing = 0) {
  if (existing + files.length > MAX_TASK_ATTACHMENTS) throw new Error('每个任务最多添加 20 个附件');
  for (const file of files) if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} 超过 25 MB`);
}

export function TaskAttachmentsPanel({ taskId, workItemId }: { taskId: string; workItemId?: string }) {
  const { snap, api } = useWorkdeck();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const target = workItemId ? snap.orchestrations?.[taskId]?.items[workItemId] : snap.tasks[taskId];
  const files = target?.attachments ?? [];
  const upload = async (selected: File[]) => {
    if (!selected.length || busy || !target) return;
    const projectId = snap.project.id, previous = files;
    const created: OutputAttachment[] = [];
    setBusy(true); setError('');
    try {
      checkPendingFiles(selected, previous.length);
      for (const file of selected) created.push(await saveOutputFile(projectId, file));
      const result = await api.setTaskAttachments(projectId, taskId, [...previous, ...created], workItemId, previous.map(file => file.id));
      if (!result.ok) throw new Error(result.message ?? '附件未能关联任务');
    } catch (cause) {
      await Promise.all(created.map(file => removeOutputFile(projectId, file.id).catch(() => {})));
      setError(cause instanceof Error ? cause.message : '上传失败，请重试');
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {
      const result = await api.setTaskAttachments(snap.project.id, taskId, files.filter(file => file.id !== id), workItemId, files.map(file => file.id));
      if (!result.ok) throw new Error(result.message ?? '附件未能移除');
      // Keep original bytes and exported copies for already dispatched sessions.
    } catch (cause) { setError(cause instanceof Error ? cause.message : '移除失败'); }
    finally { setBusy(false); }
  };
  return <section className="qd-task-attachments" aria-label="任务附件" aria-busy={busy}>
    <div className="qd-task-attachments-head"><h3>任务附件{files.length ? ` · ${files.length}` : ''}</h3><button type="button" className="qd-btn ghost small" disabled={busy || files.length >= MAX_TASK_ATTACHMENTS} onClick={() => picker.current?.click()}><Icon name="plus" size={13} />{busy ? '保存中…' : '上传附件'}</button></div>
    <input ref={picker} type="file" multiple hidden aria-label="上传任务附件" onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; void upload(selected); }} />
    <p className="qd-task-attachments-note">每个文件最多 25 MB。新派发的 Agent 会收到这些文件，已开始的会话保持原有附件。</p>
    {!files.length && <p className="qd-task-attachments-empty">添加文档、图片或其他任务资料。</p>}
    <ul>{files.map(file => <li key={file.id}><button type="button" className="qd-task-attachment-download" title={`下载 ${file.name}`} onClick={() => void downloadOutputFile(snap.project.id, file).catch(cause => setError(cause.message))}><Icon name="folder" size={15} /><span>{file.name}<small>{fileSize(file.size)}</small></span><span>下载</span></button><button type="button" className="qd-icon-btn" disabled={busy} aria-label={`移除任务附件 ${file.name}`} onClick={() => void remove(file.id)}><Icon name="close" size={14} /></button></li>)}</ul>
    {error && <p role="alert" className="qd-task-attachments-error">{error}</p>}
  </section>;
}

function TaskAttachmentsDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} className="qd-task-attachments-dialog" aria-label="任务附件" onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>任务资料</h2><button type="button" className="qd-icon-btn" aria-label="关闭任务附件" onClick={onClose}><Icon name="close" size={16} /></button></header><TaskAttachmentsPanel taskId={taskId} /></dialog>, document.body);
}
export function TaskAttachmentsButton({ taskId }: { taskId: string }) {
  const { snap } = useWorkdeck(); const [open, setOpen] = useState(false); const count = snap.tasks[taskId]?.attachments?.length ?? 0;
  return <><button type="button" className="qd-link" onClick={() => setOpen(true)}><Icon name="folder" size={13} />附件{count ? ` ${count}` : ''}</button>{open && <TaskAttachmentsDialog taskId={taskId} onClose={() => setOpen(false)} />}</>;
}
