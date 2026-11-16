import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';

function IntakeItem({ inputId, onManualMode }: { inputId: string; onManualMode: () => void }) {
  const { snap, api, locateTask } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intelligence = snap.intelligence;
  const intake = intelligence?.intakes.find(input => input.id === inputId);
  const state = intelligence?.intakeStates[inputId];
  if (!intake || !state) return null;
  const result = intelligence?.classifications.find(classification => classification.id === state.classificationId)?.result;
  const taskId = state.taskId ?? result?.existingTaskId;
  const working = state.status === 'queued' || state.status === 'running';
  const title = taskId ? snap.tasks[taskId]?.title : undefined;
  const label = state.status === 'failed' ? '识别失败'
    : state.status === 'queued' ? '待识别'
    : state.status === 'running' ? '识别中'
    : result?.decision === 'auto_create' ? 'AI 创建'
    : result?.decision === 'duplicate' ? '已有待办'
    : result?.decision === 'suggest_manual' ? '待确认'
    : result?.decision === 'keep_note' ? '已记下' : '已处理';
  const heading = title || intake.text.trim().split('\n')[0];
  const retry = async () => {
    setBusy(true); setError('');
    try { const response = await api.retryIntake(inputId, snap.project.id); if (!response.ok) throw new Error(response.message || '重试未能开始'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '重试失败'); }
    finally { setBusy(false); }
  };
  return <details className={`qd-intake-feedback-item ${state.status === 'failed' ? 'is-error' : working ? 'is-working' : ''}`}>
    <summary><Icon name={working ? 'clock' : state.status === 'failed' ? 'alert' : 'check'} size={13} /><span>{label}</span><strong>{heading}</strong><Icon name="chevron-down" size={12} /></summary>
    <div className="qd-intake-detail">
      <p>{intake.text}</p>
      {state.status === 'failed' && <small>{state.error === '系统分析源端错误' ? 'Agent 未能完成识别，原文已保留。可以重试或手动创建。' : state.error || '原文已保留，可重试或手动创建。'}</small>}
      {result?.decision === 'suggest_manual' && result.reason && <small>{result.reason}</small>}
      <div className="qd-intake-inline-actions">
        {taskId && snap.tasks[taskId] && <button type="button" onClick={() => locateTask(taskId)}>查看待办</button>}
        {state.status === 'failed' && <button type="button" disabled={busy} onClick={() => void retry()}>{busy ? '重试中…' : '重试识别'}</button>}
        {(state.status === 'failed' || result?.decision === 'suggest_manual') && <button type="button" onClick={onManualMode}>手动创建</button>}
      </div>
      {error && <p className="qd-intake-local-error" role="alert">{error}</p>}
    </div>
  </details>;
}

/** Only per-input outcomes are visible; project ledger and summaries remain machine context. */
export function IntakeFeedback({ onManualMode }: { onManualMode: () => void }) {
  const { snap } = useWorkdeck();
  const [limit, setLimit] = useState(10);
  const intakes = snap.intelligence?.intakes.slice().reverse() ?? [];
  if (!intakes.length) return null;
  const ongoing = intakes.filter(input => ['queued', 'running'].includes(snap.intelligence!.intakeStates[input.id]?.status)).length;
  return <div className="qd-intake-feedback">
    <div role="status" aria-live="polite" aria-atomic="true"><IntakeItem inputId={intakes[0].id} onManualMode={onManualMode} /></div>
    {intakes.length > 1 && <details className="qd-intake-history"><summary>{ongoing ? `${ongoing} 条正在识别 · ` : ''}较早的输入记录（{intakes.length - 1}）</summary><div>{intakes.slice(1, limit + 1).map(input => <IntakeItem key={input.id} inputId={input.id} onManualMode={onManualMode} />)}{intakes.length > limit + 1 && <button type="button" className="qd-intake-link" onClick={() => setLimit(value => value + 10)}>查看更多</button>}</div></details>}
  </div>;
}
