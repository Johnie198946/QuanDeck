import { hashText } from '../../data/contentHash';
import { sameTableSizes, type NoteTableSizes } from '../../data/noteTableSizes';
import { KNOWLEDGE_FILES, noteDisplayTitle, updateNote, type KnowledgeNote } from '../../data/knowledgeNotes';
import { mutateKnowledge } from '../../data/knowledgeStore';
import { removeOutputFile, saveOutputFile } from '../../data/outputFiles';

const prefix = 'quandeck.note-draft.v1.';
const idleMs = 30_000;
const maximumWait = 120_000;
let writerKey = '';
function draftWriter() {
  if (writerKey) return writerKey;
  try {
    writerKey = sessionStorage.getItem('quandeck.note-draft-writer') || crypto.randomUUID();
    sessionStorage.setItem('quandeck.note-draft-writer', writerKey);
  } catch { writerKey = crypto.randomUUID(); }
  return writerKey;
}
export class NoteDraftConflictError extends Error {
  constructor(readonly stored: KnowledgeNote) {
    super('已保存的笔记有变化，你的编辑仍在本机草稿中。');
    this.name = 'NoteDraftConflictError';
  }
}

type Draft = {
  base?: { textHash: string; tableSizes?: NoteTableSizes };
  inherited?: Record<string, string>;
  tableSizes?: NoteTableSizes;
  title: string;
  body: string;
  incoming: KnowledgeNote['attachments'];
  baseRevision?: number;
  editedAt: string;
};
type DraftView = Draft & { dirty: boolean; saving: boolean; error?: string; conflict?: KnowledgeNote; saved?: KnowledgeNote };
export interface DraftSession {
  noteId: string;
  scratchKey: string;
  discarded?: boolean;
  onDiscard?:()=>void;
  view: DraftView;
  observe: (listener: () => void) => () => void;
  listeners: Set<() => void>;
  pending: Set<Promise<void>>;
  timer?: number;
  firstPendingEdit?: number;
  saving?: Promise<KnowledgeNote | undefined>;
  previews: Map<string, string>;
  uploadedIds: Map<string, string>;
}
const sessions = new Map<string, DraftSession>();
const parseDraft = (key: string): Draft | undefined => {
  try {
    const raw = localStorage.getItem(key);
    const draft = raw && JSON.parse(raw) as Draft;
    return draft && typeof draft.title === 'string' && typeof draft.body === 'string' && Array.isArray(draft.incoming) ? draft : undefined;
  } catch { return; }
};
export function blankNote(id: string = crypto.randomUUID()): KnowledgeNote {
  const at = new Date().toISOString();
  return { id, title: '未命名', body: '', createdAt: at, updatedAt: at, revision: 1, attachments: [], expansions: [], history: [] };
}
function scratchEntries(id?: string) {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(id ? prefix + id + '.' : prefix))
      .flatMap(key => { const draft = parseDraft(key); return draft ? [{ key, draft }] : []; })
      .sort((a, b) => b.draft.editedAt.localeCompare(a.draft.editedAt));
  } catch { return []; }
}
export function unpublishedNotes(saved: ReadonlySet<string>) {
  const seen = new Set(saved);
  return scratchEntries().flatMap(({ key, draft }) => {
    const id = key.slice(prefix.length).split('.')[0];
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ ...blankNote(id), title: noteDisplayTitle(draft.title, draft.body), updatedAt: draft.editedAt }];
  });
}

