import { segmentKnowledgeWords } from './knowledgeWords';
import type { OutputAttachment, Snapshot } from './types';
import { projectMemoryNotes } from './projectMemoryNotes';
import { knowledgeAnchorText, noteLinks, type AgentKnowledgeEdge, type KnowledgeLibrary, type KnowledgeNote } from './knowledgeNotes';

export type KnowledgeKind = 'note' | 'project' | 'task' | 'journal' | 'plan' | 'artifact' | 'file' | 'decision' | 'memory';
export interface KnowledgeSource {
  id: string;
  kind: KnowledgeKind;
  title: string;
  text: string;
  at?: string;
  projectId?: string;
  projectName?: string;
  noteId?: string;
  taskId?: string;
  itemId?: string;
  blockId?: string;
  planId?: string;
  sectionId?: string;
  conclusionId?: string;
  file?: OutputAttachment;
}
export const knowledgeKindLabels: Record<KnowledgeKind, string> = {
  note: '笔记', project: '项目', task: '任务', journal: '日记', plan: '研究', artifact: '成果',
  file: '附件', decision: '决定', memory: '经验',
};

function noteIndex(note: KnowledgeNote): KnowledgeSource[] {
  const noteSource = { noteId: note.id, at: note.updatedAt };
  return [
    { ...noteSource, id: 'note:' + note.id, kind: 'note', title: note.title,
      text: [note.body, ...note.expansions.flatMap(expansion => [expansion.answer, ...(expansion.sources ?? []).map(source => source.title + ' ' + source.excerpt)])].join('\n') },
    ...note.attachments.map(file => ({
      ...noteSource, id: `note:${note.id}:file:${file.id}`, kind: 'file' as const, title: file.name, text: note.title, file,
    })),
  ];
}

