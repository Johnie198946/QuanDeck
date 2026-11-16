import type { CSSProperties } from 'react';
import { sessionProgress, type ExecutionProgress } from '../../data/executionProgress';
import type { Session } from '../../data/types';
import { useWorkdeck } from '../../state/WorkdeckContext';
import './run-progress.css';

/** Visible status and a real progress track. Unknown totals never become a percentage. */
export function ProgressIndicator({ progress, agentName, color, compact = false }: {
  progress: ExecutionProgress | null; agentName: string; color: string; compact?: boolean;
}) {
  if (!progress) return null;
  const { mode, state, value, total, label, stage, amount } = progress;
  const aria = mode === 'unknown' ? {} : { 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': value };
  const segments = mode === 'steps' ? Math.min(total!, 12) : 0;
  const filled = mode === 'steps' ? Math.floor(value! / total! * segments) : 0;
  const text = [label, amount, stage].filter(Boolean).join(' · ');
  return <div className={`qd-execution-progress is-${state} mode-${mode} ${compact ? 'is-compact' : ''}`} style={{ '--agent': color } as CSSProperties}>
    <div className="qd-execution-progress-heading"><span>{label}</span>{amount && <small>{amount}</small>}</div>
    <div className="qd-progress-track" role="progressbar" aria-label={`${agentName} 执行进度`} aria-valuetext={text} {...aria}>
      {mode === 'steps' && Array.from({ length: segments }, (_, i) => <span key={i} className={`qd-seg-cell ${i < filled ? 'is-done' : ''} ${i === filled && value! < total! ? 'is-current' : ''}`} />)}
      {mode === 'percent' && <span className="qd-progress-fill" style={{ width: `${value}%` }} />}
      {mode === 'unknown' && <span className="qd-progress-band" />}
    </div>
    {stage && stage !== label && <p className="qd-execution-stage">{stage}</p>}
  </div>;
}

export function RunProgress({ session, compact = false }: { session: Session; compact?: boolean }) {
  const { agentOf } = useWorkdeck();
  const agent = agentOf(session.agentId);
  return <ProgressIndicator progress={sessionProgress(session)} agentName={agent.name} color={agent.color} compact={compact} />;
}
