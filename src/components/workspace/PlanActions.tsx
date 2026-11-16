import { useState } from 'react';
import type { CommandResult, IdeaPlan } from '../../data/types';
import type { RuntimeCommands } from '../../data/runtimeContracts';
import { useWorkdeck } from '../../state/WorkdeckContext';
import { desktopHost } from '../../integration/desktop';
import { Icon } from '../ui/Icon';

/** Approval is one project command, separate from sending another chat message. */
export function PlanActions({ plan }: { plan: IdeaPlan }) {
  const { snap, api, toast, patchWorkspace } = useWorkdeck();
  const [busy, setBusy] = useState(false);
  const latest = [...(plan.discussion?.conclusions ?? [])].reverse().find(c => c.scopeId === 'root');
  const approved = plan.adopted?.draftVersion === plan.draftVersion && (!latest || plan.adopted?.conclusionIds?.includes(latest.id));
  const count = Object.values(snap.orchestrations?.[plan.taskId]?.items ?? {}).filter(i => i.status !== 'cancelled').length;
  const approve = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const command = api as typeof api & { approvePlan: (planId: string, conclusionId?: string, projectId?: string) => Promise<CommandResult & { added?: number }> };
      const result = await command.approvePlan(plan.id, latest?.id, snap.project.id);
      if (!result.ok) throw new Error(result.message);
      toast(result.message || '方向已确认');
      if (result.added || count) patchWorkspace({ view: 'tasks', mode: 'doc', pane: 'main' });
    } catch (error) { toast(error instanceof Error ? error.message : '暂未能确认方案', 'error'); }
    finally { setBusy(false); }
  };
  const decompose = async () => {
    if (busy) return;
    const runtime = api as typeof api & RuntimeCommands;
    setBusy(true);
    try {
      const started = await runtime.startDiscussion(plan.id, plan.discussion?.agentId ?? snap.defaultAgent, 'root');
      if (!started.ok) throw new Error(started.message);
      const next = await api.load();
      const run = started.sessionId && next.sessions[started.sessionId]?.runtime?.runId;
      if (run) await desktopHost()?.openRun(run);
      toast('方向已确认，正在拆分执行任务');
    } catch (error) { toast(error instanceof Error ? error.message : '暂未能拆分任务', 'error'); }
    finally { setBusy(false); }
  };
  return <div className="qd-plan-actions">
    {approved ? <><span className="qd-plan-approved"><Icon name="check-circle" size={14} />方向已确认</span><button className="qd-btn primary small" disabled={busy} onClick={() => count ? patchWorkspace({ view: 'tasks', mode: 'doc', pane: 'main' }) : void decompose()}>{busy ? '正在拆分…' : count ? `查看 ${count} 项任务` : '拆分执行任务'}<Icon name="arrow-right" size={14} /></button></> : <button className="qd-btn primary small" disabled={busy || !plan.draft.sections.some(s => s.lines.length)} onClick={() => void approve()}>{busy ? '正在生成…' : '方案满意，生成任务'}<Icon name="arrow-right" size={14} /></button>}
  </div>;
}
