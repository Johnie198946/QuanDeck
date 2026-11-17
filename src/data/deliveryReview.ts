import { isCollaborationArtifactFresh, type CollaborationCommand } from './collaboration';
import type { Snapshot } from './types';

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
  const reason = task.archived ? '任务已归档，不能验收。' : !current ? '这不是当前要求下的最新候选，请选择新的成果。' :
    accepted ? '这份成果已认可。' : task.status !== 'in_review' ? task.blockReason || '这份交付尚未进入待验收状态。' :
    !fresh ? '成果或引用来源已失效，请要求更新后再认可。' : '';
  return { artifact, task, submission, spec, accepted, current, fresh, reason,
    reviewable: !!spec && current && !task.archived && task.status === 'in_review' };
}

export function deliveryReviewCommand(snapshot: Snapshot, artifactId: string, verdict: 'accepted' | 'needs_changes', checks: boolean[], note: string): CollaborationCommand {
  const view = deliveryReview(snapshot, artifactId);
  if (!view?.reviewable || !view.submission || !view.spec) throw Error(view?.reason || '候选或验收条件已变化，请重新核对');
  if (checks.length !== view.spec.criteria.length || checks.some(value => typeof value !== 'boolean')) throw Error('请逐条核对验收条件');
  if (!note.trim()) throw Error('请填写验收说明');
  if (verdict === 'accepted' && (!view.fresh || !checks.every(Boolean))) throw Error(view.fresh ? '请逐条确认所有验收条件' : view.reason);
  return { projectId: snapshot.project.id, taskId: view.task.taskId, workItemId: view.task.workItemId,
    type: 'review', expectedVersion: view.task.version, idempotencyKey: crypto.randomUUID(),
    payload: { submissionId: view.submission.id, verdict, checks, note: note.trim() } };
}