function textHash(note: KnowledgeNote) {
  return hashText(JSON.stringify([note.title, note.body]));
}
function viewOf(note?: KnowledgeNote): DraftView {
  return { inherited: undefined, base: undefined, title: note?.title ?? '', body: note?.body ?? '', tableSizes: note?.tableSizes, incoming: [], baseRevision: note?.revision, editedAt: note?.updatedAt ?? '', dirty: false, saving: false, saved: note };
}
export function noteDraftSession(note: KnowledgeNote, saved: boolean, initialText?: string): DraftSession {
  const existing = sessions.get(note.id);
  if (existing) return existing;
  const ownKey = prefix + note.id + '.' + draftWriter();
  const drafts = scratchEntries(note.id);
  const own = drafts.find(entry => entry.key === ownKey);
  const recovered = own && own.draft.editedAt === drafts[0]?.draft.editedAt ? own : drafts[0];
  // A newer draft may come from a previous app launch. Preserve a different
  // writer-owned draft at its original key until the user can reconcile it.
  let scratchKey = ownKey;
  if (recovered?.key.startsWith(ownKey + '.')) scratchKey = recovered.key;
  else if (own && recovered?.key !== own.key) scratchKey = ownKey + '.' + crypto.randomUUID();
  const stored = recovered && { ...recovered.draft, body: withoutPendingFiles(recovered.draft.body) };
  if (stored && recovered.key !== scratchKey) {
    stored.inherited = { ...stored.inherited, [recovered.key]: hashText(JSON.stringify(recovered.draft)) };
  }
  const view = stored ? { ...stored, dirty: true, saving: false, saved: saved ? note : undefined } : viewOf(saved ? note : undefined);
  const session: DraftSession = { noteId: note.id, scratchKey, view, pending: new Set(), listeners: new Set(), previews: new Map(), uploadedIds: new Map(),
    observe(listener) { session.listeners.add(listener); return () => session.listeners.delete(listener); } };
  sessions.set(note.id, session);
  if (initialText) editDraft(session, { body: initialText });
  if (stored) { writeScratch(session); schedule(session); }
  return session;
}
export function unsavedEditTime(noteId:string) {
  const view=sessions.get(noteId)?.view;
  return view?.dirty ? view.editedAt : undefined;
}
function publish(session: DraftSession, update: Partial<DraftView>) {
  const oldMinute = unsavedEditTime(session.noteId)?.slice(0,16);
  session.view = { ...session.view, ...update };
  session.listeners.forEach(listener => listener());
  if (oldMinute !== unsavedEditTime(session.noteId)?.slice(0,16))
    window.dispatchEvent(new Event('quandeck:note-draft-list'));
}
function writeScratch(session: DraftSession) {
  if (session.discarded) return;
  try {
    if (session.view.dirty) {
      const { title, body, tableSizes, incoming, baseRevision, editedAt, base, inherited } = session.view;
      localStorage.setItem(session.scratchKey, JSON.stringify({ title, body: withoutPendingFiles(body), tableSizes, incoming, baseRevision, editedAt, base, inherited }));
    } else {
      localStorage.removeItem(session.scratchKey);
      for (const { key, draft } of scratchEntries(session.noteId)) {
        if (session.view.saved && draft.body === session.view.saved.body && sameTableSizes(draft.tableSizes, session.view.saved.tableSizes) &&
            noteDisplayTitle(draft.title, draft.body) === session.view.saved.title &&
            draft.incoming.every(file => session.view.saved?.attachments.some(saved => saved.id === file.id))) localStorage.removeItem(key);
      }
    }
  } catch {
    publish(session, { error: '暂时无法保存编辑草稿，内容仍在当前窗口。' });
  }
}
// Keep original files available for undo. Only visible attachments occupy a slot.
function attachmentCount(files: KnowledgeNote['attachments'], body: string, expansions: KnowledgeNote['expansions'] = []) {
  const content = [body, ...expansions.map(item => item.answer)].join('\n');
  const references = new Set(Array.from(content.matchAll(/!?\[[^\]]*\]\(attachment:([0-9a-z-]+)\)/gi), match => match[1]));
  return files.filter(file => references.has(file.id)).length;
}
const pendingLink = /!?\[[^\]]*\]\(attachment:(pending-[0-9a-f-]+)\)/gi;
function withoutPendingFiles(body: string) { return body.replace(pendingLink, ''); }
function schedule(session: DraftSession) {
  window.clearTimeout(session.timer);
  session.firstPendingEdit ??= Date.now();
  const remaining = Math.max(0, session.firstPendingEdit + maximumWait - Date.now());
  session.timer = window.setTimeout(() => { void flushDraft(session).catch(() => {}); }, Math.min(idleMs,remaining));
}
export function syncSavedNote(session: DraftSession, note: KnowledgeNote) {
  const previous = session.view.saved;
  if (session.view.dirty || session.view.saving || previous === note) return;
  if (previous && (note.revision < previous.revision ||
      note.revision === previous.revision && note.updatedAt < previous.updatedAt)) return;
  if (!previous || note.revision !== previous.revision || !sameTableSizes(note.tableSizes, previous.tableSizes)) publish(session, viewOf(note));
  else publish(session, { saved: note });
}
export function editDraft(session: DraftSession, fields: Partial<Pick<Draft, 'title' | 'body' | 'incoming' | 'tableSizes'>>) {
  if (session.discarded) return;
  const previous = session.view;
  const base = previous.base ?? (previous.saved && previous.baseRevision === previous.saved.revision ?
    { textHash: textHash(previous.saved), tableSizes: previous.saved.tableSizes } : undefined);
  publish(session, { ...fields, base, dirty: true, editedAt: new Date().toISOString(), error: undefined });
  writeScratch(session);
  if (!session.view.saved && previous.dirty && noteDisplayTitle(previous.title,previous.body)!==noteDisplayTitle(session.view.title,session.view.body)) {
    window.dispatchEvent(new Event('quandeck:note-draft-list'));
  }
  schedule(session);
}

