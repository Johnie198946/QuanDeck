import { useEffect, useMemo, useState } from 'react';
import { desktopHost, type RuntimeRunView, type RuntimeRequest } from '../../integration/desktop';
import './runtime-console.css';
const answerKey = (requestId: string, questionId: string) => JSON.stringify([requestId, questionId]);
const labels: Record<string, string> = { running: '运行中', queued: '排队', waiting_reply: '等待回复', waiting_permission: '等待授权', paused: '已暂停', failed: '执行失败', done: '已归档', cancelled: '已取消' };
export function RuntimeConsole({ runId }: { runId: string }) {
  const host = desktopHost()!;
  const [run, setRun] = useState<RuntimeRunView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; text: string }>>({});
  const refresh = () => host.getRun(runId).then(setRun).catch(e => setError(String(e.message || e)));
  useEffect(() => { void refresh(); return host.onRunEvent(event => { if (event.runId === runId) void refresh(); }); }, [runId]);
  useEffect(() => host.onStorageError(setError), []);
  const requests = useMemo(() => {
    const pending = new Map<string, RuntimeRequest>();
    for (const event of run?.events ?? []) { if (event.request) pending.set(event.request.id, event.request); if (event.requestResolved) pending.delete(event.requestResolved); }
    return ['paused', 'failed', 'done', 'cancelled'].includes(run?.status ?? '') ? [] : [...pending.values()];
  }, [run]);
  async function control(action: string, payload?: unknown) {
    if (busy) return; setBusy(true); setError('');
    try { const result = await host.controlRun(runId, action, payload); if (result?.ok === false) throw new Error(result.message); if ((payload as { prompt?: string } | undefined)?.prompt) setPrompt(''); const answeredRequest = (payload as { requestId?: string } | undefined)?.requestId; if (answeredRequest) setAnswers(old => Object.fromEntries(Object.entries(old).filter(([key]) => JSON.parse(key)[0] !== answeredRequest))); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '执行操作失败'); }
    finally { setBusy(false); }
  }
  function answer(request: RuntimeRequest) {
    const questions = request.questions ?? [];
    if (questions.some(q => !answers[answerKey(request.id, q.id)]?.selected.length && !answers[answerKey(request.id, q.id)]?.text.trim())) { setError('请填写每个问题后再发送'); return; }
    const value = run?.tool === 'dsh'
      ? { answers: questions.map(q => ({ id: q.id, selected: answers[answerKey(request.id, q.id)]?.selected ?? [], ...(answers[answerKey(request.id, q.id)]?.text.trim() ? { custom: answers[answerKey(request.id, q.id)].text.trim() } : {}) })) }
      : { answers: Object.fromEntries(questions.map(q => [q.id, { answers: [...(answers[answerKey(request.id, q.id)]?.selected ?? []), ...(answers[answerKey(request.id, q.id)]?.text.trim() ? [answers[answerKey(request.id, q.id)].text.trim()] : [])] }])) };
    void control('reply', { requestId: request.id, answer: value });
  }
  const targetSessionId = new URLSearchParams(location.search).get('child');
  const childView = Boolean(targetSessionId && targetSessionId !== run?.sessionId);
  const latestChild = [...(run?.events ?? [])].reverse().find(event => event.child?.sessionId === targetSessionId || event.child?.id === targetSessionId)?.child;
  const latest = run?.events.at(-1);
  const statusLabel = (status: string) => run?.protocol === 'legacy-rc2' && status === 'paused' ? '已停止' : labels[status];
  const messages = run?.events.filter(event => (event.message || event.error || event.notice) && (childView ? event.targetSessionId === targetSessionId : !event.targetSessionId || event.targetSessionId === run?.sessionId)) ?? [];
  return <main className="qd-runtime">
    <header className="qd-runtime-header"><div><span className="qd-runtime-eyebrow">QUANDECK · {run?.tool === 'dsh' ? 'DeepSeek Harness' : run?.tool === 'codex' ? 'Codex' : run?.tool === 'claude' ? 'Claude Code' : 'Agent'}</span><h1>{childView ? latestChild?.title || '子 Agent 会话' : run?.title || '任务会话'}</h1><p>{run?.projectPath}</p></div><span className={`qd-runtime-status state-${run?.status}`}>{statusLabel(childView ? latestChild?.status ?? '' : run?.status ?? '') || '连接中'}</span></header>
    <div className="qd-runtime-toolbar"><span>{latest?.step?.label || (run?.tokens != null ? `${run.tokens.toLocaleString()} token` : '')}</span><div>
      {childView && <button onClick={() => void host.openRun(runId)}>返回主 Agent 会话</button>}
      {!childView && <>
      {['running', 'queued', 'waiting_permission'].includes(run?.status ?? '') && <button disabled={busy} onClick={() => void control('stop')}>{run?.protocol === 'legacy-rc2' ? '停止执行' : '暂停'}</button>}
      {['paused', 'failed'].includes(run?.status ?? '') && run?.controls?.canResume !== false && <button disabled={busy} onClick={() => void control('resume')}>继续</button>}
      {!['done', 'cancelled'].includes(run?.status ?? '') && <button disabled={busy} onClick={() => void control('cancel')}>取消任务</button>}
      {['waiting_reply', 'paused', 'failed'].includes(run?.status ?? '') && <button disabled={busy} onClick={() => void control('archive')}>归档本次执行</button>}
    </>}
    </div></div>
    <section className="qd-runtime-transcript" aria-label="源执行会话">
      {!childView && run?.prompt && <details className="qd-runtime-brief"><summary>本次任务与方法</summary><pre>{run.prompt}</pre></details>}
      {childView && latestChild?.reply && messages.length === 0 && <article><pre>{latestChild.reply}</pre></article>}
      {childView && <p className="qd-runtime-empty">子 Agent 的进度与回复；需要补充要求时返回主会话。</p>}
      {!childView && messages.length === 0 && <p className="qd-runtime-empty">{run?.status === 'running' ? 'Agent 正在处理，回复会显示在这里。' : '等待源端消息'}</p>}
      {messages.map(event => <article key={event.id} className={event.error ? 'qd-runtime-error-message' : ''}><small>{event.message?.role === 'user' ? '你 · ' : 'Agent · '}{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><pre>{event.message?.text || event.error || event.notice}</pre></article>)}
    </section>
    {!childView && requests.map(request => <section className="qd-runtime-request" key={request.id}>
      <strong>{request.kind === 'permission' ? '需要你的授权' : '需要你的回复'}</strong><p>{request.prompt}</p>{request.details && <pre className="qd-runtime-request-details">{request.details}</pre>}{request.targetSessionId && request.targetSessionId !== run?.sessionId && <small>子 Agent：{request.targetSessionId}</small>}
      {request.kind === 'permission' ? <div className="qd-runtime-actions"><button disabled={busy} onClick={() => void control('reply', { requestId: request.id, decision: 'rejected' })}>拒绝</button><button className="primary" disabled={busy} onClick={() => void control('reply', { requestId: request.id, decision: 'allowed-once' })}>允许本次</button></div> : <>
        {(request.questions ?? []).map(question => <fieldset key={question.id}><legend>{question.question || question.title || question.header}</legend>
          {(question as { detail?: string }).detail && <pre>{(question as { detail?: string }).detail}</pre>}
          {question.options?.map(option => <label className="qd-runtime-option" key={option.label}><input type={(question as { multiSelect?: boolean }).multiSelect ? 'checkbox' : 'radio'} name={answerKey(request.id, question.id)} checked={answers[answerKey(request.id, question.id)]?.selected.includes(option.label) || false} onChange={e => setAnswers(old => ({ ...old, [answerKey(request.id, question.id)]: { text: (question as { multiSelect?: boolean }).multiSelect ? old[answerKey(request.id, question.id)]?.text ?? '' : '', selected: (question as { multiSelect?: boolean }).multiSelect ? e.target.checked ? [...(old[answerKey(request.id, question.id)]?.selected ?? []), option.label] : (old[answerKey(request.id, question.id)]?.selected ?? []).filter(v => v !== option.label) : [option.label] } }))} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
          <input aria-label={`${question.question || question.header}：补充回答`} placeholder="填写回答" value={answers[answerKey(request.id, question.id)]?.text ?? ''} onChange={e => setAnswers(old => ({ ...old, [answerKey(request.id, question.id)]: { selected: (question as { multiSelect?: boolean }).multiSelect ? old[answerKey(request.id, question.id)]?.selected ?? [] : [], text: e.target.value } }))} />
        </fieldset>)}
        <button className="primary" disabled={busy || !request.questions?.length} onClick={() => answer(request)}>发送回答</button>
      </>}
    </section>)}
    {error && <p role="alert" className="qd-runtime-error">{error}</p>}
    {!childView && run?.controls?.reason && <p className="qd-runtime-empty" role="status">{run.controls.reason}</p>}
    {!childView && run?.controls?.canReply !== false && !['done', 'cancelled'].includes(run?.status ?? '') && requests.length === 0 && <form className="qd-runtime-composer" onSubmit={event => { event.preventDefault(); if (prompt.trim()) void control('reply', { prompt: prompt.trim() }); }}><textarea aria-label="回复 Agent" placeholder="继续沟通，补充要求…" value={prompt} rows={3} onChange={e => setPrompt(e.target.value)} /><button className="primary" disabled={busy || !prompt.trim() || ['running', 'queued'].includes(run?.status ?? '')}>发送</button></form>}
    <footer className="qd-runtime-footer">{run?.sessionId && <span>会话 {targetSessionId || run.sessionId}</span>}</footer>
  </main>;
}
