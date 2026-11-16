import { goalDeliveryReadiness } from './goalDelivery';
import type { Session, Snapshot } from './types';
import { pendingSessionStatus } from './derive';

export interface SessionDelivery {
  projectId: string;
  taskId: string;
  workItemId?: string;
  submissionId: string;
  title: string;
  accepted: boolean;
}

/** A closed or paused source is not active just because a historical receipt failed. */
export function sessionSubmissionIssue(session?: Session): string | undefined {
  const runtime = session?.runtime;
  if (!runtime) return;
  if (runtime.submissionIssue?.message) return `成果未入库：${runtime.submissionIssue.message}`;
  for (const receipt of [...(runtime.submissionReceipts ?? [])].reverse()) {
    const kind = (receipt as typeof receipt & { kind?: string }).kind;
    if (receipt.ok && (kind === 'result' || !kind)) return;
    if (!receipt.ok) return `成果未入库：${receipt.message || receipt.code || '请打开原会话查看并修正交付格式'}`;
  }
}

export function isIdleDeliveryStatus(status?: string) {
  return ['waiting_reply', 'paused', 'archived', 'done', 'cancelled'].includes(status ?? '');
}

/** Display-only: preserve the source lifecycle and never conceal a current request or error. */
export function idleSessionDelivery(snapshot: Snapshot, session?: Session): SessionDelivery | undefined {
  if (!session || !isIdleDeliveryStatus(session.status) || pendingSessionStatus(session) ||
      sessionSubmissionIssue(session) || session.runtime?.incident?.status === 'open') return;
  return completedSessionDelivery(snapshot, session);
}

/** A source can remain open after delivery. Its latest complete candidate is a ledger fact,
 * not a new request for user input, and must never change the source lifecycle. */
export function completedSessionDelivery(snapshot: Snapshot, session?: Session): SessionDelivery | undefined {
  const binding = session?.runtime?.collaboration, c = snapshot.collaboration;
  if (!binding || !c || binding.projectId !== snapshot.project.id) return;
  const key = binding.workItemId ? `${binding.taskId}::${binding.workItemId}` : binding.taskId;
  const task = c.tasks[key];
  if (!task || task.archived || task.requiresRevalidation || !['in_review', 'done'].includes(task.status) || task.specRevision !== binding.specRevision) return;
  const readiness = goalDeliveryReadiness(snapshot, key), { submission, artifact } = readiness;
  if (!submission || !artifact || submission.runId !== binding.runId || artifact.runId !== binding.runId || !readiness.complete || readiness.applicable && !readiness.current) return;
  return { projectId: snapshot.project.id, taskId: task.taskId, workItemId: task.workItemId, submissionId: submission.id, title: artifact.title, accepted: task.status === 'done' && task.acceptedArtifactId === artifact.id };
}