export function flushDraft(session: DraftSession, drain = false): Promise<KnowledgeNote | undefined> {
  if (session.discarded) return Promise.resolve(undefined);
  if (session.saving) return drain ? session.saving.then(result => session.view.dirty || session.pending.size ? flushDraft(session, true) : result) : session.saving;
  if (!session.view.dirty && !session.pending.size) return Promise.resolve(session.view.saved);
  window.clearTimeout(session.timer);
  session.firstPendingEdit=undefined;
  const save = async () => {
    while (session.pending.size) await Promise.allSettled(session.pending);
    const captured = session.view;
    if (!captured.dirty) return captured.saved;
    if (captured.baseRevision === undefined && !captured.title.trim() && !captured.body.trim() && !captured.incoming.length) {
      publish(session, { dirty: false });
      writeScratch(session);
      return;
    }
    publish(session, { saving: true, error: undefined });
    try {
      let committed: KnowledgeNote | undefined;
      const now = new Date().toISOString();
      await mutateKnowledge(library => {
        if (session.discarded || library.deletedNoteIds?.includes(session.noteId)) {
          discardNoteDraft(session.noteId);
          return;
        }
        const index = library.notes.findIndex(note => note.id === session.noteId);
        const previous = index < 0 ? undefined : library.notes[index];
        if (!previous && captured.baseRevision !== undefined) throw new Error('原笔记已不存在，编辑仍在本机草稿中。');
        const note = previous ?? { ...blankNote(session.noteId), createdAt: captured.editedAt };
        const attachments = [...note.attachments, ...captured.incoming.filter(file => !note.attachments.some(item => item.id === file.id))];
        if (attachmentCount(attachments, captured.body, note.expansions) > 20) throw new Error('每条笔记最多保存 20 个附件');
        let tableSizes = captured.tableSizes;
        const baselineSizes = captured.base ? captured.base.tableSizes : captured.saved?.tableSizes;
        if (previous && !sameTableSizes(previous.tableSizes, baselineSizes) && !sameTableSizes(previous.tableSizes, tableSizes)) {
          if (captured.body === previous.body && sameTableSizes(tableSizes, baselineSizes)) tableSizes = previous.tableSizes;
          else { publish(session,{conflict:previous}); throw new NoteDraftConflictError(previous); }
        }
        committed = updateNote(note, { title: captured.title, body: captured.body, tableSizes, attachments }, now);
        if (previous && previous.revision !== captured.baseRevision && committed !== previous && captured.base?.textHash !== textHash(previous)) {
          publish(session,{conflict:previous});
          throw new NoteDraftConflictError(previous);
        }
        if (index < 0) library.notes.push(committed);
        else library.notes[index] = committed;
      });
      if (!committed || session.discarded) return;
      const saved = committed;
      // Only retire recovered copies once a descendant has actually committed.
      // Writers may have continued editing since recovery or CAS retries.
      for (const [key, hash] of Object.entries(captured.inherited ?? {})) {
        if (!key.startsWith(prefix + session.noteId + '.') || key === session.scratchKey) continue;
        const inherited = parseDraft(key);
        if (inherited && hashText(JSON.stringify(inherited)) === hash) localStorage.removeItem(key);
      }
      const next = session.view;
      const remaining = next.incoming.filter(file => !saved.attachments.some(item => item.id === file.id));
      const newer = next.title !== captured.title || next.body !== captured.body || !sameTableSizes(next.tableSizes,captured.tableSizes) || remaining.length > 0;
      publish(session, newer
        ? { error:undefined, conflict:undefined, baseRevision: saved.revision, base: { textHash:textHash(saved), tableSizes:saved.tableSizes }, inherited:undefined, incoming: remaining, saving: false, saved }
        : { ...viewOf(saved), error:undefined, conflict:undefined, title: captured.title });
      writeScratch(session);
      if (newer) schedule(session);
      return saved;
    } catch (error) {
      publish(session, { saving: false, error: error instanceof Error ? error.message : '笔记暂时无法保存，草稿已保留' });
      throw error;
    }
  };
  session.saving = save().finally(() => { session.saving = undefined; });
  return drain ? flushDraft(session, true) : session.saving;
}

