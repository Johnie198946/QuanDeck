import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { taskSessions } from '../../data/derive';
import { canReplyToTask, readTaskInputDraft, storeTaskInputDraft, clearTaskInputDraft, newTaskInputDraft } from '../../data/taskInput';
import type { RuntimeCommands } from '../../data/runtimeContracts';

function SavedInputs({ inputs, onClose }: { inputs: { id: string; text: string }[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="qd-input-reader" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><span>任务资料</span><h2 id={titleId}>已保存的补充</h2></div><button type="button" className="qd-btn ghost" onClick={onClose}>关闭</button></header>
    <div className="qd-input-reader-body">{inputs.map((input, index) => <article key={input.id}><span className="qd-input-number">补充 {index + 1}</span><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }) => <span>{alt || '图片'}</span> }}>{input.text}</ReactMarkdown></article>)}</div>
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
  const [target, setTarget] = useState('');
  const [showInputs, setShowInputs] = useState(false);
  const pending = useRef<string | null>(null), activeKey = useRef<string | null>(storageKey);
  const runtime = api as Partial<RuntimeCommands>;
  const targets = taskSessions(snap, task).filter(session => canReplyToTask(snap, session));
  const selected = targets.find(session => session.id === target) ?? targets[0];

  useEffect(() => {
    activeKey.current = storageKey; pending.current = null;
    setDraft(readDraft(storageKey)); setError(''); setNotice(''); setBusy(false); setTarget(''); setShowInputs(false);
    return () => { if (activeKey.current === storageKey) activeKey.current = null; };
  }, [storageKey]);
  const changeDraft = (text: string) => {
    const next = newTaskInputDraft(text);
    setDraft(next); setNotice(''); setError('');
    try { storeTaskInputDraft(localStorage, storageKey, next); } catch { /* The editable draft remains in memory. */ }
  };
  const submit = async (send: boolean) => {
    if (pending.current || !draft.text.trim()) return;
    const submitted = draft, requestId = crypto.randomUUID();
    const isCurrent = () => activeKey.current === storageKey && pending.current === requestId;
    pending.current = requestId; setBusy(true); setError(''); setNotice('');
    try {
      if (send && (!selected || !runtime.controlSession)) throw new Error('会话状态已变化，请先保存到任务或打开会话');
      const result = send
        ? await runtime.controlSession!(selected.id, 'reply', { prompt: submitted.text.trim() })
        : await api.addTaskInput(projectId, taskId, submitted.text.trim(), submitted.id);
      if (!result.ok) throw new Error(result.message ?? '未能保存，请重试');
      try { clearTaskInputDraft(localStorage, storageKey, submitted); } catch { /* The acknowledged draft can safely be retried with the same ID. */ }
      if (isCurrent()) {
        setDraft(current => current.id === submitted.id && current.text === submitted.text ? newTaskInputDraft() : current);
        setNotice(send ? `已发送给 ${agentOf(selected.agentId).name}` : '已保存，下次派发时交给 Agent');
      }
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '操作失败，输入内容已保留'); }
    finally { if (isCurrent()) { pending.current = null; setBusy(false); } }
  };

  return <div className="qd-task-input">
    <label htmlFor={fieldId}>补充要求或记录进展</label>
    <textarea id={fieldId} value={draft.text} disabled={busy} rows={2} placeholder="告诉 Agent 具体要求，或记下你已完成的部分…"
      onChange={event => changeDraft(event.target.value)} aria-describedby={`${fieldId}-feedback`}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit(false); } }} />
    <div className="qd-task-input-actions">
      <span id={`${fieldId}-feedback`} role={error ? 'alert' : 'status'} className={error ? 'is-error' : ''}>{error || notice || '保存后会随下次任务一起发送'}</span>
      {targets.length > 1 && <select aria-label="选择续谈会话" value={selected?.id ?? ''} onChange={event => setTarget(event.target.value)} disabled={busy}>
        {targets.map(session => <option key={session.id} value={session.id}>{agentOf(session.agentId).name} · {session.title}</option>)}
      </select>}
      <button type="button" className="qd-btn ghost" disabled={busy || !draft.text.trim()} onClick={() => void submit(false)}>{busy ? '处理中…' : '保存到任务'}</button>
      {selected && runtime.controlSession && <button type="button" className="qd-btn primary" disabled={busy || !draft.text.trim()} onClick={() => void submit(true)}>发给 {agentOf(selected.agentId).name}</button>}
    </div>
    {!!task.inputs?.length && <section className="qd-task-input-history" aria-label="已保存的补充">
      <div><span>已保存 {task.inputs.length} 条补充</span><button type="button" className="qd-link" onClick={() => setShowInputs(true)}>查看全部 ↗</button></div>
      <p>{task.inputs[task.inputs.length - 1].text.replace(/\s+/g, ' ').trim()}</p>
    </section>}
    {showInputs && <SavedInputs inputs={task.inputs ?? []} onClose={() => setShowInputs(false)} />}
  </div>;
}
