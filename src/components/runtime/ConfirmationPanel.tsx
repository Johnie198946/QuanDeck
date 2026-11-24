import { useEffect, useState } from 'react';
import { confirmationMessage, newConfirmationDraft, type ConfirmationDraft, type DiscussionResponse } from '../../data/discussionPresentation';
import { Icon } from '../ui/Icon';
import ReactMarkdown from 'react-markdown';
const InlineText = ({ text }: { text: string }) => <ReactMarkdown skipHtml unwrapDisallowed allowedElements={['strong', 'em', 'code', 'br', 'del']}>{text}</ReactMarkdown>;

export function ConfirmationPanel({ runId, messageId, value, disabled, onSend }: { runId: string; messageId: string; value: DiscussionResponse; disabled: boolean; onSend: (message: string, confirmedInformation: string[]) => Promise<boolean> }) {
  const key = `quandeck.confirmation-draft.v1:${runId}:${messageId}`;
  const [draft, setDraft] = useState<ConfirmationDraft>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      if (stored && Array.isArray(stored.selected) && stored.selected.every((v: unknown) => Number.isInteger(v)) && Array.isArray(stored.proposals) && stored.proposals.length === value.proposals.length && stored.proposals.every((v: unknown) => typeof v === 'string') && Array.isArray(stored.answers) && stored.answers.length === value.questions.length && stored.answers.every((v: unknown) => typeof v === 'string') && typeof stored.extra === 'string') return stored;
    } catch { /* A missing/invalid draft cannot pre-confirm anything. */ }
    return newConfirmationDraft(value);
  });
  const [storageError, setStorageError] = useState(false);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); setStorageError(false); } catch { setStorageError(true); } }, [key, draft]);
  const message = confirmationMessage(value, draft);
  const confirmedInformation = [...new Set(draft.selected)].filter(i => Number.isInteger(i) && i >= 0 && i < value.proposals.length).map(i => draft.proposals[i]?.trim()).filter(Boolean);
  value.questions.forEach((question, i) => { if (draft.answers[i]?.trim()) confirmedInformation.push(`${question}：${draft.answers[i].trim()}`); });
  if (draft.extra.trim()) confirmedInformation.push(draft.extra.trim());
  const count = draft.selected.length + draft.answers.filter(answer => answer.trim()).length + (draft.extra.trim() ? 1 : 0);
  return <aside className="qd-confirm-panel" aria-label="补充信息">
    <header><span className="qd-section-label">按需补充</span><h2><Icon name="check-square" size={20} />补充信息</h2><p>只需补充会影响方案的信息。</p></header>
    {draft.sent ? <div className="qd-confirm-sent" role="status"><Icon name="check-circle" size={22} /><strong>信息已保存</strong><p>已带回本轮讨论，不代表生成或启动执行任务。</p></div> : <form onSubmit={async event => { event.preventDefault(); if (message && !disabled && await onSend(message, confirmedInformation)) setDraft(old => ({ ...old, sent: true })); }}>
      {!!value.proposals.length && <fieldset disabled={disabled}><legend>可采用的要点 <span>{value.proposals.length}</span></legend>{value.proposals.map((_, index) => <div className={`qd-confirm-item ${draft.selected.includes(index) ? 'is-selected' : ''}`} key={index}>
        <label><input type="checkbox" checked={draft.selected.includes(index)} onChange={event => setDraft(old => ({ ...old, selected: event.target.checked ? [...old.selected, index] : old.selected.filter(v => v !== index) }))} /><span><InlineText text={draft.proposals[index]} /></span></label>
        <details><summary>修改这条信息</summary><textarea aria-label={`修改建议 ${index + 1}`} value={draft.proposals[index]} rows={3} onChange={event => setDraft(old => ({ ...old, proposals: old.proposals.map((text, i) => i === index ? event.target.value : text) }))} /><small>修改后勾选，才会发送这条信息。</small></details>
      </div>)}</fieldset>}
      {!!value.questions.length && <fieldset disabled={disabled}><legend>补充关键信息</legend>{value.questions.map((question, index) => <label className="qd-confirm-question" key={index}><span><InlineText text={question} /></span><textarea placeholder="填写你的回答，也可以稍后补充" rows={2} value={draft.answers[index]} onChange={event => setDraft(old => ({ ...old, answers: old.answers.map((text, i) => i === index ? event.target.value : text) }))} /></label>)}</fieldset>}
      <label className="qd-confirm-question qd-confirm-extra"><span>我还想补充</span><textarea disabled={disabled} placeholder="偏好、约束、不同意见…" rows={3} value={draft.extra} onChange={event => setDraft(old => ({ ...old, extra: event.target.value }))} /></label>
      <div className="qd-confirm-submit"><button className="primary" type="submit" disabled={disabled || !message}>保存信息并继续讨论{count > 0 ? ` · ${count} 项` : ''}<Icon name="arrow-right" size={16} /></button><small>仅发送已勾选和已填写的信息。</small></div>
      {storageError && <p className="qd-runtime-error" role="status">本机暂时无法保存草稿，请在关闭窗口前发送或复制。</p>}
    </form>}
  </aside>;
}
