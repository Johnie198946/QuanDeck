import { useState } from 'react';
import type { IdeaPlan, CommandResult } from '../../data/types';
import { deriveGoalAutomation, type GoalAutomationInput } from '../../data/goalDelivery';
import { useWorkdeck } from '../../state/WorkdeckContext';

type AutomationSource = { configureGoalAutomation(planId: string, input: GoalAutomationInput, projectId?: string): Promise<CommandResult> };
const STATUS = { off: '尚未开启', ready: '等待推进', running: '按依赖执行中', paused: '需要处理', blocked: '等待前置交付', assembled: '交付已汇齐', outdated: '版本已更新' };

export function GoalAutomationControl({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const state = deriveGoalAutomation(snap, plan.id);
  const pause = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await (api as typeof api & AutomationSource).configureGoalAutomation(plan.id, { enabled: false, expectedDraftVersion: plan.draftVersion }, snap.project.id);
      if (!result.ok) throw new Error(result.message || '执行设置未保存');
      toast(result.message || '已暂停自动推进');
    } catch (error) { toast(error instanceof Error ? error.message : '暂未能更新执行设置', 'error'); }
    finally { setBusy(false); }
  };
  return <section className={`qd-goal-automation state-${state.status}`} aria-label="自动执行设置">
    <div><strong>自动执行</strong><span>{STATUS[state.status]}</span>{state.total > 0 && <small>已交付 {state.completed}/{state.total}</small>}</div>
    <p>{state.blockedReason || (state.enabled ? state.nextAction : '开启后按方向拆分任务、按依赖执行、汇总交付。图片与选项的局部意见不会启动执行。')}</p>
    {state.enabled && <button type="button" className="qd-btn ghost small" disabled={busy} onClick={() => void pause()}>{busy ? '正在保存…' : '暂停自动推进'}</button>}
  </section>;
}
