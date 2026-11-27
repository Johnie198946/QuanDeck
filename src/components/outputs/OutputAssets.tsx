import { useState } from 'react';
import { taskKey } from '../../data/collaboration';
import type { ResultRecord } from '../../data/results';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { downloadOutputFile, fileSize } from '../../data/outputFiles';
import { OutputDialog } from './OutputDialog';
import { Icon } from '../ui/Icon';

export function OutputAssets({ report, projectId }: { report: ResultRecord; projectId?: string }) {
  const { snap, toast } = useWorkdeck();
  return <div className="qd-output-assets">{report.links?.map((link, index) => {
    let safe = false; try { const url = new URL(link.url); safe = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Invalid imported links stay text. */ }
    return safe ? <a key={index} href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={12} />{link.label || link.url}</a> : <span key={index}>{link.label || link.url}</span>;
  })}{report.attachments?.map(file => <button type="button" key={file.id} onClick={() => void downloadOutputFile(projectId ?? snap.project.id, file).catch(error => toast(error.message, 'error'))}><Icon name="folder" size={12} />{file.name}<small>{fileSize(file.size)}</small></button>)}</div>;
}
export function EditOutputButton({ outputId }: { outputId: string }) {
  const { snap } = useWorkdeck(); const [open, setOpen] = useState(false); const output = snap.outputs?.[outputId];
  if (!output || output.origin !== "human") return null;
  const task = snap.collaboration?.tasks[taskKey(output.taskId, output.workItemId)];
  if (task?.archived || task?.status === "done" || task?.status === "cancelled") return null;
  return <><button type="button" className="qd-link" onClick={() => setOpen(true)}>编辑成果<Icon name="pencil" size={12} /></button>{open && <OutputDialog taskId={output.taskId} itemId={output.workItemId} output={output} onClose={() => setOpen(false)} />}</>;
}
export function AddSubtask({ taskId, parentId }: { taskId: string; parentId?: string }) {
  const { api, toast } = useWorkdeck(); const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="qd-link" onClick={() => setOpen(true)}><Icon name="plus" size={12} />拆一个子任务</button>;
  return <form className="qd-add-subtask" onSubmit={async event => { event.preventDefault(); if (!title.trim() || busy) return; setBusy(true); try { const r = await api.addManualSubtask(taskId, parentId ?? taskId, title.trim()); if (!r.ok) throw new Error(r.message ?? '添加失败'); setTitle(''); setOpen(false); toast('子任务已添加'); } catch (e) { toast(e instanceof Error ? e.message : '添加失败', 'error'); } finally { setBusy(false); } }}><input aria-label="子任务名称" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="下一步做什么" /><button type="submit" className="qd-btn ghost small" disabled={busy || !title.trim()}>添加</button><button type="button" className="qd-icon-btn" aria-label="取消添加子任务" onClick={() => setOpen(false)}><Icon name="close" size={12} /></button></form>;
}