/** The user reviewed this specific stored version. A newer one still fails the normal save check. */
export async function saveReviewedDraft(session:DraftSession, reviewed:KnowledgeNote) {
  if (!session.view.dirty || session.view.conflict!==reviewed || session.saving) return;
  publish(session,{baseRevision:reviewed.revision,base:{textHash:textHash(reviewed),tableSizes:reviewed.tableSizes},saved:reviewed,conflict:undefined,error:undefined});
  writeScratch(session);
  await flushDraft(session,true);
}

const supportedPicture = /^(image\/(?:png|jpeg|gif|webp))$/i;
export const isNotePicture = (file: { type: string }) => supportedPicture.test(file.type);
export function uploadNoteFiles(
  session: DraftSession, files: File[], insert: (file: File, preview: string, placeholder: string) => void,
  finalized: (placeholder: string, id: string) => void,
) {
  if (!files.length) return;
  const view = session.view;
  const placed = attachmentCount([...(view.saved?.attachments ?? []), ...view.incoming], view.body, view.saved?.expansions);
  if (placed + session.pending.size + files.length > 20 ||
      files.some(file => file.size > 25 * 1024 * 1024)) {
    publish(session, { error: '每条笔记最多保存 20 个文件，每个文件不超过 25 MB' });
    return;
  }
  for (const file of files) {
    const placeholder = 'pending-' + crypto.randomUUID();
    const url = isNotePicture(file) ? URL.createObjectURL(file) : '';
    if (url) session.previews.set(placeholder, url);
    insert(file, url, placeholder);
    const task = saveOutputFile(KNOWLEDGE_FILES, file).then(saved => {
      session.previews.delete(placeholder);
      if (session.discarded || !session.view.body.includes(`(attachment:${placeholder})`)) {
        if (url) URL.revokeObjectURL(url);
        return removeOutputFile(KNOWLEDGE_FILES, saved.id);
      }
      if (url) session.previews.set(saved.id, url);
      session.uploadedIds.set(placeholder, saved.id);
      finalized(placeholder, saved.id);
      editDraft(session, {
        body: session.view.body.split(`(attachment:${placeholder})`).join(`(attachment:${saved.id})`),
        incoming: [...session.view.incoming, { ...saved, inline: true }],
      });
    }).catch(() => {
      finalized(placeholder, '');
      session.previews.delete(placeholder);
      if (url) URL.revokeObjectURL(url);
      editDraft(session, { body: session.view.body.replace(pendingLink, (match, id: string) => id === placeholder ? '' : match) });
      publish(session, { error: '文件暂时未能保存，可重新插入。' });
    }).finally(() => {
      session.pending.delete(task);
      // The desktop preview authorizes reads against the saved note, including immediately after dropping a document.
      if (!url && !session.view.error) void flushDraft(session).catch(() => {});
    });
    session.pending.add(task);
  }
}

export function noteDraftFiles(id:string) {
  return [...new Set([...scratchEntries(id).flatMap(entry=>entry.draft.incoming.map(f=>f.id)),
    ...(sessions.get(id)?.view.incoming.map(f=>f.id)??[])])];
}

export function discardNoteDraft(id:string) {
  const session=sessions.get(id);
  if(session){
    session.discarded=true;
    session.onDiscard?.();
    session.onDiscard=undefined;
    window.clearTimeout(session.timer);
    for(const url of new Set(session.previews.values())) URL.revokeObjectURL(url);
    session.previews.clear();
    session.uploadedIds.clear();
    session.view=viewOf();
    sessions.delete(id);
  }
  for(const {key} of scratchEntries(id)) localStorage.removeItem(key);
  localStorage.removeItem('quandeck.note-dispatch.destination.v1.'+id);
}
