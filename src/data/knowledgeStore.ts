import { appendScheduleProgress } from './scheduleProgress';
import { resolveNoteTodoDue } from './noteTodoDue';
import { todoLineText, type NoteTodo } from './noteTodos';
import { desktopHost } from '../integration/desktop';
import { eraseKnowledgeNote, unreferencedNoteFiles } from './deleteKnowledgeNote';
import { removeOutputFile } from './outputFiles';
import { emptyKnowledge, KNOWLEDGE_FILES, KNOWLEDGE_STORAGE_KEY, parseKnowledge, type KnowledgeLibrary } from './knowledgeNotes';

const changed = 'quandeck:personal-knowledge';
let mutationTail: Promise<void> = Promise.resolve();

export async function readKnowledge() {
  const host = desktopHost();
  if (host?.readKnowledge) return parseKnowledge(await host.readKnowledge());
  if (!globalThis.localStorage) return emptyKnowledge();
  return parseKnowledge(localStorage.getItem(KNOWLEDGE_STORAGE_KEY));
}

/** Keep the chosen paragraph as dated evidence. Later note edits do not rewrite the quote. */
export async function fileNoteQuote(projectId: string, noteId: string, lineIndex: number, expectedText: string) {
  const id = crypto.randomUUID(), at = new Date().toISOString();
  await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId);
    const rawLine = note?.body.split('\n')[lineIndex];
    if (!note || !projectId || !expectedText.trim() || !Number.isSafeInteger(lineIndex) || lineIndex < 0 ||
        rawLine === undefined || todoLineText(rawLine) !== expectedText)
      throw new Error('这段原文刚有变化，请重新选择');
    const quotes = note.projectQuotes ??= [];
    if (!quotes.some(q => q.projectId === projectId && q.lineIndex === lineIndex && q.text === expectedText))
      quotes.push({ id, projectId, lineIndex, text: expectedText, markdown: rawLine === expectedText ? undefined : rawLine, at });
  });
}

export async function unfileNoteQuote(noteId: string, filingId: string) {
  await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId);
    if (note?.projectQuotes) note.projectQuotes = note.projectQuotes.filter(q => q.id !== filingId);
  });
}

export function onKnowledgeChange(handler: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KNOWLEDGE_STORAGE_KEY) handler(); };
  const offDesktop = desktopHost()?.onKnowledgeChange?.(handler);
  window.addEventListener(changed, handler);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, handler);
    window.removeEventListener('storage', storage);
    offDesktop?.();
  };
}

export function mutateKnowledge(mutate: (library: KnowledgeLibrary) => void): Promise<KnowledgeLibrary> {
  const persist = async () => {
    const host = desktopHost();
    if (host && (!host.readKnowledge || !host.compareKnowledge)) throw new Error('桌面版暂未提供笔记存储');
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = host?.readKnowledge ? await host.readKnowledge() : localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
      const library = parseKnowledge(before);
      mutate(library);
      const payload = JSON.stringify(library);
      if (host?.compareKnowledge) {
        if (!await host.compareKnowledge(before, payload)) continue;
      } else {
        localStorage.setItem(KNOWLEDGE_STORAGE_KEY, payload);
      }
      window.dispatchEvent(new Event(changed));
      return library;
    }
    throw new Error('笔记刚从另一个窗口更新，请重试');
  };
  const task = mutationTail.then(async () => {
    const locks = !desktopHost() && globalThis.navigator?.locks;
    return locks ? await locks.request(KNOWLEDGE_STORAGE_KEY, persist) : await persist();
  });
  mutationTail = task.then(() => {}, () => {});
  return task;
}

export async function addNoteTodo(noteId: string, lineIndex: number, expectedBody: string): Promise<NoteTodo> {
  const line = expectedBody.split('\n')[lineIndex];
  const text = line === undefined ? '' : todoLineText(line);
  if (!Number.isSafeInteger(lineIndex) || !text) throw new Error('请先在这行写下待办内容');
  const now = new Date();
  const dueAt = await desktopHost()?.resolveNoteTodoDue?.(text) ?? resolveNoteTodoDue(text, now);
  const candidate: NoteTodo = { id: crypto.randomUUID(), text, lineIndex, dueAt, createdAt: now.toISOString() };
  const library = await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId);
    if (!note || note.body !== expectedBody) throw new Error('笔记刚有改动，请在最新的一行添加待办');
    const todos = note.todos ??= [];
    if (!todos.some(todo => todo.lineIndex === lineIndex)) todos.push(candidate);
  });
  return library.notes.find(item => item.id === noteId)!.todos!.find(todo => todo.lineIndex === lineIndex)!;
}

export async function addNoteTodoProgress(noteId: string, todoId: string, id: string, text: string): Promise<void> {
  await mutateKnowledge(library => {
    const todo = library.notes.find(note => note.id === noteId)?.todos?.find(item => item.id === todoId);
    if (!todo) throw new Error('原笔记中的这条待办已移除');
    appendScheduleProgress(todo, id, text);
  });
}

export async function removeNoteTodo(noteId: string, todoId: string): Promise<void> {
  await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId);
    if (note?.todos) note.todos = note.todos.filter(todo => todo.id !== todoId);
  });
}

export async function setNoteTodoCompleted(noteId: string, todoId: string, completed: boolean): Promise<void> {
  const at = new Date().toISOString();
  await mutateKnowledge(library => {
    const todo = library.notes.find(item => item.id === noteId)?.todos?.find(item => item.id === todoId);
    if (!todo) throw new Error('原笔记中的这条待办已移除');
    if (completed) todo.completedAt ??= at;
    else delete todo.completedAt;
  });
}

export async function deleteKnowledgeNote(noteId:string,draftFiles:readonly string[]) {
  return mutateKnowledge(library=>eraseKnowledgeNote(library,noteId,draftFiles));
}

// Keep failed removals in the library so closing the app cannot lose pending file cleanup.
export async function purgeDeletedNoteFiles() {
  const library=await readKnowledge();
  const ids=unreferencedNoteFiles(library);
  const removed=new Set<string>();
  let failure:unknown;
  for(const id of ids) {
    try { await removeOutputFile(KNOWLEDGE_FILES,id);removed.add(id); }
    catch(error) { failure=error; }
  }
  if(removed.size) await mutateKnowledge(latest=>{
    const keep=(latest.orphanedNoteFiles??[]).filter(id=>!removed.has(id));
    if (keep.length) latest.orphanedNoteFiles=keep;
    else delete latest.orphanedNoteFiles;
  });
  if(failure) throw failure;
}
