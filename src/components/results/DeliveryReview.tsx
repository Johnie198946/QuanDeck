import { useRef, useState } from 'react';
import { deliveryReview, deliveryReviewCommand } from '../../data/deliveryReview';
import { useWorkdeck } from '../../state/WorkdeckContext';

export function DeliveryReview({ artifactId }: { artifactId?: string }) {
  const { snap } = useWorkdeck();
  const view = deliveryReview(snap, artifactId);
  if (!view || view.accepted) return null;
  return <ReviewForm key={`${snap.project.id}:${artifactId}:${view.submission?.id}:${view.task.specRevision}`} artifactId={artifactId!} />;
}
function ReviewForm({ artifactId }: { artifactId: string }) {
  const { snap, api, toast } = useWorkdeck(), view = deliveryReview(snap, artifactId);
  const [checks, setChecks] = useState<boolean[]>(() => view?.spec?.criteria.map(() => false) ?? []);
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const pending = useRef(false);
  if (!view) return null;
  const perform = async (verdict: 'accepted' | 'needs_changes') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const result = await api.collaborate(deliveryReviewCommand(snap, artifactId, verdict, checks, note));
      const detail = result.message || (result.ok ? verdict === 'accepted' ? '成果已认可，台帐与成果地图已更新。' : '已要求修改，原交付和核对记录已保留。' : '验收未保存，请重新核对');
      setMessage(detail); toast(detail, result.ok ? 'info' : 'error');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <details className="qd-delivery-review">
    <summary>核对这份成果</summary>
    <div className="qd-delivery-review-form">
      <p>核对「{view.task.title}」的当前完整候选 · 要求 v{view.task.specRevision}。同一份成果对应的章节会一起更新。</p>
      {view.reason && <p role="status">{view.reason}</p>}
      <fieldset disabled={busy || !view.reviewable}><legend>逐项核对验收条件</legend>
        {(view.spec?.criteria ?? []).map((criterion, index) => <label key={`${index}:${criterion}`}><input type="checkbox" checked={checks[index] ?? false} onChange={event => setChecks(values => values.map((value, i) => i === index ? event.target.checked : value))} /><span>{criterion}</span></label>)}
        <label className="qd-delivery-review-note"><span>验收说明</span><textarea maxLength={5000} value={note} onChange={event => setNote(event.target.value)} placeholder="记录核对依据，或具体需要修改的地方" rows={3} /></label>
        <div className="qd-delivery-review-actions"><button type="button" className="qd-btn primary" disabled={!view.fresh || !checks.every(Boolean) || !note.trim()} onClick={() => void perform('accepted')}>确认认可</button><button type="button" className="qd-btn" disabled={!note.trim()} onClick={() => void perform('needs_changes')}>要求修改</button>{busy && <span role="status">正在保存核对结果…</span>}</div>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
