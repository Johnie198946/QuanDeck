import { outcomeDraftKeysForNote, readOutcomeDraft } from './scheduleOutcomeDraft';
import type { OutputAttachment } from './types';
import { validateTaskAttachments } from './taskAttachments';
import { checkProgressMove, type ProgressMove, type ClosingProgress, appendScheduleProgress, relatedScheduleIds, checkExistingFollowup, checkFollowupTarget, checkFollowupRequest, type FollowupRequest } from './scheduleProgress';
import { resolveNoteTodoDue } from './noteTodoDue';
import { outcomeUrl, todoLineText, type NoteTodo } from './noteTodos';
import { desktopHost } from '../integration/desktop';
import { eraseKnowledgeNote, unreferencedNoteFiles, outcomeFileIds } from './deleteKnowledgeNote';
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
      const previousReceipts=library.notes.flatMap(outcomeFileIds);
      mutate(library);
      if (previousReceipts.length) {
        const retained=new Set(library.notes.flatMap(outcomeFileIds));
        const removed=previousReceipts.filter(id=>!retained.has(id));
        if (removed.length) library.orphanedNoteFiles=[...new Set([...(library.orphanedNoteFiles ?? []),...removed])];
      }
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

export async function addNoteTodoProgress(noteId: string, todoId: string, id: string, text: string, legacy = false, move?: ProgressMove): Promise<void> {
  await mutateKnowledge(library => {
    const todo = library.notes.find(note => note.id === noteId)?.todos?.find(item => item.id === todoId);
    if (!todo) throw new Error('原笔记中的这条待办已移除');
    const target = legacy ? todo.followup : todo;
    if (!target) throw Error('这条跟进不存在');
    const previous = target.progress?.find(p => p.id === id);
    const record = appendScheduleProgress(target, id, text);
    if (move && (!previous || (move.fromSaved && !record.scheduledFor && !record.keptTime))) {
      if (legacy ? todo.followup?.receivedAt : todo.completedAt) throw Error('这条日程已完成');
      if (move.fromSaved && target.progress?.at(-1)?.id !== id) throw Error('已有更新的进展，请核对后改期');
      checkProgressMove(move, Date.parse(target.dueAt));
      target.dueAt = record.scheduledFor = move.dueAt;
    } else if (!move && !previous) record.keptTime = true;
  });
}

export async function followNoteProgress(noteId: string, todoId: string, request: FollowupRequest, legacy = false) {
  checkFollowupRequest(request);
  const childId = crypto.randomUUID(), createdAt = new Date().toISOString();
  const library = await mutateKnowledge(library => {
    const todos = library.notes.find(note => note.id === noteId)?.todos;
    const todo = todos?.find(item => item.id === todoId);
    const target = legacy ? todo?.followup : todo;
    if (!todos || !target || !todo) throw Error('日程已移除');
    appendScheduleProgress(target, request.id, request.text);
    const existing = todos.find(t => t.follows?.parentId === todoId && t.follows.progressId === request.id && !!t.follows.legacy === legacy);
    if (existing && !request.existing) return;
    checkFollowupTarget(request, Date.parse(target.dueAt), !!(legacy ? todo.followup?.receivedAt : todo.completedAt));
    if (request.existing) {
      if (!existing) throw Error('这条跟进已移除');
      checkExistingFollowup(request, existing.id, Date.parse(existing.dueAt), !!existing.completedAt);
      existing.dueAt = request.dueAt;
    } else {
      const follows = {parentId: todoId, progressId: request.id, ...(legacy && {legacy: true as const})};
      todos.push({id: childId, lineIndex: todo.lineIndex, text: request.title, dueAt: request.dueAt, createdAt, follows});
    }
    target.dueAt = new Date(Date.parse(request.dueAt) + 3600000).toISOString();
  });
  const child = library.notes.find(n => n.id === noteId)!.todos!.find(t =>
    t.follows?.parentId === todoId && t.follows.progressId === request.id && !!t.follows.legacy === legacy)!;
  return child.id;
}

