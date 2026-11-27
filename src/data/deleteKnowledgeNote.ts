import { methodBoards, methodFileIds } from './methodBoards';
import type { AgentKnowledgeGraph, KnowledgeLibrary, NoteExpansion } from './knowledgeNotes';

type StoredReasoning = {
  version: number;
  atoms?: { id:string; noteId:string }[];
  findings?: { key:string; evidence:string[] }[];
  history?: { finding:{key:string}; anchors:{noteId:string}[] }[];
  chunks?: {entries:{id:string}[]}[];
  reviewed?: string[];
  attachmentCoverage?: {noteId:string;fileId:string;name:string;status:string;method?:string}[];
};

function detachGraph(graph:AgentKnowledgeGraph, id:string, removed:Set<string>) {
  graph.notes=graph.notes.filter(note=>note.id!==id);
  graph.edges=graph.edges.filter(edge=>{
    const keep=edge.from!==id && edge.to!==id && !edge.anchors?.some(a=>a.noteId===id) && !edge.sourceEvidence?.some(a=>a.noteId===id);
    if (!keep && edge.evidenceKey) removed.add(edge.evidenceKey);
    return keep;
  });
  delete graph.fingerprint;
  const reasoning: StoredReasoning | undefined = graph.reasoning;
  if (!reasoning) return;
  if (reasoning.attachmentCoverage) reasoning.attachmentCoverage=reasoning.attachmentCoverage.filter(file=>file.noteId!==id);
  const atoms=new Set(reasoning.atoms?.filter(a=>a.noteId===id).map(a=>a.id));
  reasoning.atoms=reasoning.atoms?.filter(a=>!atoms.has(a.id));
  reasoning.chunks=reasoning.chunks?.filter(c=>c.entries.length && c.entries.every(entry=>!atoms.has(entry.id)));
  reasoning.findings=reasoning.findings?.filter(f=>{
    if(!f.evidence.some(a=>atoms.has(a))) return true;
    removed.add(f.key);return false;
  });
  reasoning.history=reasoning.history?.filter(h=>{
    if (!h.anchors.some(a=>a.noteId===id)) return true;
    removed.add(h.finding.key);return false;
  });
  reasoning.reviewed=[];
}

export function outcomeFileIds(note:{todos?: {outcome?:{files?:{id:string}[]}}[]}) {
  return note.todos?.flatMap(todo => todo.outcome?.files?.map(file => file.id) ?? []) ?? [];
}

export function usedKnowledgeFiles(library:KnowledgeLibrary) {
  const files=new Set(library.notes.flatMap(note=>[...note.attachments.map(file=>file.id), ...outcomeFileIds(note)]));
  for(const id of methodFileIds(library)) files.add(id);
  return files;
}

// Preserve the answer as a dated record, but retire links whose source was removed.
export function pruneMethodLinks(library:KnowledgeLibrary) {
  const boards=methodBoards(library).map(({id,board})=>({id,
    nodes:new Set(board.nodes.map(n=>n.noteId)), links:new Set(board.links.map(e=>e.id))}));
  const templates=new Set(library.methodTemplates?.map(template=>template.id));
  const hasCard=(id:string,boardId?:string)=>boards.some(b=>(!boardId || b.id===boardId) && b.nodes.has(id));
  for(const note of library.notes) for(const answer of note.expansions) {
    if(answer.memoryRefs) answer.memoryRefs=answer.memoryRefs.filter(ref=>ref.kind!=='idea' || hasCard(ref.nodeId,ref.boardId));
    if (answer.sourceIds) answer.sourceIds=answer.sourceIds.filter(id=>!id.startsWith('idea:') || hasCard(id.slice(5)));
    for(const read of [...(answer.workspace?[answer.workspace]:[]),...(answer.additionalReads??[])]) {
      read.rows=read.rows.filter(({target})=>{
        if(target.page!=='ideas') return true;
        if(target.templateId) return templates.has(target.templateId);
        if(!target.canvas) return true;
        return boards.some(b=>(!target.boardId || target.boardId===b.id) && (target.canvas==='note'?b.nodes:b.links).has(target.id));
      });
    }
  }
}

