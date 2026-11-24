import { currentChangeRequest } from './deliveryReview';
import { deriveLedger, taskKey, isCollaborationArtifactFresh } from './collaboration';
import { deriveProjectActivity } from './projectActivity';
import { executionStage } from './executionProgress';
import { deliveryPresentation } from './deliveryPresentation';
import { taskOverviewRows, workBranch } from './results';
import { redactRuntimeText } from './runtimePresentation';
import type { Snapshot } from './types';
import { supersededStoppedSession } from './sessionHistory';
import { goalDeliveryReadiness } from './goalDelivery';
import { leafTaskRows } from './taskMap';

export interface ProgressScope { taskId?: string; workItemId?: string }
export interface ProgressEvidence { id: string; at: string; label: string; detail?: string }
const short = (text: string) => executionStage(redactRuntimeText(text));
const validTime = (at?: string) => !!at && Number.isFinite(Date.parse(at));

/** A disposable projection of the same ledger, source activity and delivery map.
 * Milestones are independently evidenced, not inferred percentages or a new state machine.
 */
export function taskProgressTrail(snapshot: Snapshot, scope: ProgressScope = {}) {
  const taskIds = new Set(scope.taskId ? [scope.taskId] : taskOverviewRows(snapshot).map(row => row.task.id));
  const orch = scope.taskId ? snapshot.orchestrations?.[scope.taskId] : undefined;
  const branch = scope.workItemId ? new Set(orch ? workBranch(orch, scope.workItemId).map(item => item.id) : [scope.workItemId]) : null;
  const inScope = (taskId: string, itemId?: string) => taskIds.has(taskId) && (!branch || !!itemId && branch.has(itemId));
  const rows = deriveLedger(snapshot).filter(row => !row.archived && inScope(row.taskId, row.workItemId));
  const keys = new Set(rows.map(row => row.key));
  const leaves = leafTaskRows(snapshot, rows);
  const activity = deriveProjectActivity(snapshot).entries.filter(entry => !!entry.taskId && inScope(entry.taskId, entry.itemId) &&
    (!entry.sessionId || snapshot.sessions[entry.sessionId]?.runtime?.purpose !== 'discussion'));
  const c = snapshot.collaboration;
  const runs = Object.values(c?.runs ?? {}).filter(run => keys.has(run.key) && run.purpose === 'execution');
  const currentRuns = new Set(rows.map(row => row.activeRunId).filter(id => !!id && c?.runs[id]?.purpose !== 'discussion' && c?.runs[id]?.purpose !== 'review'));
  const relevantCheckpoints = (c?.checkpoints ?? []).filter(cp => keys.has(cp.key) && (!c?.runs[cp.runId] || c.runs[cp.runId].purpose === 'execution'));
  const checkpoints = relevantCheckpoints.filter(cp => currentRuns.has(cp.runId));
  const checkpoint = [...checkpoints].sort((a, b) => b.at.localeCompare(a.at))[0];
  const delivery = deliveryPresentation(snapshot, scope);
  // Direct tasks can deliver without a predeclared map. Count only their current
  // ledger submission, never historical artifacts or fabricated output positions.
  const mappedKeys = new Set(delivery.slots.map(slot => slot.taskKey));
  const standalone = rows.filter(row => !mappedKeys.has(row.key) && !row.requiresRevalidation && ['in_review', 'done'].includes(row.status)).flatMap(row => {
    const ready = goalDeliveryReadiness(snapshot, row.key);
    if (!ready.complete || ready.unresolved.length || ready.applicable && !ready.current || !ready.artifact || !isCollaborationArtifactFresh(snapshot, ready.artifact.id)) return [];
    const review = [...(c?.reviews ?? [])].reverse().find(item => item.submissionId === ready.submission?.id);
    if (review?.verdict === 'needs_changes') return [];
    return [{ accepted: row.status === 'done' && row.acceptedArtifactId === ready.artifact.id }];
  });
  const standaloneAccepted = standalone.filter(item => item.accepted).length;
  const standaloneCandidates = standalone.length - standaloneAccepted;
  const candidateSlots = delivery.slots.filter(slot => slot.state === 'candidate').length;
  const accepted = delivery.accepted + standaloneAccepted;
  const candidates = candidateSlots + standaloneCandidates;
  const missing = delivery.total - delivery.filled;
  const reviews = new Map(c?.reviews.map(review => [review.submissionId, review]));
  const returns = rows.flatMap(row => {
    const review = currentChangeRequest(row, row.submission, reviews.get(row.latestSubmissionId ?? ''));
    return review ? [{ row, review }] : [];
  });
  const changesRequested = delivery.slots.filter(slot => slot.state === 'changes_requested').length;
  const stale = delivery.slots.filter(slot => slot.state === 'stale').length;
  const plans = Object.values(snapshot.ideaPlans ?? {}).filter(plan => (taskIds.has(plan.taskId) || !scope.taskId && plan.scope === 'project') &&
    (scope.workItemId ? plan.itemId === scope.workItemId : !plan.itemId));
  const confirmed = plans.filter(plan => plan.adopted?.draftVersion === plan.draftVersion).length;
  const revised = plans.filter(plan => plan.adopted && plan.adopted.draftVersion !== plan.draftVersion).length;
  const sessions = Object.values(snapshot.sessions).filter(s => s.taskId && inScope(s.taskId, s.runtime?.workItemId) && !s.linkedAsHistory && !supersededStoppedSession(snapshot, s) && s.runtime?.purpose !== 'discussion');
  const paused = leaves.filter(row => row.status === 'paused');
  const unfinished = leaves.filter(row => {
    if (['done', 'cancelled'].includes(row.status)) return false;
    if (row.status !== 'in_review') return true;
    const ready = goalDeliveryReadiness(snapshot, row.key);
    return !ready.complete || ready.unresolved.length > 0 || ready.applicable && !ready.current || row.requiresRevalidation;
  });
  const pending = activity.filter(entry => ['waiting_permission', 'waiting_reply', 'failed'].includes(entry.state));
  const running = activity.filter(entry => entry.state === 'running');
  const blocks = leaves.filter(row => row.status === 'blocked');
  const failed = leaves.filter(row => row.status === 'failed');
  const priority = pending[0] ?? running[0] ?? activity[0];
  const checkpointCurrent = checkpoint && priority?.taskId && checkpoint.key === taskKey(priority.taskId, priority.itemId);
  const current = priority ? {
    label: priority.state === 'waiting_permission' ? '等待授权' : priority.state === 'waiting_reply' ? '等待回复' : priority.state === 'failed' ? '遇到问题' : priority.state === 'running' ? '正在推进' : '排队中',
    title: priority.title,
    detail: short(priority.state === 'running' ? (checkpointCurrent && checkpoint.note || priority.step?.label || '') : priority.detail || ''),
  } : failed[0] ? { label: '遇到问题', title: failed[0].title, detail: short(failed[0].run?.error || failed[0].blockReason || '执行中断，等待处理') }
    : blocks[0] ? { label: '等待条件', title: blocks[0].title, detail: short(blocks[0].blockReason || '前置任务尚未满足') }
    : returns.length ? { label: '待修改', title: '按验收意见修改交付', detail: short(returns[0].review.note) }
    : changesRequested || stale ? { label: changesRequested ? '需要修改' : '需要更新', title: `${changesRequested + stale} 个交付位置需要补齐`, detail: short(delivery.slots.find(slot => slot.state === 'changes_requested' || slot.state === 'stale')?.missingReason || '') }
    : candidates && (unfinished.length || missing) ? { label: '仍需推进', title: unfinished.length ? `${unfinished.length} 项任务尚未交付完整候选` : `${missing} 个交付位置待补齐`, detail: `已有 ${candidates} 份候选可分别核对；当前范围尚未全部交付，不能整体验收。` }
    : candidates ? { label: '等待验收', title: standaloneCandidates ? `${candidates} 份候选成果已提交` : `${candidates} 个交付位置已有候选`, detail: '候选已保存，尚未等同于认可。' }
    : leaves.length > 0 && leaves.every(row => row.status === 'done') ? { label: '已记录完成', title: `${leaves.length} 项末级任务已完成`, detail: missing ? `还有 ${missing} 格交付需要补齐` : '' }
    : paused[0] ? { label: '已暂停', title: paused[0].title, detail: short(paused[0].blockReason || '') }
    : { label: accepted && !missing ? '成果已认可' : '下一步', title: accepted && !missing ? standaloneAccepted ? '当前交付成果已通过验收' : '已声明的交付位置均已通过验收' : revised ? '方向修订等待确认' : confirmed ? '按已确认方向继续推进' : scope.taskId ? '可以直接执行，或先讨论任务方向' : '确定项目方向与交付结构', detail: '' };
  const evidence: ProgressEvidence[] = [
    ...runs.map(run => {
      const sequence = runs.filter(other => other.key === run.key && Date.parse(other.startedAt) <= Date.parse(run.startedAt)).length;
      return { id: `run:${run.id}`, at: run.startedAt, label: sequence > 1 ? `开始第 ${sequence} 次执行` : '开始执行', detail: rows.find(row => row.key === run.key)?.title };
    }),
    ...runs.filter(run => run.status === 'failed' || run.status === 'lost').map(run => ({ id: `failure:${run.id}`, at: run.lastHeartbeatAt, label: run.status === 'lost' ? '执行连接中断' : '执行失败', detail: short(run.error || rows.find(row => row.key === run.key)?.title || '') })),
    ...relevantCheckpoints.map(cp => ({ id: `checkpoint:${cp.id}`, at: cp.at, label: currentRuns.has(cp.runId) ? '进展回执' : '历史进展', detail: short(cp.note || cp.completed.join('；')) })),
    ...(c?.submissions ?? []).filter(s => keys.has(s.key)).map(s => ({ id: `submission:${s.id}`, at: s.at, label: s.unresolved.length ? '保存部分候选' : '提交候选', detail: rows.find(row => row.key === s.key)?.title })),
    ...(c?.reviews ?? []).filter(r => keys.has(r.key)).map(r => ({ id: `review:${r.id}`, at: r.at, label: r.verdict === 'accepted' ? '验收通过' : '要求修改', detail: short(r.note) })),
  ].filter(e => validTime(e.at)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
  // A late receipt from a replaced run must not make the current execution look fresh.
  const currentTimes = [...sessions.filter(s => !s.runtime || currentRuns.has(s.runtime.collaboration?.runId ?? s.runtime.runId)).map(s => s.lastActivity), ...checkpoints.map(cp => cp.at), ...runs.filter(run => currentRuns.has(run.id)).map(run => run.startedAt)];
  const latest = (currentRuns.size ? currentTimes : [...sessions.map(s => s.lastActivity), ...evidence.map(e => e.at)]).filter(validTime).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  const milestones = [
    { id: 'direction', label: '方向', value: revised ? '修订待确认' : confirmed ? `${confirmed} 份已确认` : plans.length ? '讨论中' : '未单独讨论', observed: confirmed > 0, active: revised > 0 || !confirmed && plans.length > 0 },
    { id: 'execution', label: '执行', value: running.length ? `${running.length} 项推进中` : runs.length ? `${runs.length} 次执行记录` : '尚未开始', observed: runs.length > 0 || running.length > 0, active: running.length > 0 },
    { id: 'delivery', label: '交付', value: [delivery.total ? `${delivery.filled}/${delivery.total} 格有成果` : '', standalone.length ? `${standalone.length} 份直接交付` : ''].filter(Boolean).join(' · ') || '未声明输出位', observed: delivery.filled > 0 || standalone.length > 0, active: candidates > 0 },
    { id: 'review', label: '验收', value: [delivery.accepted ? `${delivery.accepted} 格已认可` : '', standaloneAccepted ? `${standaloneAccepted} 份已认可` : ''].filter(Boolean).join(' · ') || '尚未认可', observed: accepted > 0, active: false },
  ];
  return { milestones, current, evidence, latest, running: running.length, attention: pending.length + failed.filter(row => !pending.some(entry => taskKey(entry.taskId!, entry.itemId) === row.key)).length,
    blocked: blocks.length, unfinished: unfinished.length, candidates, candidateSlots, standaloneCandidates, accepted, executionCount: runs.length, missing, changesRequested, stale, totalSlots: delivery.total,
    completed: checkpoint?.completed.map(short) ?? [], remaining: checkpoint?.remaining.map(short) ?? [], checkpointAt: checkpoint?.at,
    checkpointTitle: checkpoint ? rows.find(row => row.key === checkpoint.key)?.title : undefined,
    leafCount: leaves.length, completedLeaves: leaves.filter(row => row.status === 'done').length };
}
