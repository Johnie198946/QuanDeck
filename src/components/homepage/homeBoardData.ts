import { deliveryPresentation, deliverySlotEntry } from '../../data/deliveryPresentation';
import { taskKey } from '../../data/collaboration';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import { compareProductAttention, type ProductAttention } from '../../data/productAttention';
import type { NoteSourceRef } from '../../data/noteTaskSource';
import { planningTask } from '../../data/projectPlanning';
import { flattenOverview } from '../../data/overviewTree';
import { resultExcerpt, type PresentedResult } from '../../data/resultPresentation';
import type { ScheduleProgress } from '../../data/scheduleProgress';
import { planFinished } from '../../data/timeline';
import type { Snapshot } from '../../data/types';
import { projectRegister } from '../projects/projectRegister';

export const boardStates = {
  pending: '待开始', running: '进行中', attention: '等我处理', done: '已完成',
} as const;
type BoardState = keyof typeof boardStates;
type BoardOwner = 'me' | 'agent' | 'unassigned';

interface BoardSource {
  id?: string; at: string; title: string; text: string; noteId?: string; todoId?: string; lineIndex?: number;
}
export interface BoardResult {
  id: string; itemId?: string; title: string; at: string; text: string; status: string; ai: boolean;
  currentSubmission?: boolean;
}
export interface BoardCard {
  key: string; projectId?: string; taskId?: string; todoId?: string; noteId?: string;
  project: string; title: string; state: BoardState; owners: BoardOwner[]; ownerName: string;
  at: string; due?: string; reason?: string; progress: ScheduleProgress[];
  attention?: ProductAttention;
  attentionOwner?: BoardOwner;
  sources: BoardSource[]; results: BoardResult[];
  steps: {id: string; title: string; state: string; owner?: string}[];
}

const noteKey = (noteId: string, todoId: string) => JSON.stringify([noteId, todoId]);
export function boardResults(snapshot: Snapshot) {
  const deliveries = deliveryPresentation(snapshot, {}, true);
  const grouped = new Map<string, BoardResult[]>();
  const slotted = new Set<string>();
  const ledger = snapshot.collaboration;
  const submissions = new Map(ledger?.submissions.map(row => [row.id, row]));
  const artifacts = new Map(ledger?.artifacts.map(row => [row.id, row]));
  const add = (taskId: string, id: string, entry: PresentedResult, slotArtifactId?: string) => {
    const record = entry.record;
    const entries = grouped.get(taskId) ?? [];
    const scope = taskKey(taskId, record.itemId);
    const submission = submissions.get(ledger?.tasks[scope]?.latestSubmissionId ?? '');
    const current = submission?.key === scope ? artifacts.get(submission.artifactId) : undefined;
    const currentSubmission = !!current && current.key === scope && (slotArtifactId !== undefined ?
      current.id === slotArtifactId : !!current.outputId && current.outputId === record.outputId && current.body === record.text);
    entries.push({ id, itemId: record.itemId, title: record.title, at: record.at, text: record.text,
      status: entry.status, ai: record.origin === 'agent' || !!entry.sessionId || !!entry.runId, currentSubmission });
    grouped.set(taskId, entries);
  };
  for (const slot of deliveries.contributions) {
    const entry = deliverySlotEntry(snapshot, slot);
    if (!entry) continue;
    add(slot.taskId, slot.id, entry, slot.artifact?.id);
    if (entry.record.outputId) slotted.add(entry.record.outputId);
  }
  for (const {taskId, entry} of deliveries.history) {
    if (!entry.record.outputId || !slotted.has(entry.record.outputId)) add(taskId, entry.record.id, entry);
  }
  for (const entries of grouped.values()) entries.sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return grouped;
}

