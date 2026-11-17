import { useState } from 'react';
import { taskSessions, sessionView } from '../../data/derive';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { DispatchButton } from '../journal/DispatchButton';
import { TaskInput } from '../journal/TaskInput';
import { RunProgress } from '../journal/RunProgress';
import { TaskOutputButton } from '../outputs/OutputDialog';
import { AgentLogo } from '../ui/AgentLogo';
import { desktopHost } from '../../integration/desktop';
import { TaskHandoffPanel } from '../work/TaskHandoffPanel';

/** A concrete task always has a useful detail page, even before a plan or run exists. */
export function TaskDirectView({ taskId }: { taskId: string }) {
  const { snap, api, toast, agentOf, openSourceSession } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const task = snap.tasks[taskId];
  const sessions = taskSessions(snap, task).filter(s => s.runtime?.purpose !== 'discussion');
  const latest = [...sessions].sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))[0];
  const active = sessions.some(s => ['running','submitting','acknowledged','waiting_reply','waiting_permission'].includes(sessionView(s)));
  const dispatch = async (agentId: string) => {
    if (busy) return;
    setBusy(true);
    try { const result = await api.dispatch(taskId, agentId); toast(result.message || (result.ok ? '已派发任务' : '暂未派发'), result.ok ? 'info' : 'error'); }
    catch (error) { toast(error instanceof Error ? error.message : '暂未派发', 'error'); }
    finally { setBusy(false); }
  };
  return <section className="qd-direct-task" aria-label="任务详情">
    <header><div><h2>执行任务</h2><p>补充要求后直接派发，成果会归入这个项目。</p></div>{!active && !busy && <DispatchButton label={task.title} onDispatch={dispatch} />}</header>
    {latest && <div className="qd-direct-session"><div><AgentLogo agent={agentOf(latest.agentId)} size={24} /><strong>{agentOf(latest.agentId).name}</strong><button className="qd-link" onClick={() => latest.runtime?.runId && desktopHost() ? void desktopHost()!.openRun(latest.runtime.runId) : openSourceSession(latest.id)}>查看执行详情 ↗</button></div><RunProgress session={latest} /></div>}
    <TaskInput taskId={taskId} />
    <TaskHandoffPanel taskId={taskId} />
    <div className="qd-direct-output"><TaskOutputButton taskId={taskId} /></div>
  </section>;
}