export async function removeNoteTodo(noteId: string, todoId: string): Promise<void> {
  let draftKeys: string[] = [];
  await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId);
    if (!note?.todos) return;
    const remove = relatedScheduleIds(note.todos, [todoId]);
    draftKeys = outcomeDraftKeysForNote(noteId,remove);
    const files = draftKeys.flatMap(k=>readOutcomeDraft(k)?.files.map(f=>f.id) ?? []);
    if (files.length) library.orphanedNoteFiles = [...new Set([...(library.orphanedNoteFiles ?? []),...files])];
    note.todos = note.todos.filter(todo => !remove.has(todo.id));
  });
  draftKeys.forEach(key=>localStorage.removeItem(key));
}

type TodoOutcomeEdit = { progress?: ClosingProgress; appendFiles?: OutputAttachment[]; expectedAt?: string | null; text: string; url: string; projectId?: string; purpose?: string; dueAt?: string; received?: boolean; finish?: boolean };

export async function saveNoteTodoOutcome(noteId: string, todoId: string, edit: TodoOutcomeEdit) {
  const at = new Date().toISOString();
  const text = edit.text.trim(), url = edit.url.trim() ? outcomeUrl(edit.url.trim()) : undefined;
  if (text.length > 2000 || edit.url.length > 2048 || (edit.url.trim() && !url)) throw Error('请检查结果和网页链接');
  if ((edit.projectId?.length ?? 0) > 256 || (edit.purpose?.length ?? 0) > 240) throw Error('项目或用途太长');
  if (edit.dueAt !== undefined && !Number.isFinite(Date.parse(edit.dueAt))) throw Error('请选择下次跟进时间');
  if (edit.received && !text && !url && !edit.appendFiles?.length) throw Error('请补一句收到的内容，或贴上材料链接');
  await mutateKnowledge(library => {
    const todo = library.notes.find(note => note.id === noteId)?.todos?.find(item => item.id === todoId);
    if (!todo) throw Error('原笔记中的这条待办已移除');
    if (edit.received && !todo.followup) throw Error('这条待办没有待跟进的材料');
    if (edit.expectedAt !== undefined && (todo.outcome?.at ?? null) !== edit.expectedAt)
      throw Error('这份结果刚有更新，请重新打开');
    const files = validateTaskAttachments([...(todo.outcome?.files ?? []), ...(edit.appendFiles ?? [])]);
    if ((!edit.dueAt || url) && (text || url || files.length)) {
      const projectId = (edit.projectId ?? todo.outcome?.projectId)?.trim();
      const purpose = (edit.purpose ?? todo.outcome?.purpose)?.trim();
      if (todo.outcome?.usedBy?.some(target => 'projectId' in target && target.projectId !== projectId))
        throw Error('请先从原项目任务中取消引用，再调整归属');
      todo.outcome = { at, ...(files.length && {files}), ...(todo.outcome?.usedBy && {usedBy:todo.outcome.usedBy}), text: edit.dueAt ? (todo.outcome?.text ?? '') : text,
        ...(url && {url}), ...(projectId && {projectId}), ...(purpose && {purpose}) };
    }
    if (edit.progress) appendScheduleProgress(edit.received ? todo.followup! : todo, edit.progress.id, edit.progress.text);
    if (edit.finish || edit.dueAt || todo.outcome) todo.completedAt ??= at;
    if (edit.dueAt) todo.followup = {dueAt:edit.dueAt, ...(text && {note:text})};
    if (edit.received) todo.followup!.receivedAt ??= at;
  });
}

export async function assignTodoMaterial(noteId: string, todoId: string, expectedAt: string, projectId: string): Promise<void> {
  if (!projectId.trim() || projectId.length > 256) throw Error('请选择项目');
  await mutateKnowledge(library => {
    const note = library.notes.find(item => item.id === noteId && !item.archivedAt);
    const todo = note?.todos?.find(item => item.id === todoId);
    if (!todo?.completedAt || !todo.outcome || todo.outcome.at !== expectedAt ||
        (todo.followup && !todo.followup.receivedAt)) throw Error('这份材料刚有变化，请刷新后再试');
    if (todo.outcome.projectId && todo.outcome.projectId !== projectId) throw Error('这份材料已归入其他项目');
    todo.outcome.projectId = projectId;
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
  const draftKeys = outcomeDraftKeysForNote(noteId);
  const resultFiles = draftKeys.flatMap(k=>readOutcomeDraft(k)?.files.map(f=>f.id) ?? []);
  const library = await mutateKnowledge(library=>eraseKnowledgeNote(library,noteId,[...draftFiles,...resultFiles]));
  draftKeys.forEach(key=>localStorage.removeItem(key));
  return library;
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
