import { goalDeliveryReadiness } from './goalDelivery';
import { unfinishedReviewChildren } from './reviewScope';
import { isCollaborationArtifactFresh, type CollaborationCommand, type CollaborationReview, type CollaborationSubmission, type CollaborationTask } from './collaboration';
import type { OutputAttachment, Snapshot } from './types';

/** A returned candidate remains actionable until a new submission or spec replaces it. */
export function currentChangeRequest(task?: CollaborationTask, submission?: CollaborationSubmission, review?: CollaborationReview) {
  if (!task || task.archived || ['done', 'cancelled', 'in_review'].includes(task.status)) return;
  if (!submission || submission.id !== task.latestSubmissionId || submission.key !== task.key || submission.specRevision !== task.specRevision) return;
  if (review?.verdict === 'needs_changes' && review.key === task.key && review.submissionId === submission.id) return review;
}

export function currentChangeRequestFor(snapshot: Snapshot, key: string) {
  const ledger = snapshot.collaboration;
  const task = ledger?.tasks[key];
  if (!ledger || !task?.latestSubmissionId) return;
  const submission = ledger.submissions.find(entry => entry.id === task.latestSubmissionId);
  const review = ledger.reviews.find(entry => entry.submissionId === task.latestSubmissionId);
  return currentChangeRequest(task, submission, review);
}

/** Exact artifact identity, current submission and spec; no new review state. */
export function deliveryReview(snapshot: Snapshot, artifactId?: string) {
  const c = snapshot.collaboration, artifact = c?.artifacts.find(item => item.id === artifactId);
  const task = artifact && c?.tasks[artifact.key];
  if (!c || !artifact || !task) return null;
  const submission = c.submissions.find(item => item.id === task.latestSubmissionId && item.key === artifact.key);
  const spec = c.specs.find(item => item.key === artifact.key && item.revision === task.specRevision);
  const current = submission?.artifactId === artifact.id && submission.specRevision === task.specRevision;
  const accepted = task.acceptedArtifactId === artifact.id && task.status === 'done';
  const fresh = isCollaborationArtifactFresh(snapshot, artifact.id);
  const readiness = goalDeliveryReadiness(snapshot, task.key);
  const unfinishedChildren = unfinishedReviewChildren(snapshot, task);
  const acceptanceReason = unfinishedChildren.length ? `还有 ${unfinishedChildren.length} 项子任务未结束，请先完成并核对各子任务；当前只能查看候选或要求修改。` :
    readiness.unresolved.length || readiness.partial ? readiness.reason || '仍有未解决事项，请补齐交付后再验收。' :
    readiness.applicable && !readiness.current ? '方向或交付要求已变化，请更新候选后再验收。' :
    task.requiresRevalidation || !fresh ? '成果或引用来源已失效，请要求更新后再认可。' :
    task.dependencies.some(key => { const dep = c.tasks[key]; return !dep || dep.status !== 'done' || dep.requiresRevalidation || dep.legacyCompletion || !dep.acceptedArtifactId || !isCollaborationArtifactFresh(snapshot, dep.acceptedArtifactId); }) ? '依赖任务尚未验收，请先核对前置成果。' : '';
  const reason = task.archived ? '任务已归档，不能验收。' : !current ? '这不是当前要求下的最新候选，请选择新的成果。' :
    accepted ? '这份成果已认可。' : task.status !== 'in_review' ? task.blockReason || '这份交付尚未进入待验收状态。' :
    acceptanceReason;
  return { artifact, task, submission, spec, accepted, current, fresh, reason, acceptanceReason, unfinishedChildren,
    canAccept: !!spec && current && !task.archived && task.status === 'in_review' && !acceptanceReason,
    reviewable: !!spec && current && !task.archived && task.status === 'in_review' };
}

export function deliveryReviewCommand(snapshot: Snapshot, artifactId: string, verdict: 'accepted' | 'needs_changes', checks: boolean[], note: string, attachments: OutputAttachment[] = []): CollaborationCommand {
  const view = deliveryReview(snapshot, artifactId);
  if (!view?.reviewable || !view.submission || !view.spec) throw Error(view?.reason || '候选或验收条件已变化，请重新核对');
  if (verdict === 'accepted' && !view.canAccept) throw Error(view.acceptanceReason || view.reason);
  if (checks.length !== view.spec.criteria.length || checks.some(value => typeof value !== 'boolean')) throw Error('请逐条核对验收条件');
  if (verdict === 'needs_changes' && !note.trim() && !attachments.length) throw Error('请写下修改意见或粘贴截图');
  if (verdict === 'accepted' && (!view.fresh || !checks.every(Boolean))) throw Error(view.fresh ? '请逐条确认所有验收条件' : view.reason);
  return { projectId: snapshot.project.id, taskId: view.task.taskId, workItemId: view.task.workItemId,
    type: 'review', expectedVersion: view.task.version, idempotencyKey: crypto.randomUUID(),
    payload: { submissionId: view.submission.id, verdict, checks, note: note.trim(), ...(attachments.length ? { attachments } : {}) } };
}
