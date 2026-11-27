import { useId, useRef, useState, type FormEvent } from 'react';
import type { PresentedResult } from '../../data/resultPresentation';
import { resultReplyTarget, type ResultReplyTarget } from '../../data/resultReply';
import type { Snapshot } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import './result-reply.css';

interface Props { snapshot: Snapshot; taskId: string; entry: PresentedResult }
interface Draft { text: string; messageId: string; target?: ResultReplyTarget }

function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved && typeof saved.text === 'string' && typeof saved.messageId === 'string') return saved;
  } catch { /* Private browsing can disable storage. */ }
  return { text: '', messageId: '' };
}

function storeDraft(key: string, draft: Draft) {
  try {
    if (draft.text) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch { /* The in-memory draft still works. */ }
}

export function ResultReply(props: Props) {
  const { snapshot, taskId, entry } = props;
  const key = 'quandeck.result-reply.' + JSON.stringify([snapshot.project.id, taskId, entry.artifactId ?? entry.record.id, entry.record.at, entry.sessionId]);
  return <ReplyForm key={key} {...props} draftKey={key} />;
}

function ReplyForm({ snapshot, taskId, entry, draftKey }: Props & { draftKey: string }) {
  const { api, refreshProjects } = useWorkdeck();
  const inputId = useId();
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const { target, reason } = resultReplyTarget(snapshot, taskId, entry);
  const agent = target && (snapshot.agents.find(value => value.id === target.agentId)?.name ?? target.agentId);

  const ledger = snapshot.collaboration;
  const submission = entry.artifactId && ledger?.submissions.find(item => item.artifactId === entry.artifactId);
  const lastReview = submission && [...(ledger?.reviews ?? [])].reverse().find(review =>
    review.submissionId === submission.id && review.reviewer === '用户回复成果' && review.verdict === 'needs_changes' && review.note);
  const priorComment = lastReview ? <div className="qd-result-reply-previous">
    <strong>我的修改意见</strong><p>{lastReview.note}</p>
  </div> : null;
  // A lost acknowledgement can change the visible result's status. Reuse only
  // the original version and message ID so the server can reconcile the send.
  const retryTarget = draft.messageId && draft.target?.projectId === snapshot.project.id &&
    draft.target.taskId === taskId && (entry.artifactId ? draft.target.artifactId === entry.artifactId :
      draft.target.sessionId === entry.sessionId && !draft.target.artifactId) ? draft.target : undefined;
  const recipient = target ?? retryTarget;

  function edit(text: string) {
    const value = { text, messageId: '' };
    setDraft(value);
    storeDraft(draftKey, value);
    setFeedback(null);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !recipient || !draft.text.trim()) return;
    busy.current = true;
    setSending(true);
    setFeedback(null);
    const pending = { ...draft, target: recipient, messageId: draft.messageId || crypto.randomUUID() };
    setDraft(pending);
    storeDraft(draftKey, pending);
    try {
      const reply = await api.replyToResult({ target: recipient, text: pending.text.trim(), messageId: pending.messageId });
      if (!reply.ok) throw new Error(reply.message || '发送失败，请重试。');
      // A second viewer may have edited its own draft while this request was in flight.
      if (readDraft(draftKey).messageId === pending.messageId) storeDraft(draftKey, { text: '', messageId: '' });
      setDraft({ text: '', messageId: '' });
      setFeedback({ text: reply.message || ('已发给 ' + agent) });
      void refreshProjects().catch(() => {});
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : '未能确认发送，请重试。', error: true });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  if (!target && !sending && !feedback && !draft.text) {
    return <>{priorComment}{reason && <p className="qd-result-reply-note">{reason}</p>}</>;
  }
  return <form className="qd-result-reply" aria-label="回复成果" onSubmit={send}>
    {priorComment}
    <label htmlFor={inputId}><Icon name="reply" size={16} />{agent ? '回复 ' + agent : '修改意见'}</label>
    <div className="qd-result-reply-field">
      <textarea id={inputId} rows={2} maxLength={5000} placeholder="希望哪里改一下？" value={draft.text}
        readOnly={sending} onChange={event => edit(event.target.value)} onKeyDown={event => {
          if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
      <button type="submit" disabled={sending || !recipient || !draft.text.trim()}>
        <Icon name="send" size={14} />{sending ? '正在发送…' : '继续修改'}
      </button>
    </div>
    <div role={feedback?.error ? 'alert' : 'status'} className={feedback?.error ? 'is-error' : ''}>
      {feedback?.text || (!target && !sending ? reason : '')}
    </div>
  </form>;
}