const projectIndexCache = new WeakMap<Snapshot, KnowledgeSource[]>();
function projectIndex(snapshot: Snapshot): KnowledgeSource[] {
  const cached = projectIndexCache.get(snapshot);
  if (cached) return cached;
  const { project, tasks, collaboration } = snapshot;
  const scope = { projectId: project.id, projectName: project.name };
  const rows: KnowledgeSource[] = [];
  const put = (id: string, kind: KnowledgeKind, title: string, text: string, options: Partial<KnowledgeSource> = {}) => {
    rows.push({ ...scope, ...options, id: project.id + ':' + id, kind, title, text });
  };
  const active = (key: string) => {
    const task = collaboration?.tasks[key];
    return !task?.archived && !task?.key.startsWith('planning:');
  };
  const taskScope = (key?: string) => {
    const [taskId, itemId] = key?.split('::') ?? [];
    return { taskId, itemId };
  };
  put('project', 'project', project.name, project.description ?? '', { at: project.createdAt });
  for (const file of project.attachments ?? []) put('project:file:' + file.id, 'file', file.name, project.name, { at: project.createdAt, file });
  function research(key: string, title: string, target: Partial<KnowledgeSource>) {
    const entry = snapshot.projectPlanning?.tasks[key];
    const body = [entry?.information, entry?.conclusion, entry?.deliverable].filter(Boolean).join('\n');
    if (!body) return;
    const edit = [...(snapshot.projectPlanning?.changes ?? [])].reverse().find(item => item.key === key);
    const at = edit ? collaboration?.events.find(event => event.id === edit.eventId)?.at : undefined;
    put('research:' + key, 'plan', title + ' · 研究', body, { ...target, at });
  }
  for (const task of Object.values(tasks)) {
    if (!active(task.id) || snapshot.deletedTasks?.[task.id]) continue;
    const target = { taskId: task.id, at: task.createdAt };
    put('task:' + task.id, 'task', task.title, [task.originalTitle, ...(task.inputs ?? []).map(input => input.text)].filter(Boolean).join('\n'), target);
    research(task.id, task.title, target);
    for (const file of task.attachments ?? []) put(`task:${task.id}:file:${file.id}`, 'file', file.name, task.title, { ...target, file });
    for (const item of Object.values(snapshot.orchestrations?.[task.id]?.items ?? {})) {
      const key = `${task.id}::${item.id}`;
      if (!active(key) || snapshot.deletedWorkItems?.[key]) continue;
      const target = { taskId: task.id, itemId: item.id, at: item.completedAt };
      put('item:' + key, 'task', item.title, item.expected ?? '', target);
      research(key, item.title, target);
      for (const file of item.attachments ?? []) put(`item:${key}:file:${file.id}`, 'file', file.name, item.title, { ...target, file });
    }
  }
  for (const block of snapshot.journal.blocks) {
    if (block.kind === 'text' && block.text.trim()) put('journal:' + block.id, 'journal', block.text.trim().split('\n')[0].slice(0, 60), block.text, { blockId: block.id });
  }
  for (const plan of Object.values(snapshot.ideaPlans ?? {})) {
    if (plan.scope !== 'project' && (!tasks[plan.taskId] || !active(plan.itemId ? `${plan.taskId}::${plan.itemId}` : plan.taskId))) continue;
    const target = { taskId: plan.scope === 'project' ? undefined : plan.taskId, itemId: plan.itemId ?? undefined, planId: plan.id };
    const document = plan.adopted && plan.adopted.draftVersion !== plan.draftVersion ? plan.adopted.doc : plan.draft;
    for (const section of (document ?? plan.draft).sections) {
      const body = section.lines.map(line => line.text).join('\n');
      if (body.trim()) put(`plan:${plan.id}:${section.id}`, 'plan', plan.title + ' · ' + section.title, body, { ...target, sectionId: section.id, at: document === plan.adopted?.doc ? plan.adopted?.at : undefined });
    }
    for (const reply of plan.discussion?.conclusions ?? []) {
      if (reply.source !== 'agent') continue;
      put(`plan:${plan.id}:reply:${reply.id}`, 'plan', plan.title + ' · 讨论', reply.summary, {
        ...target, sectionId: reply.scopeId, conclusionId: reply.id, at: reply.recordedAt,
      });
    }
  }
  const representedOutputs = new Set<string>();
  for (const artifact of collaboration?.artifacts ?? []) {
    if (!active(artifact.key)) continue;
    if (artifact.outputId) representedOutputs.add(artifact.outputId);
    const target = { ...taskScope(artifact.key), at: artifact.observedAt || artifact.createdAt };
    put('artifact:' + artifact.id, 'artifact', artifact.title, artifact.body, target);
    for (const file of artifact.attachments ?? []) put(`artifact:${artifact.id}:file:${file.id}`, 'file', file.name, artifact.title, { ...target, file });
  }
  for (const output of Object.values(snapshot.outputs ?? {})) {
    if (representedOutputs.has(output.id) || !active(output.workItemId ? `${output.taskId}::${output.workItemId}` : output.taskId)) continue;
    const target = { taskId: output.taskId, itemId: output.workItemId ?? undefined, at: output.updatedAt };
    put('output:' + output.id, 'artifact', output.title, output.body, target);
    for (const file of output.attachments ?? []) put(`output:${output.id}:file:${file.id}`, 'file', file.name, output.title, { ...target, file });
  }
  const decisions = new Map<string, NonNullable<Snapshot['collaboration']>['decisions'][number]>();
  for (const item of collaboration?.decisions ?? []) {
    if ((decisions.get(item.decisionId)?.revision ?? 0) < item.revision) decisions.set(item.decisionId, item);
  }
  for (const item of decisions.values()) {
    if (item.authority !== 'confirmed' || item.taskKey && !active(item.taskKey)) continue;
    put('decision:' + item.id, 'decision', item.text.slice(0, 70), item.text, { ...taskScope(item.taskKey), at: item.at });
  }
  for (const item of projectMemoryNotes(snapshot)) {
    if (item.status !== 'confirmed' || item.stale || !active(item.source.taskKey)) continue;
    put('memory:' + item.id, 'memory', item.situation.slice(0, 70),
      [item.situation, item.action, item.outcome, item.limitation].join('\n'), { ...taskScope(item.source.taskKey), at: item.at });
  }
  projectIndexCache.set(snapshot, rows);
  return rows;
}

