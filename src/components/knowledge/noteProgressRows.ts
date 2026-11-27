import { locateSelection } from '../../data/knowledgeNotes';
import { receiptSelection } from '../../data/noteReceipts';
import type { NoteTodo } from '../../data/noteTodos';
import type { ScheduleProgress } from '../../data/scheduleProgress';
import type { NoteSourceRef } from '../../data/noteTaskSource';
import type { Snapshot } from '../../data/types';

export type ProgressRow = { lineIndex:number; events:ScheduleProgress[] };

type ProjectMark = {id:string; source:NoteSourceRef; text:string; events:ScheduleProgress[]};

/** Resolve project-owned data once when a project's snapshot changes, outside the keystroke path. */
export function projectProgressMarks(noteId:string, projects:Snapshot[]) {
  const marks:ProjectMark[]=[];
  for(const project of projects) {
    if(project.project.deletedAt) continue;
    const plans=new Map(project.plans.map(p=>[p.id,p]));
    for(const plan of project.plans) {
      if(plan.cancelled || !plan.progress?.length) continue;
      let source=plan;
      const seen=new Set<string>();
      while(!source.taskId && source.follows && !seen.has(source.id)) {
        seen.add(source.id);
        const parent=plans.get(source.follows.parentId);
        if(!parent || parent.cancelled) break;
        source=parent;
      }
      if(!source.taskId) continue;
      for(const input of project.tasks[source.taskId]?.inputs ?? []) if(input.noteSource?.noteId===noteId) {
        marks.push({id:input.id,source:input.noteSource,text:input.text,events:plan.progress});
      }
    }
  }
  return marks;
}

export function noteProgressRows(todos:NoteTodo[], body:string, marks:ProjectMark[]):ProgressRow[] {
  const byLine=new Map<number,Map<string,ScheduleProgress>>();
  function add(line:number, progress:ScheduleProgress[]) {
    const events=byLine.get(line) ?? new Map<string,ScheduleProgress>();
    for(const p of progress) events.set(p.id,p);
    byLine.set(line,events);
  }
  for(const todo of todos) {
    if(todo.progress?.length) add(todo.lineIndex,todo.progress);
    if(todo.followup?.progress?.length) add(todo.lineIndex,todo.followup.progress);
  }
  for(const {source:ref,id,text,events} of marks) {
    const sourceTodo=ref.todoId && todos.find(t=>t.id===ref.todoId);
    if(sourceTodo) { add(sourceTodo.lineIndex,events); continue; }
    const anchor=receiptSelection({key:id,noteId:ref.noteId,lineIndex:ref.lineIndex,quote:ref.selection?.quote ||
      text.replace(/^来自笔记《[^\n]*》\n/,''),selection:ref.selection,receipts:[]},body);
    const offset=anchor && locateSelection(body,anchor);
    if(offset!==undefined) add(body.slice(0,offset).split('\n').length-1,events);
  }
  return [...byLine].map(([lineIndex,items])=>({lineIndex,events:[...items.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))}));
}
