import { useEffect, useState } from 'react';
import type { RuntimeRunView } from '../../integration/desktop';
import { runtimeProgress, durationLabel } from '../../data/runtimePresentation';
import { executionStage } from '../../data/executionProgress';
import { ProgressIndicator } from '../journal/RunProgress';

/** Source activity and elapsed wall time; an unknown total remains indeterminate. */
export function RuntimeProgress({ run, agentName }: { run: RuntimeRunView; agentName: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const activity = runtimeProgress(run, now);
  if (!activity.progress) return null;
  return <section className="qd-runtime-progress" aria-label="本轮进度">
    <ProgressIndicator progress={activity.progress} agentName={agentName} color="#547969" />
    <div className="qd-runtime-progress-meta">
      {activity.elapsed !== null && <span>本轮耗时 {durationLabel(activity.elapsed)}</span>}
      {activity.active && activity.silent !== null && <span>最近活动 {activity.silent < 5 ? '刚刚' : `${durationLabel(activity.silent)}前`}</span>}
    </div>
    {activity.active && activity.silent !== null && activity.silent >= 60 && <p role="status">源 Agent 暂未返回新进展。你可以查看源会话，或暂停后继续。</p>}
    {!!activity.recent.length && <details><summary>查看最近执行步骤</summary><ol>{activity.recent.map(step => <li key={step.id}><time>{new Date(step.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{executionStage(step.label)}</span></li>)}</ol></details>}
  </section>;
}
