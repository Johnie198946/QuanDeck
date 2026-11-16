import { useEffect, useId, useRef, useState } from 'react';
import type { DiscussionBlockFeedback, DiscussionFeedbackInput, DiscussionVisualBlock } from '../../data/discussionVisual';
import { Icon } from '../ui/Icon';

export type FeedbackReceipt = { ok?: boolean; message?: string; data?: { feedback?: DiscussionBlockFeedback } };
export interface CanvasFeedback {
  binding: DiscussionFeedbackInput['binding'];
  feedback?: DiscussionBlockFeedback[];
  onFeedback(input: DiscussionFeedbackInput): Promise<FeedbackReceipt>;
  disabled?: boolean;
  unavailableReason?: string;
}
type Action = DiscussionFeedbackInput['action'];
const actions: Record<Action, string> = { prefer: '偏好这个', reject: '换一个', request_change: '调整要求', comment: '补充意见' };

export function BlockFeedback({ block, optionId, title, context }: { block: DiscussionVisualBlock; optionId?: string; title: string; context?: CanvasFeedback }) {
  const history = context?.feedback?.filter(item => item.blockId === block.id && item.optionId === optionId) ?? [];
  const latest = history.at(-1);
  const [editing, setEditing] = useState<Action | null>(null), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<DiscussionBlockFeedback | null>(null);
  const [pending, setPending] = useState<DiscussionFeedbackInput | null>(null);
  const active = useRef(true), sending = useRef(false), field = useRef<HTMLTextAreaElement>(null), fieldId = useId();
  const current = receipt && (!latest || receipt.feedbackId === latest.feedbackId && latest.delivery !== 'sent' || Date.parse(receipt.recordedAt) > Date.parse(latest.recordedAt)) ? receipt : latest;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const disabled = !context || context.disabled || busy;
  async function submit(action: Action, retry?: DiscussionFeedbackInput) {
    if (!context || context.disabled || sending.current) return;
    const input: DiscussionFeedbackInput = retry ?? { binding: context.binding, blockId: block.id, blockHash: block.hash, ...(optionId ? { optionId } : {}), action, text: text.trim(), feedbackId: crypto.randomUUID() };
    sending.current = true; setBusy(true); setError(''); setPending(input);
    try {
      const result = await context.onFeedback(input);
      if (!active.current) return;
      if (result.data?.feedback) setReceipt(result.data.feedback);
      if (result.ok === false || result.data?.feedback?.delivery === 'failed') throw new Error(result.data?.feedback?.error || result.message || '反馈暂未发送，内容已保留。');
      setEditing(null); setText(''); setPending(null);

    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '操作暂未完成，内容已保留。'); }
    finally { sending.current = false; if (active.current) setBusy(false); }
  }
  const retry = pending ?? (current?.delivery === 'failed' ? current : null);
  return <div className="qd-block-feedback" data-feedback-block={block.id}>
    <div className="qd-visual-actions">
      <button type="button" disabled={disabled} aria-pressed={current?.action === 'prefer'} onClick={() => void submit('prefer')}><Icon name={current?.action === 'prefer' ? 'check' : 'star'} size={14} />{current?.action === 'prefer' ? '已记录偏好' : '偏好这个'}</button>
      <button type="button" disabled={disabled} onClick={() => { setEditing('request_change'); setError(''); }}>调整<Icon name="pencil" size={13} /></button>
      <button type="button" disabled={disabled} onClick={() => { setEditing('reject'); setError(''); }}>换一个</button>
      {busy && <span className="qd-visual-recorded" role="status">正在保存反馈…</span>}
    </div>
    {!context && <p className="qd-visual-feedback-reason">同步到项目后即可直接反馈。</p>}
    {context?.unavailableReason && <p className="qd-visual-feedback-reason">{context.unavailableReason}</p>}
    {editing && <form className="qd-visual-feedback" onSubmit={event => { event.preventDefault(); if (text.trim()) void submit(editing); }}>
      <header><div><strong>{actions[editing]} · {title}</strong><span>只针对这一项，不会确认整套方案。</span></div><button type="button" aria-label="取消本条反馈" disabled={busy} onClick={() => setEditing(null)}><Icon name="close" size={16} /></button></header>
      <label htmlFor={fieldId}>{editing === 'reject' ? '希望换成什么？' : '你希望怎么调整？'}</label>
      <textarea ref={field} id={fieldId} value={text} disabled={busy} onChange={event => { setText(event.target.value); setPending(null); }} placeholder="例如：更安静一些，保留河边散步…" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && text.trim()) { event.preventDefault(); void submit(editing); } }} />
      <div className="qd-visual-feedback-footer"><span>反馈会保存到项目并带上这项内容。</span><button type="submit" disabled={disabled || !text.trim()}>{busy ? '正在保存…' : '发送这条反馈'}<Icon name="send" size={14} /></button></div>
    </form>}
    {(error || current?.delivery === 'failed') && <div className="qd-visual-feedback-error" role="alert"><span>{error || current?.error || '反馈已记录，尚未发送给 Agent。'}</span>{retry && <button type="button" disabled={disabled} onClick={() => void submit(retry.action, retry)}>重试发送</button>}</div>}
    {!busy && !error && current && current.delivery !== 'failed' && <p className="qd-visual-feedback-receipt" role="status"><Icon name="check" size={14} />{current.delivery === 'sent' ? '已保存并发送给 Agent。' : '已保存到项目，后续讨论将使用。'}</p>}
    {history.length > 0 && <details className="qd-visual-feedback-history"><summary>你的反馈 · {history.length}</summary><ul>{[...history].reverse().map(item => <li key={item.feedbackId}><strong>{actions[item.action]}</strong>{item.text && <> · {item.text}</>}</li>)}</ul></details>}
  </div>;
}
