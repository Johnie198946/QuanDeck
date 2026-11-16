import type { Session, Snapshot } from './types';
import { taskKey } from './collaboration';

export interface TaskInputDraft { schema: 'quandeck.task-input.v1'; id: string; text: string }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const newTaskInputDraft = (text = ''): TaskInputDraft => ({ schema: 'quandeck.task-input.v1', id: crypto.randomUUID(), text });
const parseDraft = (raw: string): TaskInputDraft | undefined => {
  try {
    const value = JSON.parse(raw);
    if (value?.schema === 'quandeck.task-input.v1' && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.id) && typeof value.text === 'string') return value;
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
  if (draft.text) storage.setItem(key, JSON.stringify(draft)); else storage.removeItem(key);
}
/** A delayed receipt owns only the exact version that was submitted, even after remount. */
export function clearTaskInputDraft(storage: DraftStorage, key: string, submitted: TaskInputDraft): boolean {
  const raw = storage.getItem(key), current = raw === null ? undefined : parseDraft(raw);
  if (!current || current.id !== submitted.id || current.text !== submitted.text) return false;
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
  return !!task && !!run && !['succeeded', 'failed', 'cancelled', 'lost'].includes(run.status)
    && task.activeRunId === binding.runId && task.claimEpoch === binding.claimEpoch && task.specRevision === binding.specRevision
    && !['in_review', 'done', 'cancelled'].includes(task.status);
}
