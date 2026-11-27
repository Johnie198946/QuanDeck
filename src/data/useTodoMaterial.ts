import { mutateKnowledge } from './knowledgeStore';
import { materialTargetKey, validMaterialTarget, type MaterialTarget } from './materialUse';

export async function useTodoMaterial(noteId:string,todoId:string,expectedAt:string,target:MaterialTarget,used:boolean) {
  if (!validMaterialTarget(target)) throw Error('请选择要使用材料的任务');
  await mutateKnowledge(library => {
    const note = library.notes.find(n=>n.id===noteId && !n.archivedAt);
    const todo = note?.todos?.find(t=>t.id===todoId);
    const outcome = todo?.outcome;
    if (!outcome || !todo.completedAt || outcome.at!==expectedAt || todo.followup && !todo.followup.receivedAt)
      throw Error('材料已经变化，请重新打开');
    const sourceProjects = new Set(note?.projectQuotes?.filter(q=>q.text===todo.text && q.lineIndex===todo.lineIndex).map(q=>q.projectId));
    if ('noteId' in target) {
      if (target.noteId===noteId && target.todoId===todoId) throw Error('请选择其他待办');
      const dest=library.notes.find(n=>!n.archivedAt && n.id===target.noteId);
      const row=dest?.todos?.find(t=>t.id===target.todoId);
      if (!row) throw Error('这一条待办已移除');
      const projects=new Set(dest?.projectQuotes?.filter(q=>q.text===row.text && q.lineIndex===row.lineIndex).map(q=>q.projectId));
      if (used && outcome.projectId && projects.size && !projects.has(outcome.projectId)) throw Error('这份材料属于另一个项目');
    } else if (used) {
      if (outcome.projectId ? outcome.projectId!==target.projectId : sourceProjects.size && !sourceProjects.has(target.projectId)) throw Error('这份材料属于另一个项目');
      outcome.projectId=target.projectId;
    }
    const key=materialTargetKey(target);
    const uses=(outcome.usedBy ?? []).filter(previous=>materialTargetKey(previous)!==key);
    if (used) uses.push(target);
    if (uses.length) outcome.usedBy=uses;
    else delete outcome.usedBy;
  });
}
