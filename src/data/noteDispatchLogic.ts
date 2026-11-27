import { describeInspiration } from './inspirationCanvas';
import type { KnowledgeLibrary } from './knowledgeNotes';

/** The sending dialog shows the exact directed relationships the run will receive. */
export interface NoteLogicStep {
  id: string;
  from: string;
  to: string;
  fromTitle: string;
  toTitle: string;
  fromIdea?: string;
  toIdea?: string;
  label: string;
  detail: string;
}
export interface NoteDispatchSettings { agentId: string; logic: NoteLogicStep[]; customTags?: string[] }

export function validNoteDispatch(settings: NoteDispatchSettings): boolean {
  if (!settings || typeof settings.agentId !== 'string' || !settings.agentId.trim() || settings.agentId.length > 160 ||
      !Array.isArray(settings.logic) || settings.logic.length > 300) return false;
  const tags = settings.customTags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 50 ||
      tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 1000) ||
      new Set(tags).size !== tags.length)) return false;
  const ids = new Set<string>();
  for (const edge of settings.logic) {
    if (!edge || [edge.id, edge.from, edge.to, edge.fromTitle, edge.toTitle, edge.label].some(
      field => typeof field !== 'string' || !field.trim() || field.length > 1000) ||
      [edge.fromIdea,edge.toIdea].some(value => value !== undefined && (typeof value !== 'string' || value.length > 6000)) ||
      typeof edge.detail !== 'string' || edge.detail.length > 6000 || ids.has(edge.id) || edge.from === edge.to) return false;
    ids.add(edge.id);
  }
  return JSON.stringify([settings.logic,tags]).length <= 64000;
}

export function noteLogicGroups(library: KnowledgeLibrary) {
  const notes = new Map(library.notes.filter(note => !note.archivedAt).map(note => [note.id, note]));
  const cards = new Map(library.inspirationCanvas?.nodes.map(node => [node.noteId, node]));
  const cardTitle = (id:string) => cards.get(id)?.idea?.title || notes.get(id)?.title || '未命名灵感';
  const cardExists = (id:string) => cards.get(id)?.idea || notes.has(id);
  const links = (library.inspirationCanvas?.links ?? []).filter(edge => cardExists(edge.from) && cardExists(edge.to));
  const neighbors = new Map<string, Set<string>>();
  for (const edge of links) for (const [node, other] of [[edge.from,edge.to],[edge.to,edge.from]]) {
    if (!neighbors.has(node)) neighbors.set(node, new Set());
    neighbors.get(node)!.add(other);
  }
  const visited = new Set<string>();
  const groups: {id:string; title:string; noteIds:string[]; steps:NoteLogicStep[]}[] = [];
  for (const first of neighbors.keys()) {
    if (visited.has(first)) continue;
    const ids = new Set([first]);
    for (const id of ids) {
      visited.add(id);
      for (const next of neighbors.get(id) ?? []) ids.add(next);
    }
    const cardIds = [...ids].sort();
    const noteIds = [...new Set(cardIds.map(id => cards.get(id)?.idea?.source?.noteId ?? (notes.has(id) ? id : '')).filter(Boolean))];
    const steps = links.filter(edge => ids.has(edge.from)).map(edge => {
      const fromTitle = cardTitle(edge.from);
      const toTitle = cardTitle(edge.to);
      const label = edge.label.trim() || '接着';
      const fromIdea = cards.get(edge.from)?.idea?.detail;
      const toIdea = cards.get(edge.to)?.idea?.detail;
      return { ...(fromIdea && {fromIdea}), ...(toIdea && {toIdea}), id:edge.id, from:edge.from, to:edge.to, fromTitle, toTitle, label,
        detail:edge.detail.trim() || describeInspiration(fromTitle,toTitle,label) };
    });
    const incoming = new Set(steps.map(step => step.to));
    const start = steps.find(step => !incoming.has(step.from)) ?? steps[0];
    groups.push({id:JSON.stringify(cardIds),noteIds,steps,title:start.fromTitle + ' → ' + start.toTitle + (steps.length > 1 ? ' 等 ' + steps.length + ' 条连线' : '')});
  }
  return groups;
}


export type NoteLogicGroup = ReturnType<typeof noteLogicGroups>[number];

export function findNoteLogicGroups(groups: NoteLogicGroup[], query: string) {
  const normalize = (value:string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,'');
  const terms = query.trim().split(/\s+/u).map(normalize).filter(Boolean);
  if (!terms.length) return groups;
  const rank = (value:string, term:string) => {
    if (value.includes(term)) return 2;
    let position=0;
    for (const letter of value) if (letter === term[position] && ++position === term.length) return 1;
    return 0;
  };
  return groups.map(group => {
    const title = normalize(group.title);
    const content = group.steps.map(step => normalize(
      [step.fromTitle,step.toTitle,step.label,step.detail,step.fromIdea,step.toIdea].filter(Boolean).join(' ')
    ));
    const matches = terms.map(term => Math.max(rank(title, term) * 2, ...content.map(text => rank(text,term))));
    return {group,score:matches.includes(0) ? 0 : matches.reduce((sum,n)=>sum+n,0)};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).map(row=>row.group);
}

/** Methods can request a real file even if the original note asks only for an answer. */
export function noteMethodMaterials(steps: NoteLogicStep[] = [], tags: string[] = []) {
  return [...tags, ...steps.flatMap(step=>[step.fromTitle,step.fromIdea,step.label,step.detail,step.toTitle,step.toIdea].filter(Boolean))].join('\n');
}

export function noteLogicPrompt(steps: NoteLogicStep[] = [], tags: string[] = []) {
  if (!steps.length && !tags.length) return '';
  const ideas = new Map<string,string>();
  for (const step of steps) {
    if (step.fromIdea) ideas.set(step.from, step.fromTitle+'：'+step.fromIdea);
    if (step.toIdea) ideas.set(step.to, step.toTitle+'：'+step.toIdea);
  }
  return '\n\n' + [
    '以所选笔记片段作为需求和背景。只完成本次认领事项，运用下列做法形成对应的成果。',
    steps.length && '帮你想 · 执行思路\n' + steps.map(step =>
      '「' + step.fromTitle + '」—' + step.label + '→「' + step.toTitle + '」：' + step.detail).join('\n'),
    ideas.size && '灵感卡片上的要点\n' + [...ideas.values()].join('\n'),
    tags.length && '用户补充\n' + tags.map(tag => '- '+tag).join('\n'),
    '提交前核对选段事实、方法步骤和用户补充是否都落实到答案。缺少的依据请写明；直接给出成果。',
  ].filter(Boolean).join('\n\n');
}
