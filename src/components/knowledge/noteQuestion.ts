import { actionEvidence, noteActionRequest, readNoteAction } from '../../data/noteActions';
import { methodBoards } from '../../data/methodBoards';
import { readTaskLabels } from '../../data/noteTaskLabel';
import { allowWorkspaceLookup, readWorkspaceLookup, queryWorkspace, workspaceEvidence, type WorkspaceSource } from '../../data/workspaceQuestion';
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

export function askNoteQuestion(session: DraftSession, selection: NoteSelection, quote: string, question: string, publicLinks?: string[], materials:QuestionMaterials = {}, parentAnswerId?:string, source?:WorkspaceSource) {
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
        const boards=methodBoards(library);
        const currentCards=new Set(boards.flatMap(({board})=>board.nodes.map(n=>n.noteId)));
        if (answer.memoryRefs) answer.memoryRefs=answer.memoryRefs.filter(r=>r.kind!=='idea' || !r.boardId || boards.some(b=>b.id===r.boardId && b.board.nodes.some(n=>n.noteId===r.nodeId)));
        const goneCards=new Set(answer.memoryRefs?.flatMap(ref=>ref.kind==='idea' && !currentCards.has(ref.nodeId) ? [ref.nodeId] : []));
        removeDeletedReferences(answer, deleted, goneCards);
        if (!note.expansions.some(item => item.id === answer.id)) note.expansions.push(answer);
      },session.noteId);
      active.delete(session);
      publish(session, { status: 'answered', answerId: answer.id, notice });
    } catch (error) {
      publish(session, { status: 'failed', answer, message: error instanceof Error ? error.message : '回答暂未保存', retry: () => void save(answer, notice) });
    }
  }
  async function send() {
    if (session.discarded || noteQuestionBusy(session)) return;
    let requestId: string = crypto.randomUUID();
    active.set(session,{id:requestId,selection,question});
    const since = Date.now();
    publish(session, { status: 'waiting', since });
    let unsubscribe: (() => void) | undefined;
    session.onDiscard=()=>{active.delete(session);questions.delete(session);unsubscribe?.();unsubscribe=undefined;};
    try {
      const last=parentAnswerId && saved?.expansions.find(e=>e.id===parentAnswerId);
      let workspace=source && queryWorkspace(source,question,quote);
      if(!workspace && last && last.workspace && source && /其中|这几|它们|刚才|上面|这些/.test(question))
        workspace=queryWorkspace(source,last.question,last.selection.quote);
      const canLookup=!!source && allowWorkspaceLookup(question,quote,!!(materials.background || materials.memoryRefs?.length || publicLinks?.length));
      const reads=workspace?[workspace]:[];
      const operations=source && noteActionRequest(source.library,session.noteId,selection,question);
      const targets=operations && actionEvidence(operations);
      const host = desktopHost();
      if (!host?.expandKnowledge) throw new Error('请在桌面版连接 Agent 后提问');
      unsubscribe = host.onNoteAnswerProgress?.(progress => {
        if (progress.requestId === requestId && progress.noteId === session.noteId) {
          publish(session, { status: 'waiting', since, stage: progress.stage, text: canLookup && /^\s*(?:\x60{3}|\{)/u.test(progress.text??'') ? undefined : progress.text });
        }
      });
      const request=(canRequest:boolean)=>{
        const evidence=workspaceEvidence(reads,canRequest && !targets);
        if(operations)evidence.noteIds=[...new Set([...evidence.noteIds,...operations.targets.map(target=>target.noteId)])];
        return host.expandKnowledge!({ ...input, requestId,
        ...((targets || canLookup || reads.length>0) && {workspaceEvidence:{...evidence,...(targets && {noteActions:targets})}}) });
      };
      let result=await request(canLookup);
      if(session.discarded) return;
      const lookup=!operations && canLookup && readWorkspaceLookup(result.answer);
      if(lookup && source){
        for(const spec of lookup){
          const pass=queryWorkspace(source,question,quote,Date.now(),spec);
          if(pass) reads.push(pass);
        }
        requestId=crypto.randomUUID();
        result=await request(false);
        if(readWorkspaceLookup(result.answer)) throw Error('Agent 尚未给出查询结论，请重新提问');
      }
      if(session.discarded) return;
      let answerText=result.answer;
      const actionPlan=readNoteAction(answerText,operations);
      if(actionPlan)answerText='已拟好 '+actionPlan.changes.length+' 项修改，请核对对象与内容后应用。';
      else if(operations)answerText=answerText+'\n\n客户端没有收到可执行的修改，本次未更改笔记。';
      if (!operations && reads.length===1 && reads[0].area==='notes' && reads[0].summary.includes('没画删除线')) {
        const brief = readTaskLabels(answerText);
        if (brief) {
          answerText=brief.answer;
          // The model suggests only display text. The stored count, row order and links come from QuanDeck.
          for(const {item,title} of brief.labels){
            const row=reads[0].rows[item-1];
            if (row) row.label=title;
          }
        } else if (/^\s*(?:`{3}(?:json)?\s*)?\{/u.test(answerText)) answerText=reads[0].summary+'。';
      }
      void save({ id: crypto.randomUUID(), ...materials, ...(actionPlan && {actionPlan}), ...(result.agentConnectionId && {agentConnectionId:result.agentConnectionId}), ...(parentAnswerId && {parentAnswerId}), questionRequestId:requestId, conversationMode:result.conversationMode, at: new Date().toISOString(), selection, question,
        ...(reads[0] && {workspace:reads[0]}), ...(reads.length>1 && { additionalReads:reads.slice(1) }), answer: answerText, sourceIds: result.sourceIds, ...(result.unreadSources?.length && {unreadSources:result.unreadSources}), ...(result.sources?.length && { sources: result.sources }) }, result.note);
    } catch (error) {
      publish(session, { status: 'failed', message: error instanceof Error ? error.message : '提问未完成', retry: () => void send() });
    } finally { unsubscribe?.(); }
  }
  void send();
}
