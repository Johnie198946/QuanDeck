import { hashText } from './contentHash';
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

/** Recover only the opinion proven by the recorded fingerprint, including legacy drafts. */
export function rejectedDirectionDraft(session?: Session): {text:string; messageId:string} | undefined {
  const rt = session?.runtime, marker = rt?.initialDirectionMessage;
  if (!rt || !marker || !rejectedAdmissionStopped(session)) return;
  const heading = '本轮用户的方案意见：\n';
  const start = rt.context.prompt.indexOf(heading);
  if (start < 0) return;
  const excerpt = rt.context.prompt.slice(start + heading.length, start + heading.length + 10002);
  const matches = (text:string) => text.length > 0 && text.length <= 10000 && hashText(text) === marker.hash;
  if (marker.length !== undefined) {
    const text = excerpt.slice(0, marker.length);
    if (matches(text)) return {text, messageId:marker.id};
    return;
  }
  // Historical prompts delimit blocks with a blank line. An opinion may contain
  // blank lines of its own, so verify the fingerprint before recovering it.
  let attempts = 0;
  for (const boundary of excerpt.matchAll(/\n\n/g)) {
    if (++attempts > 64) break;
    const text = excerpt.slice(0, boundary.index);
    if (matches(text)) return {text, messageId:marker.id};
  }
}
