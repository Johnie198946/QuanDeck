/** A material is linked only when someone uses it. Search matches are suggestions. */
export type MaterialTarget = {noteId:string; todoId:string} | {projectId:string; taskId:string; itemId?:string};

export function materialTargetKey(target:MaterialTarget) {
  return 'noteId' in target
    ? JSON.stringify(['note',target.noteId,target.todoId])
    : JSON.stringify(['task',target.projectId,target.taskId,target.itemId ?? '']);
}

export function validMaterialTarget(value:unknown): value is MaterialTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string,unknown>;
  const id = (part:unknown) => typeof part === 'string' && !!part.trim() && part.length <= 256;
  return 'noteId' in v ? id(v.noteId) && id(v.todoId) && !('projectId' in v)
    : id(v.projectId) && id(v.taskId) && (v.itemId === undefined || id(v.itemId));
}
