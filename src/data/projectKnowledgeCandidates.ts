import { methodBoards } from './methodBoards';
import { buildKnowledgeIndex, buildNoteGraph, knowledgeKindLabels } from './knowledgeIndex';
import { segmentKnowledgeWords } from './knowledgeWords';
import type { KnowledgeLibrary } from './knowledgeNotes';
import type { ProjectKnowledgeCandidate } from './projectAnalysis';
import type { Snapshot } from './types';

const generic = new Set('项目 目标 背景 需求 需要 希望 准备 创建 根据 进行 达到 内容 相关 资料 附件 问题 优化 完成 任务 使用 可以 提供 材料 设计 工作 演示 本次 要求 参考 文档 确认 一个 我们 这个 目前 方案 以下 了解'.split(' '));

function queryTerms(query: string) {
  const found = new Set<string>();
  // Give each input (including each extracted attachment) a chance to supply terms.
  for (const line of query.split('\n')) {
    const terms = segmentKnowledgeWords(line).filter(word => word.length > 1 && /\p{L}/u.test(word) && !generic.has(word));
    terms.slice(0,60).forEach(word => found.add(word));
  }
  return [...found].slice(0,400);
}

// Return a shortlist to the model. Only its grounded selections are shown in the project form.
export function projectKnowledgeCandidates(library: KnowledgeLibrary, projects: readonly Snapshot[], query: string): ProjectKnowledgeCandidate[] {
  const terms = queryTerms(query);
  if (!query.trim()) return [];
  const activeNotes = library.notes.filter(note => !note.archivedAt);
  const rows = buildKnowledgeIndex({...library,notes:activeNotes}, projects)
    .filter(source => ['note','memory','decision','plan','artifact'].includes(source.kind))
    .map(source => ({
      id:source.id, title:source.title, kind:[source.projectName, knowledgeKindLabels[source.kind]].filter(Boolean).join(' · '),
      body:source.text, group:String(source.kind), noteId:source.noteId, at:source.at ?? '',
    }));
  const activeById = new Map(activeNotes.map(note => [note.id,note]));
  for (const {id:boardId, board} of methodBoards(library)) for (const node of board.nodes) {
    const idea = node.idea;
    const sourceId=idea?.source?.noteId ?? idea?.method?.sourceNote?.id;
    if (idea && (!sourceId || activeById.has(sourceId))) {
      rows.push({id:boardId==='default'?'idea:'+node.noteId:'idea:'+boardId+':'+node.noteId, title:idea.title, kind:'帮你想 · 灵感', body:idea.detail || idea.title,
        group:'idea',noteId:sourceId,at:sourceId && activeById.get(sourceId)?.updatedAt || ''});
    }
  }
  const ranked = rows.flatMap(source => {
    const title = source.title.toLocaleLowerCase();
    const raw = source.body.trim();
    if (!raw || !source.title.trim() || source.id.length > 300) return [];
    const body = raw.toLocaleLowerCase();
    const hits = terms.map(term => ({term, offset:body.indexOf(term), title:title.includes(term)})).filter(hit => hit.offset >= 0 || hit.title);
    const strength = (term:string) => Math.min(5,term.length);
    const score = hits.reduce((total,hit) => total + strength(hit.term)*(hit.title ? 3 : 1),0);
    const anchor = hits.filter(hit=>hit.offset>=0).sort((a,b)=>strength(b.term)-strength(a.term))[0]?.offset ?? 0;
    const start = Math.max(0,anchor-140);
    return [{score, group:source.group,noteId:source.noteId,at:source.at, id:source.id,title:source.title.slice(0,180),kind:source.kind.slice(0,40),excerpt:raw.slice(start,start+900)}];
  }).sort((a,b)=>b.score-a.score || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const matches = ranked.filter(row => row.score > 0);
  const personal = ranked.filter(row => row.group === 'note' || row.group === 'idea');
  const seeds = new Set(matches.filter(row => row.noteId).slice(0,8).map(row => row.noteId!));
  const adjacent = new Set<string>();
  const dismissed = new Set<string>();
  if (seeds.size && library.decisions.length) {
    const decisions = new Map(library.decisions.map(choice => [choice.evidence,choice.result]));
    const graph = buildNoteGraph({...library,notes:activeNotes},true);
    for (const seed of seeds) {
      for (const edge of graph.adjacency.get(seed) ?? []) {
        const choice = decisions.get(edge.relation.evidenceKey);
        if (choice) for (const id of edge.members) {
          if (!seeds.has(id)) (choice === 'accepted' ? adjacent : dismissed).add(id);
        }
      }
    }
  }
  const shortlist = new Map<string,ProjectKnowledgeCandidate>();
  const take = (rows: typeof ranked, count: number) => {
    for (const row of rows) {
      if (count <= 0 || shortlist.size >= 18) break;
      if (shortlist.has(row.id)) continue;
      const {id,title,kind,excerpt} = row;
      shortlist.set(id,{id,title,kind,excerpt});
      count--;
    }
  };
  take(personal.filter(row => row.noteId && adjacent.has(row.noteId)),4);
  for (const group of ['note','idea']) {
    const own = personal.filter(row => row.group === group);
    take(own.filter(row => row.score > 0),4);
    // The Agent can transfer methods between domains even when their vocabulary differs.
    take(own.filter(row => !row.score && (!row.noteId || !dismissed.has(row.noteId))),personal.length <= 12 ? 12 : 2);
  }
  // Repeated deliveries from old projects should leave room for other sources.
  take(matches.filter(row => row.group !== 'artifact'),18);
  take(matches.filter(row => row.group === 'artifact'),4);
  return [...shortlist.values()];
}
