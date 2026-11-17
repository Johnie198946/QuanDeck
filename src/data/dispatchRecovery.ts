import type { Session } from './types';
import type { RuntimeRunRecord } from './runtimeContracts';

/** A runtime container ID is not an admitted provider session ID. */
export function ownedAdmissionRecord(session: Session, record: RuntimeRunRecord): boolean {
  const meta = session.runtime;
  return !!meta && !!record.runId && record.dispatchId === meta.dispatchId && record.projectId === meta.projectId &&
    record.taskId === meta.taskId && record.workItemId === meta.workItemId &&
    (record.connectionId === meta.connection.connectionId || record.fallback?.acceptanceNotSent === true && record.fallback.fromConnectionId === meta.connection.connectionId && record.fallback.toConnectionId === record.connectionId);
}
export function rejectedAdmissionStopped(session?: Session | null): boolean {
  return session?.dispatchPhase === 'rejected' && session.runtime?.stoppedConfirmed === true && !session.source?.sessionId && !session.runtime.acceptedAt;
}
export function admissionAttemptState(session?: Session | null): 'sent' | 'failed' | 'unknown' {
  if (session?.dispatchPhase === 'acknowledged') return 'sent';
  if (rejectedAdmissionStopped(session)) return 'failed';
  return 'unknown';
}
export function canRetryDispatch(session?: Session | null): boolean {
  return !!session?.runtime && ['failed', 'cancelled'].includes(session.status) && session.dispatchPhase !== 'unknown' &&
    (rejectedAdmissionStopped(session) || session.dispatchPhase === 'acknowledged' && session.runtime.stoppedConfirmed === true);
}
