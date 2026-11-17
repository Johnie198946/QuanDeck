import { redactRuntimeText } from '../../data/runtimePresentation';
import { useState } from 'react';
import type { RuntimeRequest, RuntimePermissionOption } from '../../integration/desktop';
import { MarkdownMessage } from './RichMessage';
import './runtime-approvals.css';

export function RuntimeRequests({ requests, runId, tool, busy, onControl }: { requests: RuntimeRequest[]; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  return <>{requests.map(request => <RuntimeRequestForm key={request.id} request={request} runId={runId} tool={tool} busy={busy} onControl={onControl} />)}</>;
}
function RuntimeRequestForm({ request, runId, tool, busy, onControl }: { request: RuntimeRequest; runId: string; tool?: string; busy: boolean; onControl: (action: string, payload?: unknown) => Promise<boolean> }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; text: string }>>({});
  const [error, setError] = useState('');
  const questions = request.questions ?? [];
  const permissionOptions: RuntimePermissionOption[] = request.permissionOptions ?? [
    { id: 'legacy-once', scope: 'once', label: '允许本次', description: '历史请求只记录了单次授权。' },
    { id: 'legacy-deny', scope: 'deny', label: '拒绝', description: '不批准当前操作。' },
  ];
  const source = ({ codex: 'Codex', claude: 'Claude', dsh: 'DeepSeek Harness', hermes: 'Hermes' } as Record<string, string>)[request.permissionSource || tool || ''] || '源 Agent';
  const respond = (option: RuntimePermissionOption) => onControl('reply', { requestId: request.id, ...(request.permissionOptions ? { approvalOptionId: option.id } : { decision: option.scope === 'once' ? 'allowed-once' : 'rejected' }) });
  const answer = async () => {
    if (questions.some(q => !answers[q.id]?.selected.length && !answers[q.id]?.text.trim())) { setError('请填写每个问题后再发送'); return; }
    const value = tool === 'dsh'
      ? { answers: questions.map(q => ({ id: q.id, selected: answers[q.id]?.selected ?? [], ...(answers[q.id]?.text.trim() ? { custom: answers[q.id].text.trim() } : {}) })) }
      : { answers: Object.fromEntries(questions.map(q => [q.id, { answers: [...(answers[q.id]?.selected ?? []), ...(answers[q.id]?.text.trim() ? [answers[q.id].text.trim()] : [])] }])) };
    await onControl('reply', { requestId: request.id, answer: value });
  };
  return <section className="qd-runtime-request" aria-label={request.kind === 'permission' ? '操作授权' : 'Agent 提问'}>
    <h2>{request.kind === 'permission' ? `${source} 请求工具授权` : `${source} 有一个问题`}</h2>
    <p className="qd-approval-origin">{request.kind === 'permission' ? '这是源 Agent 发来的操作权限请求。方案已确认不会自动批准工具权限；这里也不是 macOS 或 Windows 系统弹窗。' : '这是补充信息或任务决策，不会改变工具权限。'}</p><MarkdownMessage text={request.prompt} runId={runId} />
    {request.details && <details><summary>查看操作详情</summary><pre>{redactRuntimeText(request.details)}</pre></details>}
    {request.targetSessionId && <small>来源会话 {request.targetSessionId}</small>}
    {request.kind === 'permission' ? <>
      <div className="qd-approval-choices" aria-label="源 Agent 提供的授权范围">
        {permissionOptions.filter(option => !['deny', 'cancel'].includes(option.scope)).map(option => <div className="qd-approval-choice" key={option.id}>
          <button disabled={busy} onClick={() => void respond(option)}><strong>{option.label}</strong><small>{option.description}</small></button>
          {option.rule && <details><summary>{option.detailLabel || `查看要记住的${option.label.includes('网站') ? '网站' : '命令前缀'}`}</summary><pre>{redactRuntimeText(option.rule)}</pre></details>}
        </div>)}
      </div>
      {!permissionOptions.length && <p role="status">此请求没有提供当前版本可处理的选项，请在源 Agent 中查看。</p>}
      <details className="qd-approval-policy"><summary>为什么这里可能比原 Agent 询问更多？</summary><p>QuanDeck 为每次独立执行创建或恢复源会话。当前 Codex 执行使用工作区写入沙箱和按需审批，可能与 Codex 原界面的设置不同。会话授权只适用于当前源会话；命令或网站规则由源 Agent 保存和判断，其他操作仍可能询问。</p></details>
      <div className="qd-runtime-actions">{permissionOptions.filter(option => ['deny', 'cancel'].includes(option.scope)).map(option => <button key={option.id} disabled={busy} onClick={() => void respond(option)}>{option.label}</button>)}</div>
    </> : <>
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
