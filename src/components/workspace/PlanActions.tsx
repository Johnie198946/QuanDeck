import { useState } from 'react';
import type { CommandResult, IdeaPlan } from '../../data/types';
import { directionApproved } from '../../data/planActions';
import { rootPlanOf } from '../../data/ideaEngine';
import { deriveGoalAutomation, latestGoalPlan, type GoalAutomationInput } from '../../data/goalDelivery';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { useConfiguredAgents } from '../../integration/configuredAgents';
import { Icon } from '../ui/Icon';

type GoalCommands = {
  approvePlan(planId: string, conclusionId?: string, projectId?: string, expectedDraftVersion?: number): Promise<CommandResult & { added?: number; approvedDraftVersion?: number }>;
  configureGoalAutomation(planId: string, input: GoalAutomationInput, projectId?: string): Promise<CommandResult>;
};
/** One explicit click confirms the exact revision then authorizes its execution. */
export function PlanActions({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace, closeWorkspace } = useWorkdeck();
  const { agents } = useConfiguredAgents(snap.agents);
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState('');
  const latest = [...(plan.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === 'root');
  const approved = directionApproved(plan), automation = deriveGoalAutomation(snap, plan.id);
  const agentId = selected || plan.discussion?.agentId || snap.defaultAgent;
  const agent = agents.find(item => item.id === agentId);
  const count = latestGoalPlan(snap, plan.id)?.tasks.length ?? Object.values(snap.orchestrations?.[plan.taskId]?.items ?? {}).filter(i => i.status !== 'cancelled').length;
  const apply = async (execute: boolean) => {
    if (busy) return;
    setBusy(true);
    let confirmed = approved;
    let approvedVersion = plan.draftVersion;
    try {
      const command = api as typeof api & GoalCommands;
      if (!approved) {
        const result = await command.approvePlan(plan.id, latest?.adopted ? undefined : latest?.id, snap.project.id, plan.draftVersion);
        if (!result.ok) throw new Error(result.message);
        confirmed = true;
        if (execute && result.approvedDraftVersion == null) throw new Error('确认回执缺少版本，请刷新后开始执行。');
        approvedVersion = result.approvedDraftVersion ?? plan.draftVersion;
      }
      if (execute) {
        const result = await command.configureGoalAutomation(plan.id, { enabled: true, agentId: agent?.id, expectedDraftVersion: approvedVersion }, snap.project.id);
        if (!result.ok) throw new Error(result.message || '自动执行尚未开启');
        toast(result.message || '方向已确认，已开启自动执行');
      } else toast(`方向 v${approvedVersion} 已确认，尚未开启执行。`);
    } catch (error) { toast(`${execute && confirmed ? '方向已确认，执行尚未开启。' : ''}${error instanceof Error ? error.message : '请稍后重试'}`, 'error'); }
    finally { setBusy(false); }
  };
  return <div className="qd-plan-actions qd-direction-actions">
    {automation.enabled && approved ? <span className="qd-plan-approved"><Icon name="check-circle" size={14} />v{plan.draftVersion} · 自动推进已开启</span> : <>
      <label>执行 Agent<select aria-label="方向执行 Agent" value={agent?.id ?? ''} disabled={busy || !agents.length} onChange={event => setSelected(event.target.value)}><option value="" disabled>{agents.length ? '请选择 Agent' : '请先连接 Agent'}</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" className="qd-btn primary small" disabled={busy || !agent || !plan.draft.sections.some(section => section.lines.length)} onClick={() => void apply(true)}>{busy ? '正在保存并启动…' : approved ? '开始自动执行' : '确认方向并自动执行'}<Icon name="arrow-right" size={14} /></button>
      {!approved && <button type="button" className="qd-link" disabled={busy || !plan.draft.sections.some(section => section.lines.length)} onClick={() => void apply(false)}>只确认方向</button>}
    </>}
    {count > 0 && <button type="button" className="qd-link" onClick={() => plan.scope === 'project' ? closeWorkspace() : patchWorkspace({ view: 'tasks', mode: 'doc', pane: 'main', itemId: null, planId: rootPlanOf(snap, plan.taskId)?.id })}>查看 {count} 项任务</button>}
  </div>;
}
