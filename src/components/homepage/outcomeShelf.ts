import type { AgendaEntry } from '../../data/agendaSchedule';
import type { KnowledgeNote } from '../../data/knowledgeNotes';
import type { Snapshot } from '../../data/types';
import {materialTargetKey,type MaterialTarget} from '../../data/materialUse';
import {boardResults} from './homeBoardData';

export function outcomeShelf(groups:AgendaEntry[][],notes:KnowledgeNote[],projects:Snapshot[]){
    const notesById=new Map(notes.map(n=>[n.id,n]));
    const projectsById=new Map(projects.map(p=>[p.project.id,p]));
    const results=new Map(projects.map(p=>[p.project.id,boardResults(p)]));
    const todos = new Map(notes.flatMap(note=>(note.todos ?? []).map(todo=>
      [materialTargetKey({noteId:note.id,todoId:todo.id}),todo] as const)));
    const plans = new Map<string, Snapshot['plans'][number]>(projects.flatMap(p=>p.plans.map(plan=>['plan:'+p.project.id+':'+plan.id,plan] as const)));
    function targetTitle(t:MaterialTarget) {
      if ('noteId' in t) return todos.get(materialTargetKey(t))?.text;
      const p=projectsById.get(t.projectId);
      return t.itemId ? p?.orchestrations?.[t.taskId]?.items[t.itemId]?.title : p?.tasks[t.taskId]?.title;
    }
    function describe(entry:AgendaEntry) {
      const todo='noteId' in entry && !entry.key.startsWith('followup:') ? todos.get(materialTargetKey(entry)) : undefined;
      const outcome=todo?.outcome;
      const plan='planId' in entry ? plans.get(entry.key) : undefined;
      const delivered='projectId' in entry && entry.taskId ? (results.get(entry.projectId)?.get(entry.taskId) ?? [])
        .filter(result=>!plan || !plan.workItemId || result.itemId===plan.workItemId) : [];
      const uses=(outcome?.usedBy ?? []).map(target=>({target,title:targetTitle(target)})).filter(x=>x.title);
      const at=todo?.followup?.receivedAt ?? outcome?.at ?? entry.completedAt ?? new Date(entry.at).toISOString();
      const latest=entry.progress?.at(-1)?.text;
      const resultText=outcome?.text || plan?.outcomeText;
      const sources='noteId' in entry && todo ? notesById.get(entry.noteId)?.projectQuotes?.filter(q=>q.text===todo.text && q.lineIndex===todo.lineIndex) : undefined;
      const projectName='projectId' in entry ? entry.source : outcome?.projectId ? projectsById.get(outcome.projectId)?.project.name :
        [...new Set((sources ?? []).map(q=>projectsById.get(q.projectId)?.project.name).filter(Boolean))].join(' · ');
      const hasMaterial=!!(resultText || outcome?.url || outcome?.files?.length || delivered.length);
      const search=[entry.title,entry.source,resultText,outcome?.url,outcome?.purpose,projectName,...(entry.progress ?? []).map(p=>p.text),
        ...delivered.map(d=>d.title),...uses.map(u=>u.title),...(outcome?.files ?? []).map(f=>f.name)].join(' ').toLocaleLowerCase();
      return {entry,todo,outcome,resultText,delivered,uses,at,projectName,hasMaterial,search,latest};
    }
    return groups.map(group=>{
      const sorted=group.map(describe).sort((a,b)=>Date.parse(a.todo?.createdAt ?? a.at)-Date.parse(b.todo?.createdAt ?? b.at)
        || Date.parse(a.at)-Date.parse(b.at));
      // A follow-up can have an earlier due time than its parent. Keep the cause before the next step.
      const byKey=new Map(sorted.map(part=>[part.entry.key,part])), seen=new Set<string>();
      const trail:typeof sorted=[];
      function append(part:(typeof sorted)[number]) {
        if(seen.has(part.entry.key)) return;
        seen.add(part.entry.key);
        const parent=part.entry.parentKey && byKey.get(part.entry.parentKey);
        if(parent) append(parent);
        trail.push(part);
      }
      sorted.forEach(append);
      const completed=trail.filter(x=>x.entry.done).sort((a,b)=>Number(b.hasMaterial)-Number(a.hasMaterial) || Date.parse(b.at)-Date.parse(a.at));
      const main=completed[0];
      const uses=[...new Map(trail.flatMap(x=>x.uses.map(use=>[materialTargetKey(use.target),use] as const))).values()];
      return {...main,trail,uses,search:trail.map(x=>x.search).join(' ')};
    }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
