import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import './deletion.css';

/** Project/task identities are captured before opening the confirmation dialog. */
export function DeleteWorkButton({ projectId, taskId, workItemId, title, className = '' }: { projectId: string; taskId?: string; workItemId?: string; title: string; className?: string }) {
  const { api, toast, refreshProjects } = useWorkdeck();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const kind = workItemId ? '子任务' : taskId ? '任务' : '项目';
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = taskId ? await api.deleteTask(taskId, projectId, workItemId) : await api.deleteProject(projectId);
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
    {open && <ConfirmDialog title={`删除${kind}“${title}”？`} text={taskId
      ? '任务及其子任务将从工作台移除，未开始的日程会取消。已提交成果、执行历史和附件仍保存在本机；引用这些成果的内容会提示重新核对。这不会删除源 Agent 会话。'
      : '项目将从工作台和日程中移除。项目内容、执行历史和附件仍保存在本机历史数据中，不会彻底清除磁盘文件，也不会删除源 Agent 会话。'} confirmLabel={busy ? '删除中…' : `删除${kind}`} busy={busy} error={error} onConfirm={() => { void remove(); }} onClose={() => { if (!busy) setOpen(false); }} />}
  </>;
}
