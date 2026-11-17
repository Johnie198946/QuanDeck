import { pendingSessionStatus } from './derive';
import { latestConclusion } from './discussion';
import { planIsApproved } from './projectWorkflow';
import { sessionSubmissionIssue } from './sessionDelivery';
import type { Session, Snapshot } from './types';

/** Display-only resolution of a discussion, never an invented source completion.
 * The exact latest reply must belong to the approved direction. A source question,
 * a new unadopted conclusion, or a newer user turn always remains actionable. */
export function settledDiscussion(snapshot: Snapshot, session?: Session): boolean {
  const runtime = session?.runtime;
  if (!session || session.status !== 'waiting_reply' || runtime?.purpose !== 'discussion' ||
      !runtime.planId || runtime.controlPending || pendingSessionStatus(session) ||
      runtime.incident?.status === 'open' || sessionSubmissionIssue(session)) return false;
  const plan = snapshot.ideaPlans?.[runtime.planId];
  if (!plan || !planIsApproved(plan)) return false;
  const conclusion = latestConclusion(plan, runtime.scope ?? 'root');
  const reply = session.rounds.at(-1);
  if (!conclusion?.adopted || !plan.adopted?.conclusionIds?.includes(conclusion.id) ||
      !reply || runtime.finalReplyId !== reply.id || conclusion.sourceMessageId !== reply.id) return false;
  const source = conclusion.sourceRef, current = session.source;
  return !!source && !!current && source.connectionId === current.connectionId &&
    source.tool === current.tool && source.sessionId === current.sessionId &&
    source.childSessionId === current.childSessionId && source.childCallId === current.childCallId;
}
