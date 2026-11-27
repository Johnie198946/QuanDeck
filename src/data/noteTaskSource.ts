import { hashText } from './contentHash';
import type { KnowledgeNote, NoteSelection } from './knowledgeNotes';
import { todoLineText } from './noteTodos';
import type { Snapshot } from './types';

export interface NoteSourceRef { noteId: string; lineIndex: number; todoId?: string; selection?: NoteSelection }

export function noteTaskKey(noteId: string, lineIndex: number, text: string) {
  return 'note-' + hashText(JSON.stringify([noteId, lineIndex, text]));
}

/** Separate two equal phrases selected at different points in the same line. */
export function noteSelectionTaskKey(source: NoteSourceRef, text: string) {
  if (!source.selection) return noteTaskKey(source.noteId, source.lineIndex, text);
  const {before,after,offset} = source.selection;
  return 'note-' + hashText(JSON.stringify([source.noteId, source.lineIndex, text, before, after, offset]));
}

// 0.25.2 and earlier stored the quote and its fingerprint but no navigable note ID.
// Only link a historical input when the original note, line and quote verify together.
export function legacyNoteSources(projects: Snapshot[], notes: KnowledgeNote[]) {
  const found = new Map<string, NoteSourceRef>();
  const byQuote = new Map<string, Set<string>>();
  for (const project of projects) for (const task of Object.values(project.tasks)) for (const input of task.inputs ?? []) {
    if (input.noteSource || !/^note-[a-f0-9]{64}$/.test(input.id)) continue;
    const split = input.text.indexOf('\n');
    if (split < 0) continue;
    const quote = input.text.slice(split + 1);
    const keys = byQuote.get(quote) ?? new Set<string>();
    keys.add(input.id);
    byQuote.set(quote, keys);
  }
  if (!byQuote.size) return found;
  for (const note of notes) note.body.split('\n').forEach((line, lineIndex) => {
    const text = todoLineText(line);
    const keys = byQuote.get(text);
    if (!keys) return;
    const key = noteTaskKey(note.id, lineIndex, text);
    if (keys.has(key)) found.set(key, { noteId: note.id, lineIndex, todoId: note.todos?.find(todo => todo.lineIndex === lineIndex)?.id });
  });
  return found;
}
