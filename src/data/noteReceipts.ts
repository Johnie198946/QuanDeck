import { deliveryPresentation, deliverySlotEntry } from './deliveryPresentation';
import { legacyNoteSources, type NoteSourceRef } from './noteTaskSource';
import { locateSelection, makeSelection, type KnowledgeNote, type NoteSelection } from './knowledgeNotes';
import { todoLineText } from './noteTodos';
import { selectProductAttention } from './productAttention';
import type { PresentedResult } from './resultPresentation';
import type { Snapshot } from './types';

export interface NoteReceipt {
  id: string; kind: '成果' | '提醒' | '分工'; title: string; text: string; at: string;
  projectId: string; projectName: string; taskId: string; itemId?: string; resultId?: string; attentionId?: string;
}
export interface ReceiptAnchor {
  key: string; noteId: string; lineIndex: number; quote: string; selection?: NoteSelection; receipts: NoteReceipt[];
}

export function receiptSelection(anchor: ReceiptAnchor, body: string): NoteSelection | undefined {
  if (anchor.selection) return locateSelection(body, anchor.selection) === undefined ? undefined : anchor.selection;
  // Older row-only transfers do not carry before/after context. Reconnect only a unique exact line.
  const lines = body.split('\n');
  const match = lines.flatMap((raw, i) => todoLineText(raw) === anchor.quote ? [i] : []);
  if (match.length !== 1) return;
  const index = match[0], offset = lines.slice(0,index).reduce((n,line) => n + line.length + 1, 0);
  return makeSelection(body, offset, offset + lines[index].length);
}

/** Notes keep anchors and read acknowledgements. The project owns the authoritative result. */
export function projectNoteReceipts(projects: Snapshot[], notes: KnowledgeNote[], now = Date.now()) {
  const known = new Set(notes.map(note => note.id));
  const byNote = new Map<string, ReceiptAnchor[]>();
  const legacy = legacyNoteSources(projects, notes);
  for (const snapshot of projects) {
    const projectId = snapshot.project.id, projectName = snapshot.project.name;
    if (!projectId || snapshot.project.deletedAt) continue;
    const sources = new Map<string, ReceiptAnchor[]>();
    const byAnchor = new Map<string, ReceiptAnchor>();
    for (const task of Object.values(snapshot.tasks)) {
      for (const input of task.inputs ?? []) {
        const ref: NoteSourceRef | undefined = input.noteSource ?? legacy.get(input.id);
        if (!ref || !known.has(ref.noteId)) continue;
        const quote = ref.selection?.quote || input.text.replace(/^来自笔记《[^\n]*》\n/,'');
        const key = JSON.stringify([projectId, ref.noteId, ref.selection ?? ref.lineIndex, quote]);
        let anchor = byAnchor.get(key);
        if (!anchor) {
          anchor = { key, noteId:ref.noteId, lineIndex:ref.lineIndex, selection:ref.selection, quote, receipts:[] };
          byAnchor.set(key, anchor);
        }
        const list = sources.get(task.id) ?? [];
        if (!list.includes(anchor)) list.push(anchor);
        sources.set(task.id,list);
      }
    }
    if (!sources.size) continue;
    const add = (target: ReceiptAnchor[], receipt: NoteReceipt) => {
      for (const anchor of target) if (!anchor.receipts.some(r=>r.id===receipt.id)) anchor.receipts.push(receipt);
    };
    const append = (taskId:string, entry:PresentedResult, resultId:string) => {
      const target=sources.get(taskId);
      if (!target) return;
      const { record }=entry;
      add(target,{ id:JSON.stringify([projectId,taskId,'result',record.id,record.at]), kind:'成果',
        title:record.title, text:record.text, at:record.at, projectId, projectName, taskId, itemId:record.itemId, resultId });
    };
    const deliveries=deliveryPresentation(snapshot,{},true);
    const slotted=new Set<string>();
    for (const slot of deliveries.contributions) {
      if (!sources.has(slot.taskId)) continue;
      const result=deliverySlotEntry(snapshot,slot);
      if (!result) continue;
      append(slot.taskId,result,slot.id);
      if(result.record.outputId) slotted.add(result.record.outputId);
    }
    for (const {taskId, entry} of deliveries.history) {
      if (!entry.record.outputId || !slotted.has(entry.record.outputId)) append(taskId,entry,entry.record.id);
    }
    for (const alert of selectProductAttention([snapshot], now)) {
      if (!alert.taskId || alert.kind === 'review' || !sources.has(alert.taskId)) continue;
      add(sources.get(alert.taskId)!,{ id:JSON.stringify([projectId,'alert',alert.id]), kind:'提醒',
        title:alert.label+' · '+alert.title, text:alert.entry?.detail || alert.detail, at:alert.entry?.sessionId ? snapshot.sessions[alert.entry.sessionId]?.lastActivity ?? '' : '',
        projectId,projectName,taskId:alert.taskId,itemId:alert.itemId,attentionId:alert.id });
    }
    for (const change of snapshot.noteWorkChanges ?? []) {
      const taskIds = [change.taskId,...change.relatedTaskIds];
      const targets = taskIds.flatMap(id=>sources.get(id) ?? []).filter(anchor=>change.noteIds.includes(anchor.noteId));
      add(targets,{id:JSON.stringify([projectId,'change',change.id]),kind:'分工',title:change.title,text:change.detail,
        at:change.at, projectId,projectName,taskId:change.taskId});
    }
    for (const anchor of byAnchor.values()) {
      if (!anchor.receipts.length) continue;
      anchor.receipts.sort((a,b)=>b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
      const list=byNote.get(anchor.noteId) ?? [];
      list.push(anchor);byNote.set(anchor.noteId,list);
    }
  }
  return byNote;
}

export function unreadReceiptCount(anchors: ReceiptAnchor[] | undefined, read: readonly string[] = []) {
  const seen=new Set(read), ids=new Set<string>();
  for (const anchor of anchors ?? []) for (const r of anchor.receipts) if (!seen.has(r.id)) ids.add(r.id);
  return ids.size;
}
