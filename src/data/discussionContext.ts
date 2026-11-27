import { buildContextPackage, hashText, isCollaborationArtifactFresh } from './collaboration';
import { projectMemoryNotes, runLessonPins } from './projectMemoryNotes';
import { stableContent } from './contentHash';
import { goalDependencySource } from './goalDelivery';
import { projectSpecContextCurrent } from './specLineage';
import { deriveTaskHandoffs } from './taskHandoff';
import type { Session, Snapshot } from './types';

/** A discussion result is current only while its fixed business inputs remain
 * provable. This check never edits the historical context or source reply. */
export function discussionContextIssue(snapshot: Snapshot, session: Session): string | undefined {
  const rt = session.runtime, binding = rt?.collaboration, c = snapshot.collaboration;
  if (!rt || rt.purpose !== 'discussion') return;
  const context = binding && c?.contextPackages.find(item => item.id === binding.contextPackageId);
  if (!binding || !c || !context || context.key !== binding.taskId || context.runId !== binding.runId || context.key !== `planning:${rt.planId}:${rt.scope ?? 'root'}:${rt.context.planVersion}` || hashText(context.prompt) !== context.hash)
    return '讨论缺少可校验的固定上下文';
  const task = c.tasks[context.key], run = c.runs[binding.runId];
  if (!task || task.archived || task.activeRunId !== binding.runId || task.claimEpoch !== binding.claimEpoch || task.specRevision !== binding.specRevision || !run || run.contextPackageId !== context.id || ['failed', 'cancelled', 'lost'].includes(run.status))
    return '讨论的执行权或运行绑定已变化';
  if (!projectSpecContextCurrent(snapshot, context)) return '项目规范已更新';
  const lessonPins = runLessonPins(snapshot, context);
  if (lessonPins.length) {
    const effective = projectMemoryNotes(snapshot).filter(note => note.status === 'confirmed' && !note.stale);
    if (lessonPins.some(pin => !effective.some(note => note.id === pin.id && note.revision === pin.revision && note.hash === pin.hash)))
      return '讨论引用的经验已修订、撤回或失效';
  }
  let current: typeof context;
  try { current = buildContextPackage(snapshot, context.key); }
  catch (error) { return error instanceof Error ? error.message : '讨论范围或固定来源已变化'; }
  if (stableContent(context.reworkReview ?? null) !== stableContent(current.reworkReview ?? null)) return '讨论所依据的返工意见已变化';
  const target = context.discussionTarget, latest = current.discussionTarget;
  const targetContent = (value: typeof target) => value && { planId: value.planId, scope: value.scope, draftVersion: value.draftVersion, key: value.key, specId: value.specId, specRevision: value.specRevision, goal: value.goal, criteria: value.criteria, ...(target?.deliverables ? {deliverables:value.deliverables} : {}) };
  if (stableContent(targetContent(target)) !== stableContent(targetContent(latest))) return '讨论目标的任务要求已更新';
  if (target && (target.planId !== rt.planId || target.scope !== (rt.scope ?? 'root'))) return '讨论目标与当前会话绑定不一致';
  if (context.ancestorSpecs && stableContent(context.ancestorSpecs) !== stableContent(current.ancestorSpecs)) return '讨论继承的父任务要求已更新';
  if (stableContent(context.sharedDecisionPins ?? []) !== stableContent(current.sharedDecisionPins ?? [])) return '讨论引用的共同决定已更新';
  if (stableContent(context.constraints) !== stableContent(current.constraints)) return '讨论适用的用户条件已更新';
  const sourceScope = target?.key ?? context.key;
  for (const source of context.sources) {
    const artifact = c.artifacts.find(item => item.id === source.id);
    if (!artifact || artifact.hash !== source.hash || hashText(artifact.body) !== source.hash || !isCollaborationArtifactFresh(snapshot, source.id) ||
        !(c.tasks[artifact.key]?.acceptedArtifactId === artifact.id && !c.tasks[artifact.key]?.requiresRevalidation) &&
        !(source.freshness === 'candidate' && goalDependencySource(snapshot, sourceScope, artifact.key, false)?.id === source.id))
      return '讨论引用的固定成果已变化或失效';
  }
  const handoffs = deriveTaskHandoffs(snapshot);
  for (const pin of context.handoffPins ?? []) {
    const memory = handoffs.find(item => item.record.id === pin.id);
    const sameReview = memory?.reviewStatus === pin.reviewStatus && memory.reviewId === pin.reviewId;
    const nowAccepted = pin.reviewStatus === 'unreviewed' && memory?.reviewStatus === 'accepted';
    if (!memory || !memory.current || memory.stale || memory.record.hash !== pin.hash || memory.record.contentHash !== pin.contentHash || memory.record.artifactId !== pin.artifactId || memory.record.artifactHash !== pin.artifactHash || !sameReview && !nowAccepted)
      return '讨论引用的固定交接记录已变化或失效';
  }
  const required = (value: typeof context) => value.sources.filter(source => source.required).map(source => [source.id, source.hash]).sort((a, b) => a[0].localeCompare(b[0]));
  if (stableContent(required(context)) !== stableContent(required(current))) return '讨论需要的前置资料已变化';
}
