import type { OutputAttachment } from './types';

export type OutcomeDraft = {
  revision?: string; text: string; url: string; projectId: string; purpose: string;
  date: string; time: string; files: OutputAttachment[]; expectedAt: string | null;
};

const prefix = 'quandeck.agenda-outcome-draft.v1.';
export function outcomeDraftKey(entry: string, mode = 'record') {
  return prefix + JSON.stringify([entry, mode]);
}
export function readOutcomeDraft(key: string): OutcomeDraft | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && ['text','url','projectId','purpose','date','time'].every(k => typeof value[k] === 'string') &&
        Array.isArray(value.files)) return value;
  } catch { /* The editor can still open when the local cache is unavailable. */ }
}
export function hasOutcomeDraft(entry: string) {
  const draft = readOutcomeDraft(outcomeDraftKey(entry,entry.startsWith('followup:') ? 'receive' : 'record'));
  return !!draft && !!(draft.text.trim() || draft.url.trim() || draft.purpose.trim() || draft.projectId || draft.files.length);
}
export function outcomeDraftKeysForNote(noteId: string, todoIds?: Set<string>) {
  if (typeof localStorage === 'undefined') return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const [entry] = JSON.parse(key.slice(prefix.length));
      for (const kind of ['note:', 'followup:']) {
        const start = kind + noteId + ':';
        if (typeof entry === 'string' && entry.startsWith(start) && (!todoIds || todoIds.has(entry.slice(start.length)))) keys.push(key);
      }
    } catch { /* obsolete entry */ }
  }
  return keys;
}

export function draftRevision(key: string) {
  const draft = readOutcomeDraft(key);
  return draft ? draft.revision ?? JSON.stringify(draft) : null;
}
export async function withOutcomeLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(key,operation) : operation();
}
