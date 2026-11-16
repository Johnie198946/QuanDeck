import { deriveProjectActivity, type ProjectActivityEntry } from './projectActivity';
import { executionProgress, executionStage } from './executionProgress';
import { goalDeliveryReadiness } from './goalDelivery';
import { taskKey } from './collaboration';
import { redactRuntimeText } from './runtimePresentation';
import { idleSessionDelivery } from './sessionDelivery';
import { activityText, latestAttempt, WORK_LABEL } from './orchestration';
import type { Orchestration, Snapshot, WorkItem, WorkStatus } from './types';

/** Read-only leaf display. Every surface uses the same concrete source request as the rail. */
export function workItemPresentation(snapshot: Snapshot, orchestration: Orchestration, item: WorkItem, activity: ProjectActivityEntry[] = deriveProjectActivity(snapshot).entries) {
  const entry = activity.find(value => value.taskId === orchestration.taskId && value.itemId === item.id);
  const attempt = latestAttempt(orchestration, item);
  const readiness=goalDeliveryReadiness(snapshot,taskKey(orchestration.taskId,item.id));
  const partial=readiness.partial&&!['done','cancelled'].includes(item.status);
  const session=entry?.sessionId?snapshot.sessions[entry.sessionId]:attempt?.sessionId?snapshot.sessions[attempt.sessionId]:undefined;
  const delivery = idleSessionDelivery(snapshot, session);
  const state: WorkStatus = entry?.state ?? (delivery ? delivery.accepted ? 'done' : 'review' : partial ? 'paused' : item.status);
  const requests=session?.runtime?.requests??(session?.runtime?.request?{[session.runtime.request.id]:session.runtime.request}:{});
  const priority=state==='waiting_permission'||state==='failed'||state==='running'||state==='queued'||state==='waiting_reply'&&Object.keys(requests).length>0;
  const awaitingCompletion=partial&&!priority;
  const label=awaitingCompletion?'待补齐':WORK_LABEL[state];
  const progress=entry?executionProgress(entry.state,entry.step,entry.percent):awaitingCompletion?executionProgress('paused'):null;
  const detail = delivery ? delivery.accepted ? '成果已认可。' : '完整候选成果已保存，等待验收。' : awaitingCompletion?redactRuntimeText(readiness.reason??'交付内容尚未补齐'):entry?.detail??item.waiting?.question??item.statusReason;
  const activityLabel = delivery || awaitingCompletion ? detail : entry?.detail ?? activityText(orchestration, { ...item, status: state });
  const attention = ['waiting_permission', 'waiting_reply', 'failed'].includes(state);
  return {
    state, label, partial, awaitingCompletion, delivery, entry, attempt,
    detail, activity: attention ? redactRuntimeText(activityLabel ?? label) : executionStage(activityLabel) || label,
    progress: progress&&awaitingCompletion?{...progress,label}:progress,
  };
}
