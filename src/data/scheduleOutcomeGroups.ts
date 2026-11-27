import type { AgendaEntry } from './agendaSchedule';
import type { KnowledgeNote } from './knowledgeNotes';
import { outcomeUrl, type NoteTodo } from './noteTodos';
import type { Snapshot } from './types';

/** The shelf is a view of the original schedules. No result, attachment or reference is copied. */
export function scheduleOutcomeGroups(entries: AgendaEntry[], notes: KnowledgeNote[], projects: Snapshot[]) {
  const rows = [...entries];
  const todos = new Map<string, NoteTodo>();
  const filed = new Map<string,Set<string>>();
  for(const note of notes) for(const q of note.projectQuotes ?? []) {
    const key=JSON.stringify([note.id,q.lineIndex,q.text]);
    const projects=filed.get(key) ?? new Set<string>();
    projects.add(q.projectId); filed.set(key,projects);
  }
  const roots = new Map<string, string>();
  const keys = new Map<string,string>();
  const plans = new Map<string, Snapshot["plans"][number]>(projects.flatMap(p => p.plans.map(plan => ['plan:'+p.project.id+':'+plan.id, plan] as const)));
  for (const note of notes) for (const todo of note.todos ?? []) {
    const key = 'note:'+note.id+':'+todo.id;
    todos.set(key,todo);
    // Closed follow-ups in the old format no longer appear in active scheduleEntries.
    if (todo.followup?.receivedAt) rows.push({
      key:'followup:'+note.id+':'+todo.id, parentKey:key, noteId:note.id, todoId:todo.id,
      source:note.title, title:'跟进 · '+todo.text, at:Date.parse(todo.followup.dueAt),
      completedAt:todo.followup.receivedAt, progress:todo.followup.progress, done:true, followup:true,
    });
  }
  for (const row of rows) roots.set(row.key,row.key);
  function root(key:string) {
    let id=key;
    while(roots.get(id)!==id) id=roots.get(id)!;
    roots.set(key,id);
    return id;
  }
  function connect(key:string, other:string) {
    const a=root(key), b=root(other);
    if(a!==b) roots.set(a,b);
  }
  function shared(key:string,parts:string[]) {
    const identity=JSON.stringify(parts), prior=keys.get(identity);
    if(prior) connect(key,prior);
    else keys.set(identity,key);
  }
  for(const row of rows) {
    if(row.parentKey && roots.has(row.parentKey)) connect(row.key,row.parentKey);
    const todo=todos.get(row.key), outcome=todo?.outcome;
    if('noteId' in row && outcome) {
      // A shared person, a similar title or a generic "已收到" is not a material identity.
      const sources=filed.get(JSON.stringify([row.noteId,todo!.lineIndex,todo!.text]));
      const projectId=outcome.projectId || (sources?.size===1 ? sources.values().next().value : undefined);
      const scope=projectId ? 'project:'+projectId : sources?.size ? row.key : 'note:'+row.noteId;
      const url=outcome.url && outcomeUrl(outcome.url);
      // Match the complete material set. A shared template in two different packages
      // or a shared folder has too little evidence to merge their separate outcomes.
      const ids=(outcome.files ?? []).map(file=>file.id).sort();
      const link=url ? new URL(url) : undefined;
      const documentLink=link && (link.search || link.pathname!=='/') && !/\/(?:folder|folders|drive)(?:\/|$)/i.test(link.pathname) ? url : undefined;
      if(ids.length || documentLink) shared(row.key,[scope,'material',documentLink ?? '',...ids]);
    }
    if('projectId' in row && row.taskId && !row.parentKey) {
      const plan=plans.get(row.key);
      if(!plan?.outcomeText) shared(row.key,['task',row.projectId,row.taskId,plan?.workItemId ?? '']);
    }
  }
  const groups=new Map<string,AgendaEntry[]>();
  for(const row of rows) {
    const key=root(row.key), group=groups.get(key) ?? [];
    group.push(row);groups.set(key,group);
  }
  return [...groups.values()].filter(group=>group.some(row=>row.done));
}
