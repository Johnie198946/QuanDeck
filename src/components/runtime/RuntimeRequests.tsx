import { useState } from 'react';
import type { RuntimeRequest } from '../../integration/desktop';
import { MarkdownMessage } from './RichMessage';

export function RuntimeRequests({ requests, runId, tool, busy, onControl }: { requests: RuntimeRequest[]; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  return <>{requests.map(request => <RuntimeRequestForm key={request.id} request={request} runId={runId} tool={tool} busy={busy} onControl={onControl} />)}</>;
}
function RuntimeRequestForm({ request, runId, tool, busy, onControl }: { request: RuntimeRequest; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; text: string }>>({});
  const [error, setError] = useState('');
  const questions = request.questions ?? [];
  const answer = async () => {
    if (questions.some(q => !answers[q.id]?.selected.length && !answers[q.id]?.text.trim())) { setError('请填写每个问题后再发送'); return; }
    const value = tool === 'dsh'
      ? { answers: questions.map(q => ({ id: q.id, selected: answers[q.id]?.selected ?? [], ...(answers[q.id]?.text.trim() ? { custom: answers[q.id].text.trim() } : {}) })) }
      : { answers: Object.fromEntries(questions.map(q => [q.id, { answers: [...(answers[q.id]?.selected ?? []), ...(answers[q.id]?.text.trim() ? [answers[q.id].text.trim()] : [])] }])) };
    await onControl('reply', { requestId: request.id, answer: value });
  };
  return <section className="qd-runtime-request" aria-label={request.kind === 'permission' ? '操作授权' : 'Agent 提问'}>
    <h2>{request.kind === 'permission' ? '需要你的授权' : '需要你的回复'}</h2><MarkdownMessage text={request.prompt} runId={runId} />
    {request.details && <details><summary>查看操作详情</summary><pre>{request.details}</pre></details>}
    {request.targetSessionId && <small>来源会话 {request.targetSessionId}</small>}
    {request.kind === 'permission' ? <div className="qd-runtime-actions"><button disabled={busy} onClick={() => void onControl('reply', { requestId: request.id, decision: 'rejected' })}>拒绝</button><button className="primary" disabled={busy} onClick={() => void onControl('reply', { requestId: request.id, decision: 'allowed-once' })}>允许本次</button></div> : <>
      {questions.map(question => {
        const multi = (question as { multiSelect?: boolean }).multiSelect;
        return <fieldset key={question.id} disabled={busy}><legend>{question.question || question.title || question.header}</legend>
          {question.options?.map(option => <label className="qd-runtime-option" key={option.label}><input type={multi ? 'checkbox' : 'radio'} name={`${request.id}:${question.id}`} checked={answers[question.id]?.selected.includes(option.label) || false} onChange={event => setAnswers(old => ({ ...old, [question.id]: { text: multi ? old[question.id]?.text ?? '' : '', selected: multi ? event.target.checked ? [...(old[question.id]?.selected ?? []), option.label] : (old[question.id]?.selected ?? []).filter(v => v !== option.label) : [option.label] } }))} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
          <textarea aria-label={`${question.question || question.header}：补充回答`} placeholder="也可以自己填写回答" rows={2} value={answers[question.id]?.text ?? ''} onChange={event => setAnswers(old => ({ ...old, [question.id]: { selected: multi ? old[question.id]?.selected ?? [] : [], text: event.target.value } }))} />
        </fieldset>;
      })}
      {error && <p className="qd-runtime-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !questions.length} onClick={() => void answer()}>发送回答</button>
    </>}
  </section>;
}
