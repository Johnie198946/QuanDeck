import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { desktopHost } from '../../integration/desktop';
import { useWorkdeck } from '../../state/WorkdeckContext';
import type { Snapshot } from '../../data/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import './projects.css';

/** The native handler owns the single permanent-delete confirmation and rechecks
 * project identity, affected data and execution state immediately before erasure. */
export function DeleteProjectButton({ projectId, title, className = '', label = false, onDeleted }: { projectId: string; title: string; className?: string; label?: boolean; onDeleted?: () => void }) {
  const { toast, refreshProjects } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    const host = desktopHost();
    if (!host?.deleteProjectPermanently) { toast('请在更新后的桌面版中删除项目', 'error'); return; }
    setBusy(true);
    try {
      const result = await host.deleteProjectPermanently(projectId);
      if (!result) return;
      onDeleted?.();
      toast(result.restartRequired ? '项目已删除，正在重新打开工作台' : '项目已删除');
      if (!result.restartRequired) void refreshProjects().catch(() => toast('项目已删除，列表暂未刷新', 'error'));
    } catch (cause) { toast(cause instanceof Error ? cause.message : '项目尚未删除，请重试', 'error'); }
    finally { setBusy(false); }
  };
  return <button type="button" className={`${label ? 'qd-btn danger' : 'qd-icon-btn qd-delete-work'} ${className}`} disabled={busy} aria-busy={busy} aria-label={`删除项目 ${title}`} title="删除项目及其本机数据" onClick={event => { event.stopPropagation(); void remove(); }}><Icon name="trash" size={15} />{label && (busy ? '正在处理…' : '删除项目')}</button>;
}

export function ArchiveProjectButton({ projectId, title, onArchived }: { projectId: string; title: string; onArchived?: () => void }) {
  const { api, toast, refreshProjects } = useWorkdeck();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const archive = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.archiveProject(projectId);
      if (!result.ok) throw Error(result.message || '项目尚未归档');
      setOpen(false); onArchived?.(); toast('已归档，可在项目列表的“已归档项目”中恢复');
      void refreshProjects().catch(() => toast('项目已归档，列表暂未刷新', 'error'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '项目尚未归档，请重试'); }
    finally { setBusy(false); }
  };
  return <><button type="button" className="qd-link" onClick={() => { setError(''); setOpen(true); }}><Icon name="box" size={14} />归档项目</button>{open && createPortal(<ConfirmDialog title={`归档“${title}”？`} text="暂时收起这个项目，保留内容和文件。之后可以从“已归档项目”恢复。" confirmLabel={busy ? '归档中…' : '归档项目'} busy={busy} error={error} onClose={() => { if (!busy) setOpen(false); }} onConfirm={() => void archive()} />, document.body)}</>;
}

export function ArchivedProjectsDialog({ onClose }: { onClose: () => void }) {
  const { api, refreshProjects, toast } = useWorkdeck();
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const [projects, setProjects] = useState<Snapshot[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null, node = ref.current;
    node?.showModal(); let active = true;
    void api.listArchivedProjects().then(values => { if (active) setProjects(values); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '归档列表暂时无法读取'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; node?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, [api]);
  const restore = async (projectId: string) => {
    if (busy) return;
    setBusy(projectId); setError('');
    try {
      const result = await api.restoreProject(projectId);
      if (!result.ok) throw Error(result.message || '项目尚未恢复');
      setProjects(values => values.filter(value => value.project.id !== projectId));
      toast('项目已恢复，执行由你决定');
      void refreshProjects().catch(() => toast('项目已恢复，列表暂未刷新', 'error'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '项目尚未恢复，请重试'); }
    finally { setBusy(null); }
  };
  return createPortal(<dialog ref={ref} className="qd-discussion-dialog qd-archived-projects" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>已归档项目</h2><button type="button" className="qd-icon-btn" aria-label="关闭归档列表" disabled={!!busy} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <p className="qd-dialog-description">归档只收起项目。恢复后不会自动开始执行。</p>
    {loading ? <p role="status">正在读取归档项目…</p> : !projects.length && !error ? <p className="qd-archive-empty">没有归档项目</p> : <ul>{projects.map(({ project }) => <li key={project.id}><strong>{project.name}</strong><div><button type="button" className="qd-btn" disabled={!!busy} onClick={() => void restore(project.id)}>{busy === project.id ? '恢复中…' : '恢复项目'}</button><DeleteProjectButton projectId={project.id} title={project.name} className="qd-archive-delete" onDeleted={() => setProjects(values => values.filter(value => value.project.id !== project.id))} /></div></li>)}</ul>}
    {error && <p role="alert" className="qd-delete-error">{error}</p>}
    <footer><button type="button" className="qd-btn ghost" disabled={!!busy} onClick={onClose}>关闭</button></footer>
  </dialog>, document.body);
}
