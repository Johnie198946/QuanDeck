import { TaskIcon } from "../ui/TaskIcon";
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OutputAttachment, TaskOutput } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { fileSize, removeOutputFile, saveOutputFile } from '../../data/outputFiles';
import { Icon } from '../ui/Icon';
import './outputs.css';

export function OutputDialog({ taskId, itemId, output, onClose }: { taskId: string; itemId?: string | null; output?: TaskOutput; onClose: () => void }) {
  const { snap, api, toast } = useWorkdeck();
  const dialog = useRef<HTMLDialogElement>(null);
  const fieldId = useId();
  const alive = useRef(true); const project = useRef(snap.project.id); project.current = snap.project.id;
  const initialProject = useRef(snap.project.id).current;
  const item = itemId ? snap.orchestrations?.[taskId]?.items[itemId] : null;
  const taskTitle = item?.title ?? snap.tasks[taskId]?.title ?? '';
  const [title, setTitle] = useState(output?.title ?? taskTitle);
  const [body, setBody] = useState(output?.body ?? '');
  const [linksText, setLinksText] = useState((output?.links ?? []).map(link => `${link.label} | ${link.url}`).join('\n'));
  const [attachments, setAttachments] = useState<OutputAttachment[]>(output?.attachments ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    alive.current = true; const trigger = document.activeElement as HTMLElement | null; const element = dialog.current; element?.showModal();
    return () => { alive.current = false; element?.close(); trigger?.focus(); };
  }, []);
  useEffect(() => { if (snap.project.id !== initialProject) onClose(); }, [snap.project.id]);
  const save = async (status: 'draft' | 'published', complete: boolean) => {
    if (busy) return;
    const created: OutputAttachment[] = [];
    setError(''); setBusy(true);
    try {
      if (!title.trim()) throw new Error('请填写成果标题');
      const links = linksText.split('\n').filter(line => line.trim()).map(line => {
        const parts = line.split('|'); const raw = parts.at(-1)!.trim(); let url: URL;
        try { url = new URL(raw); } catch { throw new Error(`链接格式不正确：${raw}`); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('链接需要使用 http 或 https 地址');
        return { label: parts.length > 1 ? parts.slice(0, -1).join('|').trim() : url.hostname, url: url.href };
      });
      if (!body.trim() && !links.length && !attachments.length && !files.length) throw new Error('写下结果，或添加链接、文件');
      for (const file of files) created.push(await saveOutputFile(initialProject, file));
      if (!alive.current || project.current !== initialProject) throw new Error('项目已切换，请在原项目重新提交');
      const result = await api.saveTaskOutput({ projectId: initialProject, id: output?.id, taskId, workItemId: itemId ?? null, title: title.trim(), body: body.trim(), links, attachments: [...attachments, ...created], status, complete });
      if (!result.ok) throw new Error(result.message ?? '成果未保存');
      const removed = output?.attachments?.filter(file => !attachments.some(saved => saved.id === file.id)) ?? [];
      await Promise.all(removed.map(file => removeOutputFile(initialProject, file.id).catch(() => {})));
      toast(status === 'draft' ? '草稿已保存' : complete ? '成果已归入成果页，任务已完成' : '成果已归入成果页'); onClose();
    } catch (e) { await Promise.all(created.map(file => removeOutputFile(initialProject, file.id).catch(() => {}))); if (alive.current) setError(e instanceof Error ? e.message : '保存失败'); }
    finally { if (alive.current) setBusy(false); }
  };
  const remove = async () => {
    if (!output || busy) return; setBusy(true);
    try { const result = await api.deleteTaskOutput(output.id); if (!result.ok) throw new Error(result.message ?? '删除失败'); await Promise.all((output.attachments ?? []).map(file => removeOutputFile(initialProject, file.id).catch(() => {}))); toast('成果已移除'); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '删除失败'); setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="qd-output-dialog" aria-labelledby={`${fieldId}-heading`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="qd-task-name"><TaskIcon snapshot={snap} taskId={taskId} workItemId={itemId ?? undefined} size={18}/><span>{taskTitle}</span></p><h2 id={`${fieldId}-heading`}>{output ? '编辑成果' : '记录我的成果'}</h2></div><button type="button" className="qd-icon-btn" aria-label="关闭成果编辑" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="qd-output-editor">
      <div className="qd-output-field"><label htmlFor={`${fieldId}-title`}>成果标题</label><input id={`${fieldId}-title`} autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={180} placeholder="为这份成果起个名字" /></div>
      <div className="qd-output-field"><label htmlFor={`${fieldId}-body`}>结果内容</label><textarea id={`${fieldId}-body`} rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="完成了什么、得到什么结论，可以直接粘贴笔记或 Markdown。" /></div>
      <details open={!!linksText}><summary>添加链接</summary><label className="qd-sr-only" htmlFor={`${fieldId}-links`}>成果链接</label><textarea id={`${fieldId}-links`} rows={2} value={linksText} onChange={e => setLinksText(e.target.value)} placeholder="每行一条：名称 | https://…" /></details>
      <div className="qd-output-file-heading"><label className="qd-btn ghost small"><Icon name="plus" size={14} />添加文件<input type="file" multiple hidden disabled={busy} onChange={event => { const incoming = Array.from(event.target.files ?? []); if (incoming.some(file => file.size > 25 * 1024 * 1024)) { setError('每个文件最多 25 MB'); return; } setFiles(value => [...value, ...incoming]); event.target.value = ''; }} /></label><small>保存在本机 · 每个文件最多 25 MB</small></div>
      <ul className="qd-output-files">{attachments.map(file => <li key={file.id}><span>{file.name}<small>{fileSize(file.size)}</small></span><button type="button" aria-label={`移除 ${file.name}`} disabled={busy} onClick={() => setAttachments(value => value.filter(item => item.id !== file.id))}><Icon name="close" size={13} /></button></li>)}{files.map((file, index) => <li key={`${file.name}:${index}`}><span>{file.name}<small>{fileSize(file.size)}</small></span><button type="button" disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter((_, i) => i !== index))}><Icon name="close" size={13} /></button></li>)}</ul>
      {error && <p className="qd-output-error" role="alert">{error}</p>}
    </div>
    <footer>{output && <button type="button" className="qd-output-delete" disabled={busy} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}>{confirmDelete ? '确认移除成果' : '移除'}</button>}<div><button type="button" className="qd-btn ghost small" disabled={busy} onClick={() => void save('draft', false)}>存草稿</button><button type="button" className="qd-btn ghost small" disabled={busy} onClick={() => void save('published', false)}>提交成果</button><button type="button" className="qd-btn primary small" disabled={busy} onClick={() => void save('published', true)}>{busy ? '保存中…' : '提交并完成任务'}</button></div></footer>
  </dialog>, document.body);
}

export function TaskOutputButton({ taskId, itemId, compact = false }: { taskId: string; itemId?: string | null; compact?: boolean }) {
  const { snap } = useWorkdeck(); const [open, setOpen] = useState(false);
  const draft = Object.values(snap.outputs ?? {}).find(output => output.taskId === taskId && (output.workItemId ?? null) === (itemId ?? null) && output.status === 'draft');
  return <><button type="button" className={compact ? 'qd-text-btn qd-task-entry' : 'qd-btn ghost small'} onClick={() => setOpen(true)}><Icon name="pencil" size={13} />{draft ? '继续成果草稿' : '记录成果'}</button>{open && <OutputDialog key={`${snap.project.id}:${taskId}:${itemId}`} taskId={taskId} itemId={itemId} output={draft} onClose={() => setOpen(false)} />}</>;
}
