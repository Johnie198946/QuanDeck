import { applyCollaboration, ensureCollaboration, hashText } from './collaboration';
import { getTaskHandoff, type TaskHandoffTransfer } from './taskHandoff';
import type { Snapshot, CommandResult } from './types';

export type { TaskHandoffTransfer } from './taskHandoff';

export interface CreateTaskFromHandoffInput {
  sourceTaskKey: string;
  title: string;
  goal?: string;
  execute?: boolean;
  idempotencyKey: string;
}
export interface CreateTaskFromHandoffResult extends CommandResult {
  code?: string;
  taskId?: string;
  transferId?: string;
  sessionId?: string;
  replayed?: boolean;
}

/** One repository transaction creates the task, dependency, spec and immutable transfer receipt.
 * No source conversation is copied. Execution is a separate, normal admission after this commit.
 */
export function createTaskFromHandoffIn(
  snapshot: Snapshot, projectId: string, input: CreateTaskFromHandoffInput,
): CreateTaskFromHandoffResult {
  const reject = (code: string, message: string): CreateTaskFromHandoffResult => ({ ok: false, code, message });
  if (snapshot.project.id !== projectId) return reject('PROJECT_MISMATCH', '任务交接必须在当前项目内创建');
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['sourceTaskKey', 'title', 'goal', 'execute', 'idempotencyKey'].includes(key)) ||
      typeof input.sourceTaskKey !== 'string' || typeof input.title !== 'string' ||
      !input.title.trim() || input.title.trim().length > 200 ||
      input.goal !== undefined && (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 12000) ||
      input.execute !== undefined && typeof input.execute !== 'boolean' ||
      typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.idempotencyKey))
    return reject('SCHEMA_INVALID', '交接任务的来源、标题或请求编号无效');
  const title = input.title.trim(), goal = input.goal?.trim() || title;
  const fingerprint = hashText(JSON.stringify({ projectId, sourceTaskKey: input.sourceTaskKey, title, goal, execute: input.execute === true }));
  const c = ensureCollaboration(snapshot);
  const prior = c.handoffTransfers?.find(transfer => transfer.idempotencyKey === input.idempotencyKey);
  if (prior) {
    if (prior.fingerprint !== fingerprint) return reject('IDEMPOTENCY_CONFLICT', '这次交接请求已使用，请重新打开创建入口');
    return { ok: true, replayed: true, taskId: prior.targetTaskKey, transferId: prior.id, message: '交接任务已创建' };
  }
  const source = c.tasks[input.sourceTaskKey];
  const memory = source && getTaskHandoff(snapshot, input.sourceTaskKey, source.acceptedArtifactId);
  if (!source || source.archived || !source.acceptedArtifactId || !memory ||
      memory.reviewStatus !== 'accepted' || !memory.current || memory.stale || !memory.reviewId)
    return reject('HANDOFF_SOURCE_NOT_READY', '来源任务需要有当前有效的已验收成果，才能交给新任务');
  const result = applyCollaboration(snapshot, {
    projectId, idempotencyKey: 'handoff-create-' + input.idempotencyKey,
    type: 'create_task', payload: { title, goal, owner: 'agent',
      criteria: ['完成本任务目标，并给出可核对的成果与交接说明'], dependencies: [source.key] },
  }, { kind: 'human' });
  if (!result.ok || !result.resourceId) return result;
  // applyCollaboration may replace the collaboration object when committing its draft.
  const current = ensureCollaboration(snapshot);
  const transfer: TaskHandoffTransfer = {
    id: 'handoff-transfer-' + crypto.randomUUID(), projectId,
    sourceTaskKey: source.key, targetTaskKey: result.resourceId,
    sourceHandoffId: memory.record.id, sourceHandoffHash: memory.record.hash,
    sourceArtifactId: memory.record.artifactId, sourceArtifactHash: memory.record.artifactHash,
    sourceReviewId: memory.reviewId, at: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey, fingerprint,
  };
  (current.handoffTransfers ??= []).push(transfer);
  return { ok: true, taskId: result.resourceId, transferId: transfer.id, message: '交接任务已创建，来源与前置关系已固定' };
}
