import type { IdeaPlan, Snapshot } from './types';

/** Older approval code copied the round summary into direction-0 and marked it
 * userEdited. That generated marker is provenance, not proof of a user command.
 * Match its exact recorded text; never guess authority from words such as
 * "do not execute", and never suppress a separately confirmed proposal. */
export function isGeneratedDiscussionSummary(plan: IdeaPlan, lineId: string, text: string): boolean {
  return (plan.discussion?.conclusions ?? []).some(conclusion => {
    if (lineId !== `${conclusion.id}-direction-0` || text.trim() !== conclusion.summary.trim()) return false;
    const proposals = [...(conclusion.proposed ?? []), ...conclusion.confirmed, ...conclusion.open.filter(item => item.startsWith('Agent 提议，待用户确认：')).map(item => item.slice('Agent 提议，待用户确认：'.length))];
    return !proposals.some(item => item.trim() === text.trim());
  });
}

/** Read-only compatibility projection: leave old plan and decision facts intact. */
export function isGeneratedDiscussionSummaryDecision(snapshot: Snapshot, decision: { decisionId: string; text: string }): boolean {
  return Object.values(snapshot.ideaPlans ?? {}).some(plan => {
    const prefix = `plan:${plan.id}:line:`;
    return decision.decisionId.startsWith(prefix) && isGeneratedDiscussionSummary(plan, decision.decisionId.slice(prefix.length), decision.text);
  });
}