// Keep authored answers intact while retiring links and stored idea snapshots for removed sources.
export function removeDeletedReferences(answer:NoteExpansion, notes:Set<string>, cards:Set<string>, files?:Set<string>) {
  if(answer.actionPlan?.changes.some(c=>notes.has(c.noteId)))delete answer.actionPlan;
  for(const read of [...(answer.workspace?[answer.workspace]:[]),...(answer.additionalReads??[])]) {
    if(read.noteList && read.noteList.items.some(item=>notes.has(item.noteId))){
      const items=read.noteList.items.filter(item=>!notes.has(item.noteId));
      const counts={open:0,partial:0,struck:0};
      for(const item of items)counts[item.status]++;
      read.noteList={items,counts};
      read.total=counts.open+counts.partial;
      read.summary=read.total+' 条任务还没画删除线';
      read.rule='按仍可查看的原文重新统计，部分划去的条目单列。';
    }
    read.rows=read.rows.filter(row=>
    !row.sourceNoteIds?.some(id=>notes.has(id)) &&
    !(row.target.page==='notes' && notes.has(row.target.id)) &&
    !(row.target.page==='ideas' && (notes.has(row.target.id) || cards.has(row.target.id))));
  }
  if (answer.memoryRefs) answer.memoryRefs=answer.memoryRefs.filter(ref=>
    ref.kind==='passage' ? !notes.has(ref.noteId) : !cards.has(ref.nodeId));
  if (answer.sourceIds) answer.sourceIds=answer.sourceIds.filter(source=>{
    if (source.startsWith('idea:')) return !cards.has(source.slice(5));
    if (source.startsWith('attachment:')) return !files?.has(source.slice(11));
    return !notes.has(source) && !notes.has(source.replace(/@\d+(?:#\d+-\d+)?$/u,''));
  });
}

/** ID-only tombstones prevent an older window from re-creating a discarded draft. */
export function eraseKnowledgeNote(library:KnowledgeLibrary,id:string,draftFiles:readonly string[]=[]) {
  const note=library.notes.find(n=>n.id===id);
  const orphanedCandidates=new Set([...draftFiles,...(note?.attachments.map(f=>f.id)??[]), ...(note ? outcomeFileIds(note) : [])]);
  if(!library.deletedNoteIds?.includes(id)) (library.deletedNoteIds??=[]).push(id);
  library.notes=library.notes.filter(n=>n.id!==id);
  const cards=new Set<string>();
  for(const {board} of [...methodBoards(library), ...(library.methodTemplates??[])]) {
    const removedHere=new Set(board.nodes.filter(n=>n.noteId===id || n.idea?.source?.noteId===id || n.idea?.method?.sourceNote?.id===id).map(n=>n.noteId));
    removedHere.forEach(key=>cards.add(key));
    board.nodes=board.nodes.filter(n=>{
      if(!removedHere.has(n.noteId)) return true;
      const ref=n.idea?.reference;
      if(ref && 'file' in ref) orphanedCandidates.add(ref.file.id);
      return false;
    });
    board.links=board.links.filter(edge=>!removedHere.has(edge.from)&&!removedHere.has(edge.to));
  }
  const retainedFiles=usedKnowledgeFiles(library);
  const goneFiles=new Set([...orphanedCandidates].filter(file=>!retainedFiles.has(file)));
  const goneNotes=new Set([id]);
  for (const kept of library.notes) for (const answer of kept.expansions) {
    removeDeletedReferences(answer, goneNotes, cards, goneFiles);
  }
  for (const kept of library.notes) for (const todo of kept.todos ?? []) {
    if (todo.outcome?.usedBy) todo.outcome.usedBy=todo.outcome.usedBy.filter(target=>!('noteId' in target) || target.noteId!==id);
  }
  const removed=new Set<string>();
  if(library.agentGraph) detachGraph(library.agentGraph,id,removed);
  library.decisions=library.decisions.filter(d=>{
    if(removed.has(d.evidence)) return false;
    if(!d.evidence.startsWith('[')) return true;
    try {
      const key=JSON.parse(d.evidence);
      if(!Array.isArray(key)) return true;
      if(key[0]==='agent') return !key[1]?.some((pair:unknown)=>Array.isArray(pair)&&pair[0]===id);
      return !Array.isArray(key[0]) || !key[0].some((v:unknown)=>typeof v==='string'&&(v==='note:'+id||v.startsWith('note:'+id+':file:')));
    } catch { return true; }
  });
  pruneMethodLinks(library);
  const retained=usedKnowledgeFiles(library);
  const pending=[...new Set([...(library.orphanedNoteFiles??[]),...orphanedCandidates])].filter(file=>!retained.has(file));
  if(pending.length) library.orphanedNoteFiles=pending;
  else delete library.orphanedNoteFiles;
}

export function unreferencedNoteFiles(library:KnowledgeLibrary) {
  const retained=usedKnowledgeFiles(library);
  return (library.orphanedNoteFiles??[]).filter(id=>!retained.has(id));
}
