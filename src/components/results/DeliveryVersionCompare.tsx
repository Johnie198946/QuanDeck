import { isCollaborationArtifactFresh, taskKey } from '../../data/collaboration';
import { resultExcerpt } from '../../data/resultExcerpt';
import type { Snapshot } from '../../data/types';

/** Show only stored submissions for this exact task and requirement version. */
export function DeliveryVersionCompare({ snapshot, taskId, itemId, openSource }: { snapshot: Snapshot; taskId?: string; itemId?: string; openSource: (id:string) => void }) {
  const collaboration = snapshot.collaboration;
  if (!taskId || !collaboration) return null;
  const key = taskKey(taskId,itemId), task = collaboration.tasks[key];
  if (!task) return null;
  const artifacts = new Map(collaboration.artifacts.filter(artifact => artifact.key === key).map(artifact => [artifact.id,artifact]));
  const seen = new Set<string>();
  const entries = collaboration.submissions.filter(submission => submission.key === key && submission.specRevision === task.specRevision && artifacts.has(submission.artifactId)).reverse().flatMap(submission => {
    const artifact = artifacts.get(submission.artifactId)!;
    if (seen.has(artifact.hash)) return [];
    seen.add(artifact.hash);
    const run = submission.runId ? collaboration.runs[submission.runId] : undefined;
    const session = run?.sessionId ? snapshot.sessions[run.sessionId] : undefined;
    const author = snapshot.agents.find(agent => agent.id === session?.agentId)?.name ?? (run?.executor || submission.actor);
    const review = collaboration.reviews.find(entry => entry.submissionId === submission.id);
    const fresh = isCollaborationArtifactFresh(snapshot,artifact.id);
    const active = task.latestSubmissionId === submission.id && task.status === 'in_review' && fresh;
    const accepted = task.acceptedArtifactId === artifact.id && task.status === 'done' && review?.verdict === 'accepted' && fresh;
    return [{artifact,session,submission,author,status: review?.verdict === 'needs_changes' ? '已退回' : accepted ? '已验收' : active ? '当前待验收' : '历史版本'}];
  }).slice(0,4);
  if (entries.length < 2) return null;
  return <details className="qd-delivery-version-compare"><summary>对照同一任务的成果版本（{entries.length}）</summary>
    <div className="qd-delivery-version-grid">{entries.map(({artifact,session,submission,author,status}) => <article key={artifact.id}>
      <p><strong>{artifact.title}</strong></p><small>{author} · v{artifact.version} · {status}</small>
      <p>{resultExcerpt(artifact.body,200)}</p>
      {submission.unresolved.length > 0 && <p>待解决：{submission.unresolved.slice(0,2).join('、')}</p>}
      {session && <button type="button" className="qd-link" onClick={() => openSource(session.id)}>查看执行记录</button>}
    </article>)}</div>
  </details>;
}
