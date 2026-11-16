import type { OutputAttachment, Session, Snapshot } from './types';
import { validateTaskAttachments } from './taskAttachments';
import { taskKey, taskDependencyReady } from './collaboration';
import { goalDeliveryReadiness } from './goalDelivery';
import { taskExecutionPresentation } from './taskExecutionPresentation';

export interface TaskInputDraft { schema: 'quandeck.task-input.v1'; id: string; text: string; attachments?: OutputAttachment[] }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const newTaskInputDraft = (text = '', attachments: OutputAttachment[] = []): TaskInputDraft => ({ schema: 'quandeck.task-input.v1', id: crypto.randomUUID(), text, ...(attachments.length ? { attachments: validateTaskAttachments(attachments) } : {}) });
export const hasTaskInput = (draft: TaskInputDraft) => !!draft.text.trim() || !!draft.attachments?.length;
export const sameTaskInputDraft = (a: TaskInputDraft, b: TaskInputDraft) => a.id === b.id && a.text === b.text && JSON.stringify(a.attachments ?? []) === JSON.stringify(b.attachments ?? []);
/** File clipboard items are independent of plain text; preserve pasted text alongside them. */
export function taskInputClipboardFiles(clipboard: Pick<DataTransfer, 'items' | 'files'>): File[] {
  const items = Array.from(clipboard.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
  return items.length ? items : Array.from(clipboard.files ?? []);
}
const parseDraft = (raw: string): TaskInputDraft | undefined => {
  try {
    const value = JSON.parse(raw);
    if (value?.schema === 'quandeck.task-input.v1' && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.id) && typeof value.text === 'string') return { schema: value.schema, id: value.id, text: value.text, ...(value.attachments?.length ? { attachments: validateTaskAttachments(value.attachments) } : {}) };
  } catch { /* Legacy drafts contain plain text. */ }
};
export function readTaskInputDraft(storage: DraftStorage, key: string): TaskInputDraft {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return newTaskInputDraft(); }
  if (raw === null) return newTaskInputDraft();
  const existing = parseDraft(raw);
  if (existing) return existing;
  const migrated = newTaskInputDraft(raw);
  try { storage.setItem(key, JSON.stringify(migrated)); } catch { /* Keep an editable in-memory draft when storage is unavailable. */ }
  return migrated;
}
export function storeTaskInputDraft(storage: DraftStorage, key: string, draft: TaskInputDraft): void {
  if (draft.text || draft.attachments?.length) storage.setItem(key, JSON.stringify(draft)); else storage.removeItem(key);
}
/** A delayed receipt owns only the exact version that was submitted, even after remount. */
export function clearTaskInputDraft(storage: DraftStorage, key: string, submitted: TaskInputDraft): boolean {
  const raw = storage.getItem(key), current = raw === null ? undefined : parseDraft(raw);
  if (!current || !sameTaskInputDraft(current, submitted)) return false;
  storage.removeItem(key);
  return true;
}

/** A note can always be saved; sending it must respect the current managed run. */
export function canReplyToTask(snapshot: Snapshot, session: Session): boolean {
  const runtime = session.runtime;
  if (!runtime?.runId || runtime.controlPending || !['waiting_reply', 'paused', 'failed'].includes(session.status)) return false;
  if (session.dispatchPhase && session.dispatchPhase !== 'acknowledged') return false;
  if (runtime.handedOffTo && snapshot.sessions[runtime.handedOffTo]?.dispatchPhase !== 'rejected') return false;
  if (Object.keys(runtime.requests ?? (runtime.request ? { [runtime.request.id]: runtime.request } : {})).length) return false;
  const binding = runtime.collaboration;
  if (!binding) return true;
  const task = snapshot.collaboration?.tasks[taskKey(binding.taskId, binding.workItemId)];
  const run = snapshot.collaboration?.runs[binding.runId];
  const readiness=goalDeliveryReadiness(snapshot,taskKey(binding.taskId,binding.workItemId));
  return !!task && !!run && !task.archived && (!readiness.applicable||readiness.current)
    && (run.purpose!=='execution'||task.dependencies.every(dep=>taskDependencyReady(snapshot,task.key,dep)))
    && !['succeeded', 'failed', 'cancelled', 'lost'].includes(run.status)
    && task.activeRunId === binding.runId && task.claimEpoch === binding.claimEpoch && task.specRevision === binding.specRevision
    && !['done', 'cancelled'].includes(task.status) && (task.status!=='in_review'||readiness.partial&&readiness.current);
}

/** Do not redirect a blocked child conversation into an older paused parent run. */
export function taskReplyTargets(snapshot: Snapshot, taskId: string): Session[] {
  const scope = taskExecutionPresentation(snapshot, taskId);
  const ids = scope.hasChildActivity ? scope.rows.flatMap(row => row.sessionId ? [row.sessionId] : []) : snapshot.tasks[taskId]?.sessionIds ?? [];
  return [...new Set(ids)].flatMap(id => snapshot.sessions[id] && canReplyToTask(snapshot, snapshot.sessions[id]) ? [snapshot.sessions[id]] : []);
}
/** Native files only; internal task/session drags must retain their original behavior. */
export const hasTaskInputFileTransfer = (transfer: Pick<DataTransfer, 'types'>) => Array.from(transfer.types ?? []).includes('Files');
