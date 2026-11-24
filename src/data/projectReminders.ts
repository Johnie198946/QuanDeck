import type { RuntimeRunView } from '../integration/desktop';
import { pendingSessionStatus } from './derive';
import { currentRuntimeIncidents } from './runtimePresentation';
import { completedSessionDelivery, isIdleDeliveryStatus, sessionSubmissionIssue } from './sessionDelivery';
import { settledDiscussion } from './settledDiscussion';
import { supersededStoppedSession } from './sessionHistory';
import type { Session, Snapshot } from './types';

export interface ProjectReminder {
  id: string;
  run: RuntimeRunView;
  session: Session;
  project: Snapshot;
  kind: 'direction' | 'submission' | 'connection' | 'question' | 'permission';
  reason: string;
  targetSessionId?: string;
}

export function discussionPlan(snapshot: Snapshot, session?: Session) {
  const rt = session?.runtime;
  if (rt?.purpose !== 'discussion' || rt.projectId !== snapshot.project.id || !rt.planId) return;
  const plan = snapshot.ideaPlans?.[rt.planId];
  if (plan && (plan.scope === 'project' || snapshot.tasks[plan.taskId])) return plan;
}

/** The project owns the task and outstanding business action. Transport diagnostics only
 * contribute if their project and session match. Nothing is written back to history. */
export function projectTaskReminders(snapshot: Snapshot, runs: RuntimeRunView[]): ProjectReminder[] {
  const records = new Map(runs.filter(run => run.projectId === snapshot.project.id).map(run => [run.runId, run]));
  const sessions = Object.values(snapshot.sessions);
  const reports = new Map<string, RuntimeRunView>();
  const bound = sessions.flatMap(session => {
    const rt = session.runtime;
    if (!rt?.runId || rt.projectId !== snapshot.project.id) return [];
    const live = records.get(rt.runId);
    if (live && (live.taskId !== rt.taskId || live.dispatchId !== rt.dispatchId)) return [];
    const run: RuntimeRunView = live ?? {
      runId: rt.runId, projectId: rt.projectId, taskId: rt.taskId, workItemId: rt.workItemId, dispatchId: rt.dispatchId,
      connectionId: rt.connection.connectionId, purpose: rt.purpose, sessionId: session.source?.sessionId,
      acceptance: session.dispatchPhase === 'acknowledged' ? 'acknowledged' : session.dispatchPhase === 'rejected' ? 'rejected' : 'unknown',
      stoppedConfirmed: rt.stoppedConfirmed, health: { incident: rt.incident }, events: [], status: session.status,
    };
    reports.set(run.runId,run);
    return [{session,run}];
  });
  const open = new Map(currentRuntimeIncidents([...reports.values()], [snapshot])
    .filter(run => run.health?.incident?.status === 'open').map(run => [run.runId,run.health!.incident!]));
  const reminders: ProjectReminder[] = [];
  for (const {session,run} of bound) {
    if (session.linkedAsHistory || ['archived','cancelled'].includes(session.status) || supersededStoppedSession(snapshot, session)) continue;
    const rt = session.runtime!;
    const request = pendingSessionStatus(session);
    const issue = rt.submissionIssue;
    const incident = open.get(run.runId);
    const action = (kind: ProjectReminder['kind'], id: string, reason: string, targetSessionId?: string) =>
      reminders.push({id,run,session,project:snapshot,kind,reason,targetSessionId});
    if (request) {
      const requests = Object.values(rt.requests ?? (rt.request ? {[rt.request.id]:rt.request} : {}));
      const source = requests.find(r => r.kind === 'permission') ?? requests[0];
      action(request === 'waiting_permission' ? 'permission' : 'question', source.id, source.prompt,source.targetSessionId);
      continue;
    }
    if (settledDiscussion(snapshot,session)) continue;
    const submissionProblem = sessionSubmissionIssue(session);
    if (!submissionProblem && !incident) continue;
    const plan = discussionPlan(snapshot,session);
    const taskId = plan?.taskId || rt.taskId;
    const key = rt.workItemId ? taskId+'::'+rt.workItemId : taskId;
    const ledgerTask = snapshot.collaboration?.tasks[key];
    if (ledgerTask?.archived || ['done','cancelled'].includes(ledgerTask?.status ?? '') ||
      !rt.workItemId && snapshot.tasks[taskId]?.completion ||
      isIdleDeliveryStatus(session.status) && completedSessionDelivery(snapshot,session)) continue;
    if (issue?.code === 'DISCUSSION_CONTEXT_STALE' && plan)
      action('direction',issue.messageId,'这条意见未写入当前草稿。请核对最新方案是否已包含它。');
    else if (submissionProblem)
      action('submission',issue?.messageId ?? run.runId,submissionProblem);
    else if (incident) action('connection',incident.id,incident.message);
  }
  return reminders.sort((a,b) => b.session.lastActivity.localeCompare(a.session.lastActivity));
}
