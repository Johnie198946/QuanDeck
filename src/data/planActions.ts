import type { IdeaPlan, Snapshot } from './types';
import type { DesktopHost } from '../integration/desktop';

type Receipt = { ok: boolean; message?: string; sessionId?: string };
export interface PlanDecompositionSource {
  startDiscussion(planId: string, agentId?: string, scope?: string, projectId?: string): Promise<Receipt>;
  listProjects(): Promise<Snapshot[]>;
}

/** Adoption binds the direction revision, not the latest chat message ID. */
export function directionApproved(plan: IdeaPlan) {
  return !!plan.adopted && plan.adopted.draftVersion === plan.draftVersion;
}

/** Existing run transitions go through the desktop host so it can await stop/archive receipts. */
export async function decomposePlan(source: PlanDecompositionSource, host: DesktopHost | undefined, snapshot: Snapshot, plan: IdeaPlan): Promise<Receipt> {
  if (!directionApproved(plan)) return { ok: false, message: '先确认方向，再拆分执行任务' };
  const projectId = snapshot.project.id;
  const linked = Object.values(snapshot.sessions).filter(s => s.runtime?.planId === plan.id && s.runtime.projectId === projectId && s.runtime.purpose === 'discussion');
  const session = linked.find(s => s.id === plan.discussion?.sessionId) ?? linked.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))[0];
  if (session?.runtime?.runId && host) {
    const result = await host.controlRun(session.runtime.runId, 'decompose_plan');
    return { ...result, ok: result?.ok !== false };
  }
  if (session?.runtime?.runId && !host && !['archived', 'cancelled', 'failed'].includes(session.status)) return { ok: false, message: '请从桌面会话继续拆分，等待当前讨论归档后再启动' };
  const started = await source.startDiscussion(plan.id, plan.discussion?.agentId ?? snapshot.defaultAgent, 'root', projectId);
  if (!started.ok || !started.sessionId) return started;
  const project = (await source.listProjects()).find(p => p.project.id === projectId);
  const runId = project?.sessions[started.sessionId]?.runtime?.runId;
  if (runId && host) await host.openRun(runId);
  return started;
}
