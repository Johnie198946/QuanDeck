import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTaskHandoff } from '../../data/taskHandoff';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import './task-handoff.css';

/** One modal submission fixes the source through the backend, including on retry. */
export function TaskHandoffDialog({ sourceTaskKey, sourceTitle, onClose }: { sourceTaskKey: string; sourceTitle: string; onClose: () => void }) {
  const { snap, api, toast, openWorkspace } = useWorkdeck();
  const [title, setTitle] = useState(`继续：${sourceTitle}`.slice(0, 200)), [goal, setGoal] = useState('');
  const [targetTaskKey, setTargetTaskKey] = useState('');
  const [execute, setExecute] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const source = getTaskHandoff(snap, sourceTaskKey);
  const usable = source?.reviewStatus === 'accepted' && source.current && !source.stale;
  const targets = Object.values(snap.collaboration?.tasks ?? {}).filter(task => {
    if (task.workItemId || task.key === sourceTaskKey || task.archived || !['draft', 'ready', 'blocked'].includes(task.status)) return false;
    const scope = Object.values(snap.collaboration?.tasks ?? {}).filter(item => item.taskId === task.taskId);
    const keys = new Set(scope.map(item => item.key));
    return !scope.some(item => item.activeRunId) &&
      !snap.collaboration?.submissions.some(submission => keys.has(submission.key)) &&
      !Object.values(snap.sessions).some(session => (session.taskId === task.taskId || session.runtime?.taskId === task.taskId) && session.runtime?.purpose !== 'discussion') &&
      !snap.collaboration?.handoffTransfers?.some(transfer => transfer.sourceTaskKey === sourceTaskKey && transfer.targetTaskKey === task.key) &&
      !Object.values(snap.collaboration?.runs ?? {}).some(run => keys.has(run.key) && run.purpose === 'execution');
  });
  const target = targets.find(task => task.key === targetTaskKey);
  const targetSpec = target ? snap.collaboration?.specs.filter(spec => spec.key === target.key).slice(-1)[0] : undefined;
  const valid = usable && (!targetTaskKey || !!target);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    titleInput.current?.focus();
    return () => { dialog.current?.close(); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); }); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || (!target && !title.trim()) || !valid) return;
    const input = target ? { sourceTaskKey, title: target.title, targetTaskKey: target.key, expectedTargetVersion: target.version, execute } : { sourceTaskKey, title: title.trim(), goal: goal.trim() || undefined, execute };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const result = await api.createTaskFromHandoff(snap.project.id, { ...input, idempotencyKey: request.current.key });
      // A dispatch failure can follow successful creation. Never invite another create.
      if (result.taskId) {
        toast(result.message || (result.ok ? '任务交接已保存' : '交接已保存，请在任务内继续处理'), result.ok ? 'info' : 'error');
        onClose(); openWorkspace(result.taskId, { view: 'tasks', focus: true, pane: 'main', selected: null });
      } else if (!result.ok) setError(result.message || '交接尚未保存，请重试。');
      else setError('未收到新任务编号，请重试核对同一次创建。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂未收到创建结果，请重试核对。'); }
    finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="qd-handoff-dialog" aria-labelledby="handoff-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => void submit(event)} aria-busy={busy}>
      <header><div><p>使用已验收的任务记忆</p><h2 id="handoff-dialog-title">{targetTaskKey ? '交接给任务' : '交给新任务'}</h2></div><button type="button" className="qd-icon-btn" aria-label="关闭交接" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></header>
      <div className="qd-handoff-source"><strong>{sourceTitle}</strong><span>{usable ? `已验收 · 任务要求 v${source.record.specRevision}` : '来源已变化，请先重新核对'}</span><p>{source?.record.content.summary || '这项任务还没有可交接的总结。'}</p></div>
      <label className="qd-handoff-field">交接到<select aria-label="交接到" value={targetTaskKey} disabled={busy} onChange={event => setTargetTaskKey(event.target.value)}><option value="">新建任务</option><optgroup label="已有未开始任务">{targets.map(task => <option key={task.key} value={task.key}>{task.title}</option>)}</optgroup></select></label>
      {target ? <div className="qd-handoff-target"><strong>{target.title}</strong><p>{targetSpec?.goal || '沿用该任务已有目标。'}</p><small>将保留已有目标，加入这次来源和依赖。</small></div> : !targetTaskKey ? <>
        <label className="qd-handoff-field">新任务名称<input ref={titleInput} value={title} maxLength={200} disabled={busy} required onChange={event => setTitle(event.target.value)} /></label>
        <label className="qd-handoff-field">这一步要完成什么<textarea value={goal} rows={3} maxLength={12000} disabled={busy} placeholder="补充新目标；来源总结和规范由系统固定带入。" onChange={event => setGoal(event.target.value)} /></label>
      </> : <p role="alert">目标任务已变化，请重新选择。</p>}
      <label className="qd-handoff-execute"><input type="checkbox" checked={execute} disabled={busy} onChange={event => setExecute(event.target.checked)} /><span>{targetTaskKey ? '交接后立即执行' : '创建后立即执行'}<small>使用当前项目默认 Agent，开启独立对话。</small></span></label>
      <p className="qd-handoff-boundary">将固定来源版本，并建立任务依赖。后续执行沿用这次交接。</p>
      {error && <p className="qd-handoff-error" role="alert">{error}</p>}
      <footer><button type="button" className="qd-btn ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="qd-btn primary" disabled={busy || (!target && !title.trim()) || !valid}>{busy ? '正在保存交接…' : targetTaskKey ? execute ? '交接并执行' : '交接给任务' : execute ? '创建并执行' : '创建交接任务'}</button></footer>
    </form>
  </dialog>, document.body);
}
