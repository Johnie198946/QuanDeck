import { useState } from 'react';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { Icon } from '../ui/Icon';
import { redactRuntimeText } from '../../data/runtimePresentation';
import './intake.css';

/** A small confirmation queue in the existing journal, without a separate management page. */
export function SuggestionNotice() {
  const { snap, api } = useWorkdeck();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const suggestions = Object.values(snap.intelligence?.suggestions ?? {}).filter(suggestion => suggestion.status === 'pending');
  const summary = snap.intelligence?.summaryState;
  const retry = async () => {
    setBusyId('refresh'); setError('');
    try { const result = await api.refreshProjectSummary(snap.project.id); if (!result.ok) throw new Error(result.message || '重试未能开始'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '重试失败'); }
    finally { setBusyId(''); }
  };
  const resolve = async (id: string, decision: 'accepted' | 'rejected') => {
    setBusyId(id); setError(''); setNotice('');
    try {
      const result = await api.resolveSuggestion(id, decision, snap.project.id);
      if (!result.ok) throw new Error(result.message || '建议处理失败');
      setNotice(result.message || (decision === 'accepted' ? '已确认这项建议。' : '已忽略这项建议。'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '建议处理失败'); }
    finally { setBusyId(''); }
  };
  if (!suggestions.length && summary?.status !== 'failed' && summary?.status !== 'running' && !notice && !error) return null;
  return <div>
    {!!suggestions.length && <section className="qd-next-actions" aria-label="下一步行动建议">
      <button type="button" className="qd-next-actions-toggle" aria-expanded={open} aria-controls="qd-next-actions-list" onClick={() => setOpen(value => !value)}><Icon name="check-square" size={15} /><span>发现 {suggestions.length} 项下一步行动</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></button>
      {open && <><ul id="qd-next-actions-list" className="qd-next-actions-list">{suggestions.map(suggestion => <li key={suggestion.id}><h3>{suggestion.title}</h3>{suggestion.description && <p>{suggestion.description}</p>}<div className="qd-next-actions-buttons"><button type="button" className="qd-btn" disabled={!!busyId} onClick={() => void resolve(suggestion.id, 'accepted')}>{busyId === suggestion.id ? '处理中…' : '确认创建'}</button><button type="button" className="qd-btn ghost" disabled={!!busyId} onClick={() => void resolve(suggestion.id, 'rejected')}>忽略建议</button></div></li>)}</ul><p className="qd-next-actions-status">确认后进入待办，由你选择执行方式。</p></>}
    </section>}
    {summary?.status === 'running' && <p className="qd-intelligence-state" role="status">正在整理下一步行动…</p>}
    {summary?.status === 'failed' && <details className="qd-intelligence-state qd-suggestion-unavailable"><summary>行动建议暂不可用</summary><span>已有任务可正常使用。{summary.error && `本次未更新：${redactRuntimeText(summary.error)}`}</span><button type="button" className="qd-intake-link" disabled={!!busyId} onClick={() => void retry()}>{busyId === 'refresh' ? '重试中…' : '重试更新'}</button></details>}
    {error && <p className="qd-next-actions-error" role="alert">{redactRuntimeText(error)}</p>}
    {notice && <p className="qd-next-actions-status" role="status">{notice} <button type="button" className="qd-intake-link" onClick={() => setNotice('')}>收起</button></p>}
  </div>;
}
