import { useEffect, useMemo, useState } from 'react';
import { taskProgressTrail, type ProgressScope } from '../../data/taskProgressTrail';
import type { Snapshot } from '../../data/types';
import './task-progress-trail.css';

export function TaskProgressTrail({ snapshot, scope = {}, compact = false }: { snapshot: Snapshot; scope?: ProgressScope; compact?: boolean }) {
  const trail = useMemo(() => taskProgressTrail(snapshot, scope), [snapshot, scope.taskId, scope.workItemId]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!trail.latest) return; const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, [trail.latest]);
  const ago = trail.latest ? Math.max(0, Math.floor((now - Date.parse(trail.latest)) / 60000)) : null;
  const stamp = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: snapshot.project.timeZone || undefined, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const counts = [trail.running && `${trail.running} 项推进中`, trail.attention && `${trail.attention} 项需要处理`, trail.blocked && `${trail.blocked} 项等待条件`, trail.candidateSlots && `${trail.candidateSlots} 格待验收`, trail.standaloneCandidates && `${trail.standaloneCandidates} 份候选待验收`, trail.changesRequested && `${trail.changesRequested} 格待修改`, trail.stale && `${trail.stale} 格需更新`, trail.totalSlots && `${trail.missing} 格待补齐`].filter(Boolean).join(' · ');
  return <section className={`qd-progress-trail ${compact ? 'is-compact' : ''}`} aria-label="任务进展轨迹">
    <div className="qd-progress-trail-now"><span className={trail.attention || trail.changesRequested || trail.stale ? 'is-attention' : ''}>{trail.current.label}</span><strong>{trail.current.title}</strong></div>
    {trail.current.detail && <p className="qd-progress-trail-detail">{trail.current.detail}</p>}
    <div className="qd-progress-trail-meta"><span>{counts || (trail.executionCount ? `${trail.executionCount} 次执行记录` : trail.evidence.length ? '已有进展记录' : '尚无执行回执')}</span>{trail.latest && <time dateTime={trail.latest} title={stamp(trail.latest)}>最近回执 {ago === 0 ? '刚刚' : `${ago} 分钟前`}</time>}</div>
    {!!trail.running && ago !== null && ago >= 2 && <p className="qd-progress-trail-silent">暂未收到新的活动回执，实际执行情况以源会话为准。</p>}
    <details className="qd-progress-trail-expand" open={!compact || undefined}>
      <summary>查看阶段与进展记录</summary>
      <ol className="qd-progress-trail-stages" aria-label="按证据显示的阶段">
        {trail.milestones.map(stage => <li key={stage.id} className={`${stage.observed ? 'is-observed' : ''} ${stage.active ? 'is-active' : ''}`}>
          <span className="qd-progress-trail-mark" aria-hidden="true">{stage.observed ? '●' : '○'}</span><div><strong>{stage.label}</strong><small>{stage.value}</small></div>
        </li>)}
      </ol>
      {(trail.completed.length > 0 || trail.remaining.length > 0) && <div className="qd-progress-trail-checkpoint">
        <p>Agent 报告 · {trail.checkpointTitle}{trail.checkpointAt ? ` · ${stamp(trail.checkpointAt)}` : ''}</p>
        {!!trail.completed.length && <div><strong>已推进</strong><ul>{trail.completed.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
        {!!trail.remaining.length && <div><strong>接下来</strong><ul>{trail.remaining.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
      </div>}
      {trail.evidence.length ? <ol className="qd-progress-trail-events" aria-label="最近事实记录">{trail.evidence.map(event => <li key={event.id}>
        <time dateTime={event.at}>{stamp(event.at)}</time><div><strong>{event.label}</strong>{event.detail && <p>{event.detail}</p>}</div>
      </li>)}</ol> : <p className="qd-progress-trail-empty">还没有阶段回执。执行开始后，这里会记录推进与交付。</p>}
    </details>
  </section>;
}
