import { useState } from 'react';
import type { Snapshot } from '../../data/types';
import type { TaskTitleInput } from '../../data/intelligence';
import { useWorkdeck } from '../../state/WorkdeckContext';
import './title-summary.css';

/** Explicit for existing/manual tasks; automatic intake titles use the same length contract. */
export function TaskTitleSummaryButton({ snapshot, taskId }: { snapshot: Snapshot; taskId: string }) {
  const { api, toast } = useWorkdeck();
  const [submitting, setSubmitting] = useState(false);
  const task = snapshot.tasks[taskId];
  const job = Object.values(snapshot.intelligence?.jobs ?? {}).filter(job => job.kind === 'title' && (job.input as TaskTitleInput).taskId === taskId).at(-1);
  const busy = submitting || job?.status === 'queued' || job?.status === 'running';
  if (!task || Array.from(task.title).length <= 40 && !job) return null;
  const summarize = async () => {
    setSubmitting(true);
    try {
      const result = await api.summarizeTaskTitle(taskId, snapshot.project.id);
      if (!result.ok) throw new Error(result.message ?? '标题归纳暂不可用，原文已保留');
    } catch (error) { toast(error instanceof Error ? error.message : '标题归纳未完成，原文已保留', 'error'); }
    finally { setSubmitting(false); }
  };
  const status = job?.error ? job.status === 'failed' ? '归纳未完成，原文已保留' : job.error : job?.status === 'succeeded' ? '标题已精简，原文已保留' : '';
  return <div className="qd-title-summary">
    <button type="button" className="qd-text-btn" disabled={busy} onClick={() => void summarize()} aria-label={`AI 精简标题：${task.title}`}>{busy ? '正在精简标题…' : job?.status === 'failed' ? '重试精简标题' : 'AI 精简标题'}</button>
    {status && <small role="status" title={job?.error}>{status}</small>}
  </div>;
}
