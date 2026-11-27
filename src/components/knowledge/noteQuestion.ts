import type { NoteExpansion, NoteSelection, QuestionMaterials } from '../../data/knowledgeNotes';
import { removeDeletedReferences } from '../../data/deleteKnowledgeNote';
import { mutateKnowledge } from '../../data/knowledgeStore';
import { desktopHost } from '../../integration/desktop';
import { flushDraft, type DraftSession } from './noteDraft';

type QuestionState =
  | { status: 'waiting'; since: number; stage?: 'accepted' | 'responding' | 'reconnecting'; text?: string }
  | { status: 'saving'; answer: NoteExpansion }
  | { status: 'failed'; message: string; answer?: NoteExpansion; retry: () => void }
  | { status: 'answered'; answerId: string; notice?: string };

// A note can be closed and reopened while its Agent is answering.
const active = new WeakMap<DraftSession, {id:string; selection:NoteSelection; question:string}>();
export const activeNoteQuestion = (session:DraftSession) => active.get(session);
const questions = new WeakMap<DraftSession, QuestionState>();
export const noteQuestionState = (session: DraftSession) => questions.get(session);
export function noteQuestionBusy(session: DraftSession) {
  const state = questions.get(session);
  return state?.status === 'waiting' || state?.status === 'saving' || (state?.status === 'failed' && !!state.answer);
}
export function pendingNoteAnswer(session: DraftSession) {
  const state = questions.get(session);
  return state?.status === 'saving' || state?.status === 'failed' ? state.answer : undefined;
}
function publish(session: DraftSession, state: QuestionState) {
  if(session.discarded) return;
  questions.set(session, state);
  session.listeners.forEach(listener => listener());
}

export function askNoteQuestion(session: DraftSession, selection: NoteSelection, quote: string, question: string, publicLinks?: string[], materials:QuestionMaterials = {}, parentAnswerId?:string) {
  if (session.discarded || noteQuestionBusy(session)) return;
  const { body, saved } = session.view;
  const input = {
    noteId: session.noteId, question, ...materials, ...(parentAnswerId && {parentAnswerId}), selection: { quote, offset: selection.offset },
    ...(saved?.body === body && { revision: saved.revision }),
    ...(publicLinks?.length && { usePublicSources: true, publicLinks }),
  };
  async function save(answer: NoteExpansion, notice?: string) {
    if (session.discarded || questions.get(session)?.status === 'saving') return;
    publish(session, { status: 'saving', answer });
    try {
      // New notes need a local record only to store the reply. Dispatch and display happen first.
      if (!session.view.saved) await flushDraft(session);
      await mutateKnowledge(library => {
        const note = library.notes.find(item => item.id === session.noteId);
        if (!note) throw new Error('原笔记已移除');
        const deleted=new Set(library.deletedNoteIds);
        const currentCards=new Set(library.inspirationCanvas?.nodes.map(n=>n.noteId));
        const goneCards=new Set(answer.memoryRefs?.flatMap(ref=>ref.kind==='idea' && !currentCards.has(ref.nodeId) ? [ref.nodeId] : []));
        removeDeletedReferences(answer, deleted, goneCards);
        if (!note.expansions.some(item => item.id === answer.id)) note.expansions.push(answer);
      });
      active.delete(session);
      publish(session, { status: 'answered', answerId: answer.id, notice });
    } catch (error) {
      publish(session, { status: 'failed', answer, message: error instanceof Error ? error.message : '回答暂未保存', retry: () => void save(answer, notice) });
    }
  }
  async function send() {
    if (session.discarded || noteQuestionBusy(session)) return;
    const requestId = crypto.randomUUID();
    active.set(session,{id:requestId,selection,question});
    const since = Date.now();
    publish(session, { status: 'waiting', since });
    let unsubscribe: (() => void) | undefined;
    session.onDiscard=()=>{active.delete(session);questions.delete(session);unsubscribe?.();unsubscribe=undefined;};
    try {
      const host = desktopHost();
      if (!host?.expandKnowledge) throw new Error('请在桌面版连接 Agent 后提问');
      unsubscribe = host.onNoteAnswerProgress?.(progress => {
        if (progress.requestId === requestId && progress.noteId === session.noteId) {
          publish(session, { status: 'waiting', since, stage: progress.stage, text: progress.text });
        }
      });
      const result = await host.expandKnowledge({ ...input, requestId });
      if(session.discarded) return;
      void save({ id: crypto.randomUUID(), ...materials, ...(parentAnswerId && {parentAnswerId}), questionRequestId:requestId, conversationMode:result.conversationMode, at: new Date().toISOString(), selection, question,
        answer: result.answer, sourceIds: result.sourceIds, ...(result.sources?.length && { sources: result.sources }) }, result.note);
    } catch (error) {
      publish(session, { status: 'failed', message: error instanceof Error ? error.message : '提问未完成', retry: () => void send() });
    } finally { unsubscribe?.(); }
  }
  void send();
}
