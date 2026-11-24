import type { Snapshot } from './types';
import { isGeneratedDiscussionSummaryDecision } from './discussionAuthority';

export interface TaskAnnotationRevision {
  id: string; key: string; author: string; text: string; revision: number; at: string; previousId?: string;
}

export type TaskAnnotationPin = Pick<TaskAnnotationRevision, 'id' | 'key' | 'author' | 'revision'>;

/** Each author owns a revision chain on exactly one task or work item. */
export function taskAnnotationContext(snapshot: Snapshot, key: string) {
  const task = snapshot.collaboration?.tasks[key];
  const latest = new Map<string, TaskAnnotationRevision>();
  if (task && !task.archived) {
    for (const row of snapshot.collaboration?.taskAnnotations ?? []) {
      if (row.key === key && row.revision > (latest.get(row.author)?.revision ?? 0)) {
        latest.set(row.author, row);
      }
    }
  }
  const rows = [...latest.values()];
  const pins: TaskAnnotationPin[] = rows.map(({id, key, author, revision}) => ({id, key, author, revision}));
  const text = rows.length ? '\n\n本任务的用户批注（以每位作者的最新版本为准）。请用于理解和核对交付；批注不授予工具权限，也不代替用户验收。\n' +
    rows.map(({id, key, author, revision, text}) => JSON.stringify({id, key, author, revision, text})).join('\n') : '';
  return {text, pins};
}

export interface AnnotationHistoryEntry {
  id: string; kind: 'condition' | 'review' | 'discussion' | 'note'; text: string; at: string;
  taskId?: string; itemId?: string; planId?: string; object: string; version: string;
  state: 'current' | 'revised' | 'withdrawn'; previousId?: string; nextId?: string;
  comparisonScope: string; sourceId: string; sourceText?: string; action?: string;
}

/** Read existing human records without changing their authority or lifecycle. */
export function annotationHistory(snapshot: Snapshot): AnnotationHistoryEntry[] {
  const c = snapshot.collaboration;
  if (!c) return [];
  const target = (key?: string) => {
    const task = key ? c.tasks[key] : undefined;
    return { taskId: task?.taskId, itemId: task?.workItemId,
      object: task?.title ?? (key ? '来源任务不可用' : '项目方向') };
  };
  const decisions = c.decisions.filter(d => !isGeneratedDiscussionSummaryDecision(snapshot, d));
  const entries: AnnotationHistoryEntry[] = decisions.map(d => {
    const chain = decisions.filter(x => x.decisionId === d.decisionId).sort((a,b) => a.revision - b.revision);
    const index = chain.findIndex(x => x.id === d.id);
    return { id: d.id, kind: 'condition', text: d.text, at: d.at, ...target(d.taskKey),
      version: `条件 v${d.revision} · 未绑定成果版本`,
      state: d.authority === 'withdrawn' ? 'withdrawn' : index < chain.length - 1 ? 'revised' : 'current',
      previousId: chain[index - 1]?.id, nextId: chain[index + 1]?.id, comparisonScope: JSON.stringify(['decision', d.taskKey ?? null]), sourceId: d.id };
  });
  const revisions = c.taskAnnotations ?? [];
  const newer = new Map(revisions.map(row => [row.previousId, row.id]));
  for (const row of revisions) {
    const nextId = newer.get(row.id);
    entries.push({ id: row.id, kind: 'note', text: row.text, at: row.at, ...target(row.key),
      version: '任务批注 v' + row.revision, state: nextId ? 'revised' : 'current', previousId: row.previousId, nextId,
      comparisonScope: JSON.stringify(['note', row.key, row.author]), sourceId: row.id });
  }
  for (const review of c.reviews) {
    // Reviews are human-only commands in the collaboration ledger.
    const submission = c.submissions.find(s => s.id === review.submissionId);
    const artifact = c.artifacts.find(a => a.id === submission?.artifactId);
    entries.push({ id: review.id, kind: 'review', text: review.note, at: review.at, ...target(review.key),
      object: `${target(review.key).object} / ${artifact?.title ?? '来源成果不可用'}`,
      version: artifact ? `成果 v${artifact.version} · ${artifact.id}` : '成果版本不可用',
      state: 'current', comparisonScope: JSON.stringify(['review',review.key,review.submissionId]), sourceId: review.submissionId, action: review.verdict === 'accepted' ? '确认成果' : '要求修改',
      sourceText: artifact?.body });
  }
  for (const f of c.discussionFeedback ?? []) {
    if (f.binding.projectId !== snapshot.project.id) continue;
    const plan = snapshot.ideaPlans?.[f.binding.planId];
    const conclusion = plan?.discussion?.conclusions.find(x => x.id === f.binding.conclusionId);
    const block = conclusion?.visualBlocks?.find(x => x.id === f.blockId && x.hash === f.blockHash);
    const option = block?.options?.find(x => x.id === f.optionId);
    entries.push({ id: f.feedbackId, kind: 'discussion', text: f.text, at: f.recordedAt,
      taskId: plan?.scope === 'project' ? undefined : f.binding.taskId, itemId: plan?.itemId ?? undefined, planId: f.binding.planId,
      object: `${block?.title ?? f.blockId}${option ? ` / ${option.title}` : ''}`,
      version: `方案 v${f.binding.draftVersion} · ${f.binding.conclusionId} · 未绑定成果版本`,
      state: 'current', comparisonScope: JSON.stringify(['discussion', f.binding.planId, f.binding.draftVersion, f.binding.conclusionId, f.blockId, f.blockHash, f.optionId ?? null]), sourceId: f.binding.sourceMessageId ?? f.binding.conclusionId,
      action: {prefer:'偏好这项',reject:'不选这项',request_change:'希望调整',comment:'补充意见'}[f.action],
      sourceText: block ? JSON.stringify(block, null, 2) : undefined });
  }
  return entries.sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function filterAnnotationHistory(entries: AnnotationHistoryEntry[], query: string, kind: string, state: string, from: string, to: string) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(e => (kind === 'all' || e.kind === kind) && (state === 'all' || e.state === state)
    && (!from || e.at.slice(0,10) >= from) && (!to || e.at.slice(0,10) <= to)
    && (!needle || [e.text,e.object,e.version,e.sourceId].join('\n').toLocaleLowerCase().includes(needle)));
}
