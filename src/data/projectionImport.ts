import { applyCollaboration, deriveLedger, ensureCollaboration, hashText } from './collaboration';
import type { Snapshot } from './types';

export interface RevisionRow { key: string; version: number; specRevision: number; goal: string; criteria: string[] }
export interface RevisionFile { schema: 'quandeck.task-revisions.v1'; projectId: string; sourceSequence: number; baseHash: string; tasks: RevisionRow[] }
export interface RevisionPreview { digest: string; changes: { key: string; title: string; before: RevisionRow; after: RevisionRow }[] }
const rows = (snapshot: Snapshot): RevisionRow[] => deriveLedger(snapshot).map(row => ({ key: row.key, version: row.version, specRevision: row.specRevision, goal: row.spec.goal, criteria: [...row.spec.criteria] })).sort((a,b)=>a.key.localeCompare(b.key));
export function exportRevisionFile(snapshot: Snapshot): string {
  const tasks=rows(snapshot);
  return JSON.stringify({schema:'quandeck.task-revisions.v1',projectId:snapshot.project.id,sourceSequence:ensureCollaboration(structuredClone(snapshot)).sequence,baseHash:hashText(JSON.stringify(tasks)),tasks} satisfies RevisionFile,null,2);
}
const exact = (object: unknown, keys: string[]) => !!object && typeof object==='object' && !Array.isArray(object) && Object.keys(object).length===keys.length && Object.keys(object).every(key=>keys.includes(key));
export function previewRevisionImport(snapshot: Snapshot, raw: string): RevisionPreview {
  if(typeof raw!=='string'||raw.length>2_000_000)throw Error('修订文件过大');
  let value: RevisionFile;try {value=JSON.parse(raw);}catch {throw Error('修订文件不是有效 JSON');}
  if(!exact(value,['schema','projectId','sourceSequence','baseHash','tasks'])||value.schema!=='quandeck.task-revisions.v1'||value.projectId!==snapshot.project.id||!Array.isArray(value.tasks))throw Error('修订文件的格式或项目不匹配');
  const baseline=JSON.parse(exportRevisionFile(snapshot)) as RevisionFile;
  if(value.sourceSequence!==baseline.sourceSequence||value.baseHash!==baseline.baseHash)throw Error('项目已更新，请重新导出后修改');
  if(value.tasks.length!==baseline.tasks.length||new Set(value.tasks.map(row=>row?.key)).size!==value.tasks.length)throw Error('修订文件不能增删任务');
  const c=ensureCollaboration(structuredClone(snapshot));
  const changes: RevisionPreview['changes']=[];
  for(const after of value.tasks){
    if(!exact(after,['key','version','specRevision','goal','criteria']))throw Error('只允许修改目标和验收条件');
    const before=baseline.tasks.find(row=>row.key===after.key);
    if(!before||before.version!==after.version||before.specRevision!==after.specRevision)throw Error('任务身份或版本被修改');
    if(typeof after.goal!=='string'||!after.goal.trim()||after.goal.length>20000||!Array.isArray(after.criteria)||!after.criteria.length||after.criteria.length>100||after.criteria.some(item=>typeof item!=='string'||!item.trim()||item.length>2000))throw Error('目标或验收条件无效');
    if(after.goal!==before.goal||JSON.stringify(after.criteria)!==JSON.stringify(before.criteria)){
      if(c.tasks[after.key].activeRunId)throw Error('仍有任务执行中，请先停止后修订');
      changes.push({key:after.key,title:c.tasks[after.key].title,before,after});
    }
  }
  return {digest:hashText(raw),changes};
}
/** Preview approval is content-bound and checked again inside the repository transaction. */
export function applyRevisionImport(snapshot: Snapshot, raw: string, expectedDigest: string): RevisionPreview {
  const preview=previewRevisionImport(snapshot,raw);
  if(!expectedDigest||preview.digest!==expectedDigest)throw Error('文件已变化，请重新预览');
  const next=structuredClone(snapshot);
  for(const change of preview.changes){
    const task=ensureCollaboration(next).tasks[change.key];
    const result=applyCollaboration(next,{type:'revise_task',projectId:next.project.id,taskId:task.taskId,workItemId:task.workItemId,expectedVersion:task.version,idempotencyKey:`revision-import:${preview.digest}:${change.key}`,payload:{goal:change.after.goal,criteria:change.after.criteria,reason:'用户预览并采用修订文件'}},{kind:'human'});
    if(!result.ok)throw Error(result.message??'修订未采用');
  }
  Object.assign(snapshot,next);
  return preview;
}
