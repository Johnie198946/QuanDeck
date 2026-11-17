import type { Session, Snapshot } from './types';

/** A newer admitted ledger claim supersedes a stopped failure for display only.
 * Source history remains intact. Unknown admission, outstanding requests and live
 * old processes must never disappear merely because another session exists. */
export function supersededStoppedSession(snapshot: Snapshot, session: Session): boolean {
  const meta = session.runtime, binding = meta?.collaboration;
  if (!meta || !binding || meta.stoppedConfirmed !== true || session.dispatchPhase === 'unknown' ||
      !['failed', 'cancelled'].includes(session.status) || meta.request || Object.keys(meta.requests ?? {}).length) return false;
  const previous = snapshot.collaboration?.runs[binding.runId];
  if (!previous || previous.sessionId !== session.id || previous.claimEpoch !== binding.claimEpoch) return false;
  return Object.values(snapshot.sessions).some(next => {
    const current = next.runtime, claim = current?.collaboration;
    if (!current || !claim || next.dispatchPhase !== 'acknowledged' || !next.source?.sessionId ||
        claim.projectId !== binding.projectId || claim.taskId !== binding.taskId || claim.workItemId !== binding.workItemId ||
        current.purpose !== meta.purpose || claim.claimEpoch <= binding.claimEpoch ||
        current.purpose === 'discussion' && (current.planId !== meta.planId || current.scope !== meta.scope)) return false;
    const run = snapshot.collaboration?.runs[claim.runId];
    return !!run && run.sessionId === next.id && run.key === previous.key && run.claimEpoch === claim.claimEpoch;
  });
}