export function buildKnowledgeIndex(library: KnowledgeLibrary, projects: readonly Snapshot[]) {
  return [
    ...library.notes.flatMap(noteIndex),
    ...projects.filter(project => project.project.id && !project.project.deletedAt).flatMap(projectIndex),
  ];
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const words = (value: string) => normalize(value).match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
const prefix = /^(?:请问|帮我找一下|帮我找|帮我查一下|找一下|查一下|我想找|我想看)/;
const filler = /(?:的(?:项目|资料|文件|记录|有什么)|(?:相关|有关)的(?:资料|文件|内容)|在哪里|在哪里看|有哪些|是什么|是什么样的)$/;
function score(text: string, query: string) {
  const subject = normalize(text);
  if (subject === query) return 9;
  if (subject.startsWith(query)) return 6;
  if (subject.includes(query)) return 4;
  if (query.length < 3 || query.length > 30) return 0;
  // A tight subsequence also finds phrases such as “温泉路线” in “温泉体验与自驾路线”.
  for (let from = subject.indexOf(query[0]); from >= 0; from = subject.indexOf(query[0], from + 1)) {
    let next = 1;
    for (let i = from + 1; i < Math.min(subject.length, from + query.length * 2); i++) {
      if (subject[i] === query[next]) next++;
      if (next === query.length) return 1;
    }
  }
  return 0;
}

export function searchKnowledge<T extends Pick<KnowledgeSource, 'title' | 'text' | 'at'>>(index: readonly T[], query: string, limit = 30, currentYear = new Date().getFullYear()) {
  const clean = normalize(query).trim().slice(0, 200).replace(prefix, '').replace(filler, '');
  const timePrefix = clean.match(/^(去年|今年)(?:做过的|做的|完成的|的)?/);
  const year = timePrefix ? currentYear - Number(timePrefix[1] === '去年') : undefined;
  const terms = words((timePrefix ? clean.slice(timePrefix[0].length) : clean).trim());
  if (!terms.length) return [];
  return index.flatMap(source => {
    if (year && !source.at?.startsWith(String(year) + '-')) return [];
    const hits = terms.map(term => 2 * score(source.title, term) + score(source.text, term));
    if (hits.some(value => !value)) return [];
    const text = source.text.replace(/\s+/g, ' ').trim();
    const first = Math.max(0, normalize(text).indexOf(terms[0] ?? "") - 20);
    return [{ ...source, excerpt: (first > 0 ? '…' : '') + text.slice(first, first + 120) + (text.length > first + 120 ? '…' : ''), rank: hits.reduce((a, b) => a + b, 0) }];
  }).sort((a, b) => b.rank - a.rank || (b.at ?? '').localeCompare(a.at ?? '') || a.title.localeCompare(b.title))
    .slice(0, limit);
}

const common = new Set(['项目','任务','方案','计划','完成','可以','需要','使用','提交','资料','相关','研究','一个','方案设计','最后','以及','结果','确认','现在','内容','整理','要求','进行','继续','根据','当前','测试','检查','这个','产品','设计','参考','参考链接','链接','记录','笔记','预算','人数','天数','附件','截图','图片','问题','奇怪','问题记录','如图','如下图','image','screenshot','where','what','that','with','from','plan','task','this','project']);
const withoutReferences = (text: string) => text
  .replace(/!\[[^\]\n]*\]\(<?attachment:[^\s)>]+>?\)/giu, ' ')
  .replace(/https?:\/\/[^\s<>()\[\]"'，。；！、]+|attachment:[\w-]+/giu, ' ');
function keywords(text: string) {
  const phrases = new Set(words(text).filter(word => /^[a-z]{4,}$/i.test(word) || /^[\p{Script=Han}]{4,12}$/u.test(word)));
  for (const term of segmentKnowledgeWords(text)) {
    if (/^[\p{Script=Han}]{2,}$/u.test(term)) phrases.add(term);
  }
  return [...phrases].filter(term => !common.has(term)).slice(0, 100);
}

type Claim = { label: string; value: string; line: string };
function claims(body: string): Map<string, Claim> {
  const rows = new Map<string, Claim>();
  for (const line of body.slice(0, 6000).split('\n')) {
    const found = line.trim().match(/^(?:[-*]\s+)?([^：:]{2,24})[：:]\s*([\d]+(?:[.,]\d+)?\s*(?:元|站|天|人|页|小时|分钟|辆|份|%))\s*$/);
    if (!found) continue;
    rows.set(normalize(found[1]).trim(), { label: found[1], value: normalize(found[2]).replace(/\s/g, ''), line: line.trim() });
  }
  return rows;
}

export interface KnowledgeRelation {
  manual?: boolean;
  agent?: AgentKnowledgeEdge;
  id: string;
  evidenceKey: string;
  source: KnowledgeSource;
  kind: '关联' | '冲突' | '补充' | '同源';
  title: string;
  evidence: string[];
}
type RankedRelation = KnowledgeRelation & { rank: number };

function relationSubject(note: KnowledgeNote) {
  return {
    id: 'note:' + note.id, words: keywords(withoutReferences(note.title + '\n' + note.body)),
    urls: new Set(noteLinks(note.body)), claims: claims(note.body),
  };
}

function relationTarget(source: KnowledgeSource) {
  const body = source.text.slice(0, 10000);
  return { source, body, normalized: normalize(withoutReferences(source.title + '\n' + body)), urls: noteLinks(body), claims: undefined as Map<string, Claim> | undefined };
}

function matchRelation(subject: ReturnType<typeof relationSubject>, target: ReturnType<typeof relationTarget>): RankedRelation | undefined {
  const { source, normalized } = target;
  const shared = subject.words.filter(term => normalized.includes(term)).sort((a, b) => b.length - a.length || a.localeCompare(b));
  const distinct = shared.filter(term => !shared.some(other => other.length > term.length && other.includes(term))).slice(0, 5);
  const links = target.urls.filter(url => subject.urls.has(url));
  if (!links.length && distinct.length < 2 && !distinct.some(term => term.length >= 5)) return;
  const comparable = subject.claims.size ? target.claims ??= claims(target.body) : undefined;
  const disagreement = comparable && [...subject.claims].find(([label, claim]) => {
    const other = comparable.get(label);
    return other && other.value !== claim.value && other.value.replace(/[\d.,]/g, '') === claim.value.replace(/[\d.,]/g, '');
  });
  const kind = disagreement ? '冲突' : links.length ? '同源' : source.kind === 'artifact' || source.kind === 'plan' ? '补充' : '关联';
  const evidence = [
    ...(disagreement ? [disagreement[1].line, comparable!.get(disagreement[0])!.line] : []),
    ...links,
    ...(distinct.length ? ['共同提到「' + distinct.join('」「') + '」'] : []),
  ];
  const identity = [subject.id, source.id].sort();
  const primaryEvidence = disagreement ? evidence.slice(0, 2).sort() : links.length ? [...links].sort() : [...distinct].sort();
  const evidenceKey = JSON.stringify([identity, kind, primaryEvidence]);
  const title = disagreement ? `两处「${disagreement[1].label}」数值不同` : source.title;
  const rank = (disagreement ? 100 : links.length ? 30 : 0) + distinct.length;
  return { id: source.id, source, kind, title, evidence, evidenceKey, rank };
}

export function knowledgeRelations(note: KnowledgeNote, index: readonly KnowledgeSource[], library: KnowledgeLibrary, showDismissed = false) {
  const subject = relationSubject(note);
  const decisions = new Map(library.decisions.map(entry => [entry.evidence, entry.result]));
  const relations: RankedRelation[] = [];
  for (const source of index) {
    if (source.noteId === note.id || ['file', 'journal'].includes(source.kind)) continue;
    const relation = matchRelation(subject, relationTarget(source));
    if (relation && (showDismissed || decisions.get(relation.evidenceKey) !== 'dismissed')) relations.push(relation);
  }
  return relations.sort((a, b) => b.rank - a.rank || a.source.title.localeCompare(b.source.title)).slice(0, 8);
}

export type KnowledgeGraphEdge = { from: string; to: string; members: string[]; relation: RankedRelation };

/** All notes stay in the map, including old archived notes and notes with no links. */
export function buildNoteGraph(library: KnowledgeLibrary, showDismissed = false) {
  const notes = [...library.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const sources = notes.map(note => relationTarget(noteIndex(note)[0]));
  const edges = new Map<string, KnowledgeGraphEdge>();
  if (library.agentGraph?.reasoning?.version !== 2) {
    const subjects = notes.map(relationSubject);
    const prefixes = new Map<string, Set<number>>();
    for (const subject of subjects) for (const term of subject.words) {
      const key = term.slice(0, 2);
      if (!prefixes.has(key)) prefixes.set(key, new Set());
    }
    const byUrl = new Map<string, Set<number>>();
    sources.forEach((target, index) => {
      // A prefix narrows the search. The full word still has to match to count as evidence.
      for (let start = 0; start < target.normalized.length - 1; start++) {
        prefixes.get(target.normalized.slice(start, start + 2))?.add(index);
      }
      for (const url of target.urls) {
        if (!byUrl.has(url)) byUrl.set(url, new Set());
        byUrl.get(url)!.add(index);
      }
    });

    subjects.forEach((subject, index) => {
      const candidates = new Set<number>();
      for (const term of subject.words) for (const candidate of prefixes.get(term.slice(0, 2)) ?? []) candidates.add(candidate);
      for (const url of subject.urls) for (const candidate of byUrl.get(url) ?? []) candidates.add(candidate);
      candidates.delete(index);
      for (const candidate of candidates) {
        const relation = matchRelation(subject, sources[candidate]);
        if (!relation) continue;
        const from = notes[index].id, to = notes[candidate].id;
        const pair = JSON.stringify([from, to].sort());
        const previous = edges.get(pair);
        if (!previous || previous.relation.rank < relation.rank) edges.set(pair, { from, to, members: [from, to], relation });
      }
    });
  }
  const decisions = new Map(library.decisions.map(entry => [entry.evidence, entry.result]));
  const byId = new Map(notes.map((note, i) => [note.id, { note, source: sources[i].source }]));
  for (const item of library.agentGraph?.edges ?? []) {
    let suggestion = item;
    if (item.anchors && item.evidenceKey) {
      const sourceEvidence = item.anchors.flatMap(anchor => {
        const n = byId.get(anchor.noteId)?.note;
        const quote = n && knowledgeAnchorText(n, anchor);
        return n && quote ? [{noteId:n.id,title:n.title,quote,origin:anchor.origin}] : [];
      });
      if (sourceEvidence.length !== item.anchors.length) continue;
      suggestion = {...item, sourceEvidence, fromQuote:sourceEvidence[0].quote,toQuote:sourceEvidence[1].quote};
    }
    const from = byId.get(suggestion.from), to = byId.get(suggestion.to);
    if (!from || !to || from.note.revision !== suggestion.fromRevision || to.note.revision !== suggestion.toRevision) continue;
    const key = JSON.stringify([suggestion.from, suggestion.to].sort());
    const local = edges.get(key);
    // The same revision pair keeps its decision if the Agent rephrases its explanation.
    const agentKey = JSON.stringify(['agent', [[suggestion.from, suggestion.fromRevision], [suggestion.to, suggestion.toRevision]].sort()]);
    const localKey = local?.relation.evidenceKey;
    const evidenceKey = suggestion.evidenceKey ?? (localKey && !decisions.has(agentKey) && decisions.has(localKey) ? localKey : agentKey);
    // Keep an explicit local conflict visible while showing the Agent's reading of the same pair.
    const members = [...new Set([suggestion.from, suggestion.to, ...(suggestion.anchors ?? []).map(a => a.noteId)])];
    edges.set(suggestion.evidenceKey ?? key, { from: suggestion.from, to: suggestion.to, members, relation: {
      id: to.source.id, source: to.source, kind: suggestion.category === '矛盾' ? '冲突' : suggestion.category === '同源' ? '同源' : local?.relation.kind ?? '关联', title: suggestion.label,
      rank: (local?.relation.rank ?? 0) + 120, evidenceKey, agent: suggestion,
      evidence: [...(suggestion.sourceEvidence?.map(e => e.quote) ?? [suggestion.fromQuote ?? '', suggestion.toQuote ?? '']), ...(local?.relation.evidence ?? [])],
    } });
  }
  const visible = [...edges.values()].filter(edge => showDismissed || decisions.get(edge.relation.evidenceKey) !== 'dismissed');
  return assembleNoteGraph(notes, new Map(sources.map(target => [target.source.noteId!, target.source])), visible);
}

/** Each personal graph contains only note pairs explicitly linked by its owner. */
export function buildPersonalNoteGraph(library: KnowledgeLibrary) {
  const notes = library.notes.filter(note => !note.archivedAt);
  const sources = new Map(notes.map(note => [note.id, noteIndex(note)[0]]));
  const edges = new Map<string, KnowledgeGraphEdge>();
  for (const pair of library.manualGraphLinks ?? []) {
    const [from, to] = [...pair].sort();
    const source = sources.get(to);
    if (!sources.has(from) || !source || from === to) continue;
    const evidenceKey = JSON.stringify(['manual', from, to]);
    edges.set(evidenceKey, {
      from, to, members: [from, to],
      relation: { manual: true, id: source.id, source, kind: '关联', title: source.title,
        evidenceKey, evidence: [], rank: 0 },
    });
  }
  return assembleNoteGraph(notes, sources, [...edges.values()]);
}

function assembleNoteGraph(notes: KnowledgeNote[], sources: Map<string, KnowledgeSource>, edges: KnowledgeGraphEdge[]) {
  const adjacency = new Map<string, KnowledgeGraphEdge[]>();
  for (const edge of edges) {
    for (const member of edge.members) {
      const nearby = adjacency.get(member);
      if (nearby) nearby.push(edge);
      else adjacency.set(member, [edge]);
    }
  }
  for (const nearby of adjacency.values()) nearby.sort((a, b) => b.relation.rank - a.relation.rank);
  return { notes, sources, edges, adjacency };
}

/** Used during project drafting. Only returns previews to the person, never a model payload. */
export function recommendKnowledge(index: readonly KnowledgeSource[], query: string) {
  const terms = keywords(query).filter(term => term.length >= 2);
  if (!terms.length) return [];
  return index.flatMap(source => {
    if (source.kind === 'file') return [];
    const subject = normalize(source.title + '\n' + source.text);
    const matched = terms.filter(term => subject.includes(term));
    if (matched.length < 2 && !matched.some(term => term.length >= 5)) return [];
    const start = Math.max(0, normalize(source.text).indexOf(matched[0] ?? '') - 24);
    const excerpt = source.text.slice(start, start + 150).replace(/\s+/g, ' ').trim();
    return [{ ...source, excerpt, matchedTerms: matched, relevance: matched.length + matched.filter(term => normalize(source.title).includes(term)).length }];
  }).sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title)).slice(0, 4);
}
