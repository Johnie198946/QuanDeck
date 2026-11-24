import { redactRuntimeText } from '../../data/runtimePresentation';
import { useId, useRef, useState } from 'react';
import { desktopHost } from '../../integration/desktop';
import type { RuntimeRequest, RuntimePermissionOption } from '../../integration/desktop';
import { MarkdownMessage } from './RichMessage';
import './runtime-approvals.css';

export function RuntimeRequests({ requests, runId, tool, busy, onControl, compact }: { compact?: boolean; requests: RuntimeRequest[]; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  return <>{requests.map(request => <RuntimeRequestForm key={request.token || request.id} compact={compact} request={request} runId={runId} tool={tool} busy={busy} onControl={onControl} />)}</>;
}
function RuntimeRequestForm({ request, runId, tool, busy, onControl, compact }: { compact?: boolean; request: RuntimeRequest; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  const fieldGroup = useId();
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; text: string }>>({});
  const [error, setError] = useState('');
  const switching = useRef(false);
  const [switchBusy,setSwitchBusy] = useState(false);
  const host = desktopHost();
  const canDelegate = !!(request.canDelegateToAI && request.permissionSource === 'codex' && host?.setCodexApprovalMode);
  const delegate = async () => {
    if (!host?.setCodexApprovalMode || switching.current) return;
    switching.current = true;
    setSwitchBusy(true);
    setError('');
    try {
      await host.setCodexApprovalMode('ai');
      if (!await onControl('reply',{ requestId:request.id, requestToken:request.token, delegateToAI:true }))
        setError('后续任务已设为 AI 审批。请查看当前任务的提示。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能切换审批方式，请重试。');
    } finally {
      switching.current = false;
      setSwitchBusy(false);
    }
  };
  const questions = request.questions ?? [];
  const permissionOptions: RuntimePermissionOption[] = request.permissionOptions ?? [
    { id: 'legacy-once', scope: 'once', label: '允许本次', description: '历史请求只记录了单次授权。' },
    { id: 'legacy-deny', scope: 'deny', label: '拒绝', description: '不批准当前操作。' },
  ];
  const source = ({ codex: 'Codex', claude: 'Claude', dsh: 'DeepSeek Harness', hermes: 'Hermes' } as Record<string, string>)[request.permissionSource || tool || ''] || '源 Agent';
  const respond = (option: RuntimePermissionOption) => onControl('reply', { requestId: request.id, requestToken:request.token, ...(request.permissionOptions ? { approvalOptionId: option.id } : { decision: option.scope === 'once' ? 'allowed-once' : 'rejected' }) });
  const answer = async () => {
    if (questions.some(q => !answers[q.id]?.selected.length && !answers[q.id]?.text.trim())) { setError('请填写每个问题后再发送'); return; }
    const value = tool === 'dsh'
      ? { answers: questions.map(q => ({ id: q.id, selected: answers[q.id]?.selected ?? [], ...(answers[q.id]?.text.trim() ? { custom: answers[q.id].text.trim() } : {}) })) }
      : { answers: Object.fromEntries(questions.map(q => [q.id, { answers: [...(answers[q.id]?.selected ?? []), ...(answers[q.id]?.text.trim() ? [answers[q.id].text.trim()] : [])] }])) };
    await onControl('reply', { requestId: request.id, requestToken:request.token, answer: value });
  };
  return <section className="qd-runtime-request" aria-label={request.kind === 'permission' ? '操作授权' : 'Agent 提问'}>
    <h2>{request.kind === 'permission' ? `${source} 请求工具授权` : `${source} 有一个问题`}</h2>
    {!compact && <p className="qd-approval-origin">{request.kind === 'permission' ? '选择这次操作的授权方式。' : '回复后，任务会继续。'}</p>}<MarkdownMessage text={request.prompt} runId={runId} />
    {request.details && <details><summary>查看操作详情</summary><pre>{redactRuntimeText(request.details)}</pre></details>}
    {!compact && request.targetSessionId && <small>来源会话 {request.targetSessionId}</small>}
    {request.kind === 'permission' ? <>
      {canDelegate && <div className="qd-delegate-approval">
        <button type="button" className="qd-btn primary" disabled={busy || switchBusy} onClick={() => void delegate()}>{switchBusy ? '正在切换…' : '以后由 AI 审批'}</button>
        <small>Codex 会接着做这项任务，自己决定是否放行。今后本机新开的 Codex 任务沿用此设置，可在「本地 Agent」改回。</small>
      </div>}
      {error && <p role="alert" className="qd-runtime-error">{error}</p>}
      <div className="qd-approval-choices" aria-label="源 Agent 提供的授权范围">
        {permissionOptions.filter(option => !['deny', 'cancel'].includes(option.scope)).map(option => <div className="qd-approval-choice" key={option.id}>
          <button type="button" disabled={busy || switchBusy} onClick={() => void respond(option)}><strong>{option.label}</strong><small>{option.description}</small></button>
          {option.rule && <details><summary>{option.detailLabel || `查看要记住的${option.label.includes('网站') ? '网站' : '命令前缀'}`}</summary><pre>{redactRuntimeText(option.rule)}</pre></details>}
        </div>)}
      </div>
      {!permissionOptions.length && <p role="status">此请求没有提供当前版本可处理的选项，请在源 Agent 中查看。</p>}
      {!compact && <details className="qd-approval-policy"><summary>在哪里设置工具授权？</summary><p>在「设置 → 本地 Agent → Codex 工具授权」选择人工审批、AI 决策或完全放开。新设置从下一轮 Codex 任务生效。当前请求仍可在这里处理。其他 Agent 使用各自的授权方式。</p></details>}
      <div className="qd-runtime-actions">{permissionOptions.filter(option => ['deny', 'cancel'].includes(option.scope)).map(option => <button key={option.id} type="button" disabled={busy || switchBusy} onClick={() => void respond(option)}>{option.label}</button>)}</div>
    </> : <>
      {questions.map(question => {
        const multi = (question as { multiSelect?: boolean }).multiSelect;
        return <fieldset key={question.id} disabled={busy}><legend>{question.question || question.title || question.header}</legend>
          {question.options?.map(option => <label className="qd-runtime-option" key={option.label}><input type={multi ? 'checkbox' : 'radio'} name={`${fieldGroup}:${question.id}`} checked={answers[question.id]?.selected.includes(option.label) || false} onChange={event => setAnswers(old => ({ ...old, [question.id]: { text: multi ? old[question.id]?.text ?? '' : '', selected: multi ? event.target.checked ? [...(old[question.id]?.selected ?? []), option.label] : (old[question.id]?.selected ?? []).filter(v => v !== option.label) : [option.label] } }))} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
          <textarea aria-label={`${question.question || question.header}：补充回答`} placeholder="也可以自己填写回答" rows={2} value={answers[question.id]?.text ?? ''} onChange={event => setAnswers(old => ({ ...old, [question.id]: { selected: multi ? old[question.id]?.selected ?? [] : [], text: event.target.value } }))} />
        </fieldset>;
      })}
      {error && <p className="qd-runtime-error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !questions.length} onClick={() => void answer()}>发送回答</button>
    </>}
  </section>;
}
