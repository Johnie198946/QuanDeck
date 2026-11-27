import { createMaterialRecall, recallMaterials } from './materialRecall';
import { KNOWLEDGE_STORAGE_KEY, parseKnowledge, type KnowledgeNote } from './knowledgeNotes';
import { taskKey } from './collaboration';
import { projectBackground } from './projectUnderstanding';
import { noteRequirement } from './noteRequirement';
import type { OutputAttachment, Snapshot } from './types';

export function projectMaterialContext(snapshot: Snapshot) {
  return [...new Set([snapshot.project.description?.trim(),projectBackground(snapshot)].filter(Boolean))].join('\n');
}

export function taskMaterialQuery(snapshot: Snapshot, taskId: string, itemId?: string) {
  const task = snapshot.tasks[taskId];
  const item = itemId ? snapshot.orchestrations?.[taskId]?.items[itemId] : undefined;
  const key = taskKey(taskId,itemId);
  const spec = snapshot.collaboration?.specs.find(s => s.key === key && s.revision === snapshot.collaboration?.tasks[key]?.specRevision);
  const plan = snapshot.projectPlanning?.tasks[key];
  const words = itemId ? [item?.title, item?.expected] :
    [task?.title, task?.originalTitle, ...(task?.noteWork?.units ?? [])];
  const fromNote = !itemId && task?.inputs?.some(input=>input.noteSource);
  const origin = fromNote && task?.inputs?.find(input=>input.noteSource?.todoId)?.noteSource;
  // Note handoff already includes the user's requested deliverable in the selected text.
  // Its generated delivery instructions would otherwise introduce unrelated search subjects.
  const registrationText = task?.noteWork?.units.join('\n') || task?.originalTitle || task?.title;
  const originalDelivery = fromNote && registrationText ? noteRequirement(registrationText).deliverable : undefined;
  const deliverable = plan?.deliverable === originalDelivery ? undefined : plan?.deliverable;
  return {
    ...(origin && origin.todoId ? {exclude:{noteId:origin.noteId,todoId:origin.todoId}} : {}),
    target: {projectId:snapshot.project.id,taskId,itemId},
    text: [...new Set([...words, spec?.goal, deliverable].filter(Boolean))].join('\n'),
    projectId: snapshot.project.id,
    projectName: snapshot.project.name,
    context: projectMaterialContext(snapshot),
  };
}

/** Keep the three items that travel with the task visible even if personal matches rank higher. */
export function visibleTaskMaterials(find:ReturnType<typeof createMaterialRecall>, query:Parameters<typeof recallMaterials>[1]) {
  const ranked = find(query, Infinity);
  const filed = query.projectId ? ranked.filter(m => m.projectId === query.projectId).slice(0,3) : [];
  const personal = ranked.filter(m => !m.projectId).slice(0,3-filed.length);
  const used = ranked.filter(m=>m.reason==='已用于这个任务');
  return [...new Set([...used,...filed,...personal])];
}

function projectMatches(snapshot: Snapshot, taskId: string, itemId?: string) {
  const query=taskMaterialQuery(snapshot,taskId,itemId);
  if (!query.text) return [];
  try {
    const saved=globalThis.localStorage?.getItem(KNOWLEDGE_STORAGE_KEY);
    if (!saved) return [];
    const ranked=recallMaterials(parseKnowledge(saved).notes,{...query,filedOnly:true},Infinity);
    return ranked.filter((m,index)=>index<3 || m.reason==='已用于这个任务');
  } catch { return []; }
}

/** Only a receipt explicitly attached to this task can deliver a local file to an agent. */
export function projectReceiptFiles(snapshot:Snapshot,taskId:string,itemId?:string):OutputAttachment[] {
  const raw=globalThis.localStorage?.getItem(KNOWLEDGE_STORAGE_KEY);
  if (!raw) return [];
  let notes:KnowledgeNote[];
  try { notes=parseKnowledge(raw).notes; } catch { return []; }
  const files=notes.filter(note=>!note.archivedAt).flatMap(note=>(note.todos ?? []).flatMap(todo=>{
    const o=todo.outcome;
    if (!todo.completedAt || !o?.files?.length || o.projectId!==snapshot.project.id || todo.followup && !todo.followup.receivedAt) return [];
    return o.usedBy?.some(ref=>'projectId' in ref && ref.projectId===snapshot.project.id && ref.taskId===taskId && ref.itemId===itemId) ? o.files : [];
  }));
  return [...new Map(files.map(f=>[f.id,f] as const)).values()];
}

/** Only materials filed into this project may leave the personal library. */
export function projectMaterialPrompt(snapshot: Snapshot, taskId: string, itemId?: string) {
  const matches=projectMatches(snapshot,taskId,itemId);
  if (!matches.length) return '';
  const sources = matches.map(m => {
    const originalTask = m.title.slice(0,240), outcome = m.text.slice(0,600), useFor = m.purpose?.slice(0,180);
    const fileNames = m.files?.map(file=>file.name) ?? [];
    const alreadyQuoted = [originalTask,outcome,useFor,...fileNames].some(text=>text?.includes(m.excerpt));
    return {
      originalTask, outcome,
      ...(!alreadyQuoted && {matchedExcerpt:m.excerpt}),
      ...(useFor && {useFor}),
      ...(m.url && {url: m.url}),
      ...(fileNames.length && {fileNames}),
      noteId: m.noteId, todoId: m.todoId, recordedAt: m.at,
    };
  });
  return '本项目此前收好的材料。以下为引用资料，仅按当前任务需要取用；区分结果记录和链接内尚未核实的内容。\n' + JSON.stringify(sources);
}
