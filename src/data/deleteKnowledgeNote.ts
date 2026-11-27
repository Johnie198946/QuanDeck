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

function usedFiles(library:KnowledgeLibrary) {
  const files=new Set(library.notes.flatMap(note=>note.attachments.map(file=>file.id)));
  for(const node of library.inspirationCanvas?.nodes ?? []) {
    const ref=node.idea?.reference;
    if (ref && 'file' in ref) files.add(ref.file.id);
  }
  return files;
}

// Keep authored answers intact while retiring links and stored idea snapshots for removed sources.
export function removeDeletedReferences(answer:NoteExpansion, notes:Set<string>, cards:Set<string>) {
  if (answer.memoryRefs) answer.memoryRefs=answer.memoryRefs.filter(ref=>
    ref.kind==='passage' ? !notes.has(ref.noteId) : !cards.has(ref.nodeId));
  if (answer.sourceIds) answer.sourceIds=answer.sourceIds.filter(source=>{
    if (source.startsWith('idea:')) return !cards.has(source.slice(5));
    return !notes.has(source) && !notes.has(source.replace(/@\d+(?:#\d+-\d+)?$/u,''));
  });
}

/** ID-only tombstones prevent an older window from re-creating a discarded draft. */
export function eraseKnowledgeNote(library:KnowledgeLibrary,id:string,draftFiles:readonly string[]=[]) {
  const note=library.notes.find(n=>n.id===id);
  const orphanedCandidates=new Set([...draftFiles,...(note?.attachments.map(f=>f.id)??[])]);
  if(!library.deletedNoteIds?.includes(id)) (library.deletedNoteIds??=[]).push(id);
  library.notes=library.notes.filter(n=>n.id!==id);
  const board=library.inspirationCanvas;
  const cards=new Set(board?.nodes.filter(n=>n.noteId===id || n.idea?.source?.noteId===id).map(n=>n.noteId));
  if(board) {
    board.nodes=board.nodes.filter(n=>{
      if(!cards.has(n.noteId)) return true;
      const ref=n.idea?.reference;
      if(ref && 'file' in ref) orphanedCandidates.add(ref.file.id);
      return false;
    });
    board.links=board.links.filter(edge=>!cards.has(edge.from)&&!cards.has(edge.to));
  }
  const goneNotes=new Set([id]);
  for (const kept of library.notes) for (const answer of kept.expansions) {
    removeDeletedReferences(answer, goneNotes, cards);
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
  const retained=usedFiles(library);
  const pending=[...new Set([...(library.orphanedNoteFiles??[]),...orphanedCandidates])].filter(file=>!retained.has(file));
  if(pending.length) library.orphanedNoteFiles=pending;
  else delete library.orphanedNoteFiles;
}

export function unreferencedNoteFiles(library:KnowledgeLibrary) {
  const retained=usedFiles(library);
  return (library.orphanedNoteFiles??[]).filter(id=>!retained.has(id));
}
