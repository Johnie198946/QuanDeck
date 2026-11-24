import type { IdeaPlan, PlanDoc, Snapshot } from './types';

/** Hide only the known empty generated approval group in the reading view.
 * Keep original documents and all real/user-named sections available to editors. */
export function visibleDirectionSections(doc: PlanDoc) {
  return doc.sections.filter(section => !(section.id === 's-direction' && section.title === '已确认方向' && section.kind === 'key' && section.lines.length === 0));
}

/** Reading a plan is separate from editing its skeleton. Don't turn defaults into apparent decisions. */
export function directionReadingSections(doc: PlanDoc, planId: string) {
  return visibleDirectionSections(doc).map(section => ({
    ...section,
    lines: section.lines.filter(line => line.text.trim() && !(section.id === 's-acceptance' && !line.userEdited &&
      line.id.startsWith(planId + '-criterion-') && line.text === '交付内容满足任务目标，并由负责人核对。')),
  })).filter(section => section.lines.length);
}

export function isDirectionRetrospective(snapshot: Snapshot, plan?: IdeaPlan | null): boolean {
  if (!plan || plan.scope === 'project') return false;
  const key = plan.itemId ? plan.taskId + '::' + plan.itemId : plan.taskId;
  const status = snapshot.collaboration?.tasks[key]?.status;
  return status ? ['in_review', 'done', 'cancelled'].includes(status)
    : plan.itemId ? ['done', 'cancelled'].includes(snapshot.orchestrations?.[plan.taskId]?.items[plan.itemId]?.status ?? '')
    : !!snapshot.tasks[plan.taskId]?.completion;
}

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
