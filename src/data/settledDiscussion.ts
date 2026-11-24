import { pendingSessionStatus } from './derive';
import { latestConclusion } from './discussion';
import { isDirectionRetrospective } from './discussionAuthority';
import { planIsApproved } from './projectWorkflow';
import { sessionSubmissionIssue } from './sessionDelivery';
import type { Session, Snapshot } from './types';

/** A source turn can remain open for optional follow-up after its business action
 * has ended. Keep receipts untouched and always give a live tool request priority. */
export function settledDiscussion(snapshot: Snapshot, session?: Session): boolean {
  const runtime = session?.runtime;
  if (!session || runtime?.purpose !== 'discussion' || !runtime.planId ||
      pendingSessionStatus(session) || !['waiting_reply','paused','failed'].includes(session.status)) return false;
  const plan = snapshot.ideaPlans?.[runtime.planId];
  if (!plan || runtime.projectId !== snapshot.project.id) return false;
  if (isDirectionRetrospective(snapshot, plan)) return true;

  const scope = runtime.scope ?? 'root';
  const conclusion = latestConclusion(plan, scope);
  const source = conclusion?.sourceRef, current = session.source;
  const sameSource = !!source && !!current && source.connectionId === current.connectionId &&
    source.tool === current.tool && source.sessionId === current.sessionId &&
    source.childSessionId === current.childSessionId && source.childCallId === current.childCallId;
  const approved = planIsApproved(plan);
  if (runtime.submissionIssue?.code === 'DISCUSSION_CONTEXT_STALE') {
    // A rejected edit on a still-open draft can need recovery. Once the newer
    // direction was confirmed, retain that rejected edit in conversation history.
    return approved;
  }
  if (session.status !== 'waiting_reply' || runtime.incident?.status === 'open' || sessionSubmissionIssue(session)) return false;
  if (runtime.controlPending === 'reply') return true;
  if (runtime.controlPending) return false;
  if (runtime.context.planVersion != null && runtime.context.planVersion !== plan.draftVersion) return true;
  if (source && current && !sameSource && plan.discussion?.conclusions.some(value =>
    value.scopeId === scope && value.sourceMessageId === runtime.finalReplyId && value.sourceRef?.sessionId === current.sessionId)) return true;
  const reply = session.rounds.at(-1);
  if (reply && runtime.finalReplyId === null && !session.waitingQuestion) return true;
  if (!reply || !conclusion || !sameSource || !runtime.finalReplyId || runtime.finalReplyId !== reply.id || conclusion.sourceMessageId !== reply.id) return false;
  if (conclusion.adopted) return approved && !!plan.adopted?.conclusionIds?.includes(conclusion.id);
  return !conclusion.open.length && !conclusion.proposed?.length;
}
