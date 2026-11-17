import { useEffect, useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { closeDeletionSession, deletionIssues, type DeletionIssue } from '../../data/deletion';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { DeleteProjectButton } from './ProjectLifecycle';
import './deletion.css';

/** Project/task identities are captured before opening the confirmation dialog. */
export function DeleteWorkButton({ projectId, taskId, workItemId, title, className = '' }: { projectId: string; taskId?: string; workItemId?: string; title: string; className?: string }) {
  if (!taskId) return <DeleteProjectButton projectId={projectId} title={title} className={className} />;
  return <DeleteTaskButton projectId={projectId} taskId={taskId} workItemId={workItemId} title={title} className={className} />;
}

function DeleteTaskButton({ projectId, taskId, workItemId, title, className = '' }: { projectId: string; taskId: string; workItemId?: string; title: string; className?: string }) {
  const { api, toast, refreshProjects, openSourceSession } = useWorkdeck();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [issues, setIssues] = useState<DeletionIssue[]>([]), [loading, setLoading] = useState(false);
  const kind = workItemId ? '子任务' : '任务';
  const readIssues = async () => {
    const snapshot = (await api.listProjects()).find(project => project.project.id === projectId);
    const ids = workItemId ? new Set([workItemId]) : undefined;
    if (snapshot && ids && taskId) {
      let previous = 0;
      while (previous !== ids.size) { previous = ids.size; for (const item of Object.values(snapshot.orchestrations?.[taskId]?.items ?? {})) if (ids.has(item.parentTaskId)) ids.add(item.id); }
    }
    const next = snapshot ? deletionIssues(snapshot, taskId, ids) : [];
    setIssues(next); return next;
  };
  useEffect(() => {
    if (!open) return;
    let active = true; setLoading(true);
    void readIssues().catch(cause => { if (active) setError(String(cause.message || cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, projectId, taskId, workItemId]);
  const closeIssue = async (issue: DeletionIssue) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (issue.planId) await api.setPlanTimer(issue.planId, false, projectId);
      else if (issue.sessionId) {
        const runtime = api as typeof api & Partial<RuntimeCommands>;
        if (!runtime.controlSession) throw new Error('请在源 Agent 中结束这条会话');
        const result = await closeDeletionSession({ listProjects: () => api.listProjects(), controlSession: (id, action) => runtime.controlSession!(id, action) }, projectId, issue.sessionId);
        if (!result.ok) throw new Error(result.message || '尚未收到收尾回执');
      }
      await readIssues();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '收尾失败，请重试'); await readIssues(); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if ((await readIssues()).length) { setError('请先处理下方待收尾项，历史记录会保留。'); return; }
      const result = await api.deleteTask(taskId, projectId, workItemId);
      if (!result.ok) throw new Error(result.message || '删除失败，请重试');
      setOpen(false);
      toast(result.message ?? `${kind}已删除`);
      // Persistence is already committed; a list refresh failure must not report a failed deletion.
      void refreshProjects().catch(() => toast('已删除，项目列表暂未刷新', 'error'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试'); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className={`qd-icon-btn qd-delete-work ${className}`} aria-label={`删除${kind} ${title}`} title={`删除${kind}`} onClick={event => { event.stopPropagation(); setError(''); setOpen(true); }}><Icon name="trash" size={15} /></button>
    {open && <ConfirmDialog title={`删除${kind}“${title}”？`} text="任务及其子任务将从工作台移除，未开始的日程会取消。已提交成果、执行历史和附件仍保存在本机；引用这些成果的内容会提示重新核对。这不会删除源 Agent 会话。" confirmLabel={busy ? '处理中…' : `删除${kind}`} confirmDisabled={loading || issues.length > 0} busy={busy} error={error} onConfirm={() => { void remove(); }} onClose={() => { if (!busy) setOpen(false); }}>
      {loading ? <p role="status">正在检查关联执行…</p> : issues.length > 0 && <section className="qd-delete-issues" aria-label="删除前待收尾事项"><h3>先收尾，再移除 <span>{issues.length}</span></h3><p>先结束关联会话，再移除任务。已提交记录仍会保留。</p><ul>{issues.map(issue => <li key={issue.id}><div><strong>{issue.title}</strong><small>{issue.detail}</small></div>{issue.canClose ? <button type="button" className="qd-btn ghost" disabled={busy} onClick={() => void closeIssue(issue)}>{issue.kind === 'timer' ? '停止计时' : issue.detail === '执行中' || issue.detail === '等待授权' || issue.detail === '等待受理' ? '停止并归档' : '归档会话'}</button> : issue.sessionId && <button type="button" className="qd-btn ghost" disabled={busy} onClick={() => openSourceSession(issue.sessionId!)}>查看会话</button>}</li>)}</ul><button type="button" className="qd-text-btn" disabled={busy} onClick={() => void readIssues().catch(cause => setError(String(cause.message || cause)))}>刷新收尾状态</button></section>}
    </ConfirmDialog>}
  </>;
}
