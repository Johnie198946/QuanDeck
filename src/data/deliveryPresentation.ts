import type { Snapshot } from './types';
import { deriveDeliveryMap } from './goalDelivery';
import { presentResult, taskResultEntries, type PresentedResult } from './resultPresentation';
import { workBranch } from './results';

export type DeliverySlot = ReturnType<typeof deriveDeliveryMap>['slots'][number];
export type DeliveryScope = { taskId?: string; workItemId?: string };
export const DELIVERY_STATE: Record<DeliverySlot['state'], string> = {
  empty: '等待交付', running: '正在完成', blocked: '等待条件', candidate: '候选成果',
  accepted: '已认可', changes_requested: '待修改', stale: '需要更新',
};

/** Display projection only: no text synthesis, receipts, or stored assembly state. */
export function deliveryPresentation(snapshot: Snapshot, scope: DeliveryScope = {}) {
  const map = deriveDeliveryMap(snapshot, scope.taskId ? { taskId: scope.taskId } : undefined);
  const orchestration = scope.taskId ? snapshot.orchestrations?.[scope.taskId] : undefined;
  const branch = scope.workItemId ? new Set(orchestration ? workBranch(orchestration, scope.workItemId).map(item => item.id) : [scope.workItemId]) : null;
  const slots = map.slots.filter(slot => !branch || !!slot.workItemId && branch.has(slot.workItemId));
  const usedOutputs = new Set(slots.map(slot => slot.artifact?.outputId).filter(Boolean));
  const history: { taskId: string; taskTitle: string; entry: PresentedResult }[] = [];
  const seen = new Set<string>();
  for (const task of Object.values(snapshot.tasks)) {
    if (scope.taskId && task.id !== scope.taskId) continue;
    for (const entry of taskResultEntries(snapshot, task.id, scope.workItemId ?? null)) {
      if (entry.record.outputId && usedOutputs.has(entry.record.outputId) || seen.has(entry.record.id)) continue;
      seen.add(entry.record.id); history.push({ taskId: task.id, taskTitle: task.title, entry });
    }
  }
  // Imported/deleted-task files remain readable without inventing a task or slot.
  if (!scope.taskId) for (const output of Object.values(snapshot.outputs ?? {})) {
    if (output.status !== 'published' || snapshot.tasks[output.taskId] || usedOutputs.has(output.id)) continue;
    history.push({ taskId: output.taskId, taskTitle: '历史任务', entry: presentResult(snapshot, output.taskId, {
      id: `output:${output.id}`, outputId: output.id, title: output.title, text: output.body,
      at: output.updatedAt, itemId: output.workItemId ?? undefined, origin: output.origin, links: output.links, attachments: output.attachments,
    }) });
  }
  history.sort((a, b) => b.entry.record.at.localeCompare(a.entry.record.at));
  const filled = slots.filter(slot => slot.state === 'candidate' || slot.state === 'accepted').length;
  return { ...map, slots, history, total: slots.length, filled,
    assembly: (!filled ? 'empty' : filled === slots.length ? 'assembled' : 'partial') as 'empty' | 'partial' | 'assembled',
    accepted: slots.filter(slot => slot.state === 'accepted').length };
}

export function deliverySlotEntry(snapshot: Snapshot, slot: DeliverySlot): PresentedResult | null {
  const artifact = slot.artifact;
  if (!artifact) return null;
  return presentResult(snapshot, slot.taskId, {
    id: `artifact:${artifact.id}`, outputId: artifact.outputId, title: artifact.title,
    text: artifact.body, at: artifact.createdAt, itemId: slot.workItemId,
    origin: artifact.runId ? 'agent' : 'human', links: artifact.links, attachments: artifact.attachments,
    sessionId: slot.sourceSessionId,
  }, slot.state !== 'accepted');
}

/** Slots may share task IDs; identity belongs to the saved plan and slot. */
export const deliverySlotKey = (slot: DeliverySlot) => JSON.stringify([slot.planId, slot.id]);
export function deliverySlotDepth(slot: DeliverySlot, slots: DeliverySlot[]) {
  let depth = 0, current = slot; const seen = new Set([slot.id]);
  while (current.parentId && !seen.has(current.parentId)) {
    const parent = slots.find(item => item.planId === slot.planId && item.id === current.parentId);
    if (!parent) break;
    seen.add(parent.id); current = parent; depth++;
  }
  return Math.min(depth, 3);
}
