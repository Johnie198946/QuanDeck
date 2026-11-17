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
  targetTaskKey?: string;
  expectedTargetVersion?: number;
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
      Object.keys(input).some(key => !['sourceTaskKey', 'title', 'goal', 'execute', 'idempotencyKey', 'targetTaskKey', 'expectedTargetVersion'].includes(key)) ||
      typeof input.sourceTaskKey !== 'string' || typeof input.title !== 'string' ||
      !input.title.trim() || input.title.trim().length > 200 ||
      input.goal !== undefined && (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 12000) ||
      input.execute !== undefined && typeof input.execute !== 'boolean' ||
      input.targetTaskKey !== undefined && (typeof input.targetTaskKey !== 'string' || !input.targetTaskKey || !Number.isSafeInteger(input.expectedTargetVersion)) ||
      typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.idempotencyKey))
    return reject('SCHEMA_INVALID', '交接任务的来源、标题或请求编号无效');
  const title = input.title.trim(), goal = input.goal?.trim() || title;
  const fingerprint = hashText(JSON.stringify({ projectId, sourceTaskKey: input.sourceTaskKey, title, goal, execute: input.execute === true,
    targetTaskKey: input.targetTaskKey, expectedTargetVersion: input.expectedTargetVersion }));
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
  const target = input.targetTaskKey ? c.tasks[input.targetTaskKey] : undefined;
  if (input.targetTaskKey) {
    if (!target || target.workItemId || target.archived || target.key === source.key)
      return reject('HANDOFF_TARGET_INVALID', '请选择同项目内另一个尚未执行的主任务');
    if (target.version !== input.expectedTargetVersion)
      return reject('VERSION_CONFLICT', '接收任务已变化，请刷新后重新选择');
    const scope = new Set(Object.values(c.tasks).filter(task => task.taskId === target.taskId).map(task => task.key));
    if (!['draft', 'ready', 'blocked'].includes(target.status) ||
        Object.values(c.tasks).some(task => scope.has(task.key) && !!task.activeRunId) ||
        Object.values(c.runs).some(run => scope.has(run.key) && run.purpose === 'execution') ||
        c.submissions.some(submission => scope.has(submission.key)) ||
        Object.values(snapshot.sessions).some(session =>
          (session.taskId === target.taskId || session.runtime?.taskId === target.taskId) &&
          session.runtime?.purpose !== 'discussion'))
      return reject('HANDOFF_TARGET_STARTED', '接收任务已经执行或交付，请创建新任务以保留原上下文');
    if (title !== target.title || input.goal !== undefined)
      return reject('HANDOFF_TARGET_CHANGED', '交接不会改写接收任务的目标，请使用当前任务标题');
    if (c.handoffTransfers?.some(transfer => transfer.sourceTaskKey === source.key && transfer.targetTaskKey === target.key))
      return reject('HANDOFF_ALREADY_LINKED', '这两个任务已建立固定交接关系，请进入接收任务继续');
  }
  const result = applyCollaboration(snapshot, {
    projectId, idempotencyKey: 'handoff-create-' + input.idempotencyKey,
    type: target ? 'set_dependencies' : 'create_task', taskId: target?.taskId, expectedVersion: target?.version,
    payload: target ? { dependencies: [...new Set([...target.dependencies, source.key])] } : { title, goal, owner: 'agent',
      criteria: ['完成本任务目标，并给出可核对的成果与交接说明'], dependencies: [source.key] },
  }, { kind: 'human' });
  if (!result.ok) return result;
  const targetKey = target?.key ?? result.resourceId;
  if (!targetKey) return reject('HANDOFF_TARGET_INVALID', '接收任务未创建');
  // applyCollaboration may replace the collaboration object when committing its draft.
  const current = ensureCollaboration(snapshot);
  const transfer: TaskHandoffTransfer = {
    id: 'handoff-transfer-' + crypto.randomUUID(), projectId,
    sourceTaskKey: source.key, targetTaskKey: targetKey,
    sourceHandoffId: memory.record.id, sourceHandoffHash: memory.record.hash,
    sourceArtifactId: memory.record.artifactId, sourceArtifactHash: memory.record.artifactHash,
    sourceReviewId: memory.reviewId, at: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey, fingerprint,
  };
  (current.handoffTransfers ??= []).push(transfer);
  return { ok: true, taskId: targetKey, transferId: transfer.id, message: target ? '任务交接已登记，原目标与方向保留' : '交接任务已创建，来源与前置关系已固定' };
}
