import { useState } from 'react';
import type { CommandResult, IdeaPlan } from '../../data/types';
import { directionApproved } from '../../data/planActions';
import { rootPlanOf } from '../../data/ideaEngine';
import { deriveGoalAutomation, latestGoalPlan } from '../../data/goalDelivery';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { requestProductDispatch } from '../deck/ProductExecution';
import { Icon } from '../ui/Icon';

type GoalCommands = {
  approvePlan(planId: string, conclusionId?: string, projectId?: string, expectedDraftVersion?: number): Promise<CommandResult & { added?: number; approvedDraftVersion?: number }>;
};
/** Confirm the plan before opening a separate assignment decision. */
export function PlanActions({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace, closeWorkspace, openWorkspace, openSourceSession } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const latest = [...(plan.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === 'root');
  const approved = directionApproved(plan), automation = deriveGoalAutomation(snap, plan.id);
  const authorization = snap.collaboration?.goalAutomation?.[plan.id];
  const bindings = latestGoalPlan(snap, plan.id)?.tasks ?? [];
  const showStart = !automation.enabled || automation.status === 'outdated' || !approved;
  const statusLabel = { off: '尚未开启', ready: '等待自动推进', running: '按依赖执行中', paused: '自动推进需要处理', blocked: '等待前置条件', assembled: '交付已汇齐', outdated: '执行版本待更新' }[automation.status];
  const count = latestGoalPlan(snap, plan.id)?.tasks.length ?? Object.values(snap.orchestrations?.[plan.taskId]?.items ?? {}).filter(i => i.status !== 'cancelled').length;
  const inspectAttention = () => {
    const c = snap.collaboration;
    const decomposition = authorization?.decomposition;
    if (decomposition?.sessionId && snap.sessions[decomposition.sessionId] && (!bindings.length || decomposition.closeState === 'unknown')) {
      openSourceSession(decomposition.sessionId); return;
    }
    const candidates = bindings.map(binding => {
      const task = c?.tasks[binding.key];
      const sessionId = (task?.activeRunId ? c?.runs[task.activeRunId]?.sessionId : undefined) ?? authorization?.attempts[binding.key]?.sessionId;
      return { task, sessionId, session: sessionId ? snap.sessions[sessionId] : undefined };
    });
    const waiting = candidates.find(item => item.session && ['failed', 'paused', 'waiting_reply', 'waiting_permission'].includes(item.session.status)
      || item.task && ['failed', 'paused', 'waiting_input', 'waiting_permission'].includes(item.task.status))
      ?? candidates.find(item => item.task?.status === 'blocked');
    if (waiting?.sessionId && waiting.session) { openSourceSession(waiting.sessionId); return; }
    if (waiting?.task) { openWorkspace(waiting.task.taskId, { view: 'tasks', selected: waiting.task.workItemId ?? null, pane: waiting.task.workItemId ? 'side' : 'main', focus: true }); return; }
    if (plan.scope === 'project') closeWorkspace();
    else patchWorkspace({ view: 'tasks', mode: 'doc', pane: 'main', itemId: null });
  };
  const approve = async () => {
    if (busy || approved) return;
    setBusy(true);
    try {
      const command = api as typeof api & GoalCommands;
      const result = await command.approvePlan(plan.id, latest?.adopted ? undefined : latest?.id, snap.project.id, plan.draftVersion);
      if (!result.ok) throw new Error(result.message || '暂时无法确认方案。');
      toast('方案已确认。接下来可以分派任务。');
    } catch (error) { toast(error instanceof Error ? error.message : '请稍后重试', 'error'); }
    finally { setBusy(false); }
  };
  return <div className="qd-plan-actions qd-direction-actions">
    {automation.enabled && <span className="qd-plan-approved" title={automation.blockedReason || automation.nextAction}><Icon name={automation.status === 'paused' || automation.status === 'blocked' || automation.status === 'outdated' ? 'alert' : 'check-circle'} size={14} />v{plan.draftVersion} · {statusLabel}</span>}
    {!approved && <button type="button" className="qd-btn primary small" disabled={busy || !plan.draft.sections.some(section => section.lines.length)} onClick={() => void approve()}>{busy ? '正在确认…' : '确认方案'}<Icon name="arrow-right" size={14}/></button>}
    {approved && showStart && plan.scope !== 'project' && !count && <button type="button" className="qd-btn primary small" onClick={() => requestProductDispatch({projectId:snap.project.id,taskId:plan.taskId,itemId:plan.itemId})}>选择执行者<Icon name="arrow-right" size={14}/></button>}
    {!showStart && (automation.status === 'paused' || automation.status === 'blocked') && <button type="button" className="qd-btn ghost small" onClick={inspectAttention}>{automation.status === 'paused' ? '处理并恢复' : '查看等待条件'}<Icon name="arrow-right" size={14} /></button>}
    {count > 0 && <button type="button" className="qd-link" onClick={() => plan.scope === 'project' ? closeWorkspace() : patchWorkspace({ view: 'tasks', mode: 'doc', pane: 'main', itemId: null, planId: rootPlanOf(snap, plan.taskId)?.id })}>查看 {count} 项任务</button>}
  </div>;
}