export function homeBoardCards(projects: Snapshot[], notes: KnowledgeNote[], legacy: ReadonlyMap<string, NoteSourceRef>, now: number) {
  const cards: BoardCard[] = [];
  const byNote = new Map(notes.map(note => [note.id, note]));
  const represented = new Set<string>();
  for (const snapshot of projects) {
    const register = projectRegister(snapshot, now);
    const deliveries = boardResults(snapshot);
    const project = snapshot.project.name, projectId = snapshot.project.id;
    for (const node of register.children) {
      if (!node.taskId || node.bucket === 'cancelled') continue;
      const task = snapshot.tasks[node.taskId];
      const progress = snapshot.plans.filter(plan => !plan.cancelled && plan.taskId === task.id).flatMap(plan => plan.progress ?? []);
      const sources: BoardSource[] = [];
      for (const input of task.inputs ?? []) {
        const ref = input.noteSource ?? legacy.get(input.id);
        const note = ref && byNote.get(ref.noteId);
        const origin = /^来自笔记《([^\n]*)》\n([\s\S]*)$/.exec(input.text);
        const todo = ref?.todoId ? note?.todos?.find(item => item.id === ref.todoId)
          : note?.todos?.find(item => item.lineIndex === ref?.lineIndex && item.text === origin?.[2]);
        if (note && todo) {
          represented.add(noteKey(note.id, todo.id));
          progress.push(...(todo.progress ?? []));
        }
        // A note transfer stores the original line and notebook title, even if the note is renamed or deleted.
        sources.push({ id:input.id, at:input.at, title:note?.title || origin?.[1] || '任务补充', text:origin?.[2] ?? input.text,
          noteId:note?.id, todoId:todo?.id, lineIndex:todo?.lineIndex ?? ref?.lineIndex });
      }
      const origin = task.createdFrom;
      const intake = origin?.type === 'input' ? snapshot.intelligence?.intakes.find(input => input.id === origin.id) : undefined;
      const suggestion = origin?.type === 'suggestion' ? snapshot.intelligence?.suggestions[origin.id] : undefined;
      if (intake) sources.unshift({at:intake.createdAt,title:'最初输入',text:intake.text});
      if (suggestion) sources.unshift({at:suggestion.createdAt,title:'已采用的建议',text:suggestion.description || suggestion.goal || suggestion.title});
      if (!sources.length || task.originalTitle && !sources.some(source => source.text === task.originalTitle)) {
        sources.unshift({at:task.createdAt,title:'创建时的想法',text:task.originalTitle ?? task.title});
      }
      progress.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      const results = deliveries.get(task.id) ?? [];
      const children = flattenOverview(node.children).filter(child => child.itemId && child.bucket !== 'cancelled');
      const attention = [node, ...children].flatMap(child => child.attention ? [child.attention] : []).sort(compareProductAttention)[0];
      const attentionItem = attention?.itemId ? snapshot.orchestrations?.[task.id]?.items[attention.itemId] : undefined;
      const attentionOwner = attention?.entry?.agentId ? 'agent' : attentionItem?.owner ??
        (attentionItem?.executorId ? 'agent' : attention?.itemId ? undefined : task.owner);
      const owners = new Set<BoardOwner>();
      if (task.owner) owners.add(task.owner);
      if (node.agentId) owners.add('agent');
      const agents = new Set<string>();
      if (node.agentId) agents.add(snapshot.agents.find(agent => agent.id === node.agentId)?.name || 'AI');
      for (const child of children) {
        const assigned = snapshot.orchestrations?.[task.id]?.items[child.itemId!]?.owner;
        if (assigned && assigned !== 'unassigned') owners.add(assigned);
        if (child.agentId) {
          owners.add('agent');
          agents.add(snapshot.agents.find(agent => agent.id === child.agentId)?.name || 'AI');
        }
      }
      if (!owners.size) owners.add('unassigned');
      const ownerName = [owners.has('me') && '我', owners.has('agent') && ([...agents].join('、') || 'AI'), owners.has('unassigned') && '待分派'].filter(Boolean).join(' · ');
      let state: BoardState = node.bucket;
      if (state !== 'done' && (node.attention || children.some(child => child.bucket === 'attention'))) state = 'attention';
      else if (state === 'pending' && (children.some(child => child.bucket === 'running') || progress.length)) state = 'running';
      const at = [task.createdAt, task.completion?.at, progress.at(-1)?.at, results[0]?.at].filter((s): s is string => !!s).sort().at(-1)!;
      cards.push({key:node.key,projectId,project,taskId:task.id,title:task.title,state,owners:[...owners],ownerName,at,
        due:planningTask(snapshot,task.id).end ?? task.due?.date,reason:attention?.label || (state === 'attention' ? node.state : undefined),attention,attentionOwner,
        progress,sources,results,steps:children.map(child => ({id:child.itemId!, title:child.title,state:child.state,owner:child.owner}))});
    }
    for (const plan of snapshot.plans) {
      if (plan.cancelled || plan.taskId) continue;
      const date = plan.date ?? snapshot.date;
      const progress = plan.progress ?? [];
      cards.push({key:JSON.stringify([projectId,'plan',plan.id]),projectId,project,title:plan.title,
        owners:['me'],ownerName:'我',at:progress.at(-1)?.at ?? date,due:date,
        state:planFinished(plan,snapshot) ? 'done' : progress.length || plan.manualStartedAt ? 'running' : 'pending',
        progress,sources:[{at:date,title:'项目日程',text:plan.title}],results:[],steps:[]});
    }
  }
  for (const note of notes) {
    for (const todo of note.todos ?? []) {
      const key = noteKey(note.id,todo.id);
      if (represented.has(key)) continue;
      const progress = todo.progress ?? [];
      cards.push({key,project:'个人待办',title:todo.text,noteId:note.id,todoId:todo.id,
        owners:['me'],ownerName:'我',state:todo.completedAt ? 'done' : progress.length ? 'running' : 'pending',
        at:todo.completedAt ?? progress.at(-1)?.at ?? todo.createdAt,due:todo.dueAt,
        progress,sources:[{id:todo.id,at:todo.createdAt,title:note.title || '未命名笔记',text:todo.text,noteId:note.id,todoId:todo.id,lineIndex:todo.lineIndex}],results:[],steps:[]});
    }
  }
  return cards.sort((a,b) => a.state.localeCompare(b.state) || Number(!!b.reason)-Number(!!a.reason) ||
    (a.state === 'done' && b.state === 'done' ? b.at.localeCompare(a.at) : (a.due ?? '9999').localeCompare(b.due ?? '9999')) ||
    b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

export function boardSearchIndex(card: BoardCard) {
  return [card.project,card.title,card.ownerName,boardStates[card.state],card.reason,
    ...card.sources.flatMap(source => [source.title,source.text]), ...card.progress.map(log => log.text),
    ...card.steps.map(step => step.title), ...card.results.flatMap(result => [result.title,result.text])].join('\n').toLocaleLowerCase();
}

export function cardTakeaway(card: BoardCard) {
  const entry = card.progress.at(-1), result = card.results[0];
  if (entry && (!result || entry.at >= result.at)) return {label:'最新进展',text:entry.text};
  if (result) return {label:result.ai ? 'AI 交回' : '成果',text:resultExcerpt(result.text,65) || result.title};
  return undefined;
}
