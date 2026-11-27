import type { ProjectInput } from './projectStorage';
import type { ProjectAnalysis } from './projectAnalysis';
import type { TaskDraft } from './types';
import { readPlanTasks } from './projectWorkflow';

export interface ProjectIntake {
  name: string;
  context: string;
  goal: string;
  deadline: string;
  owner: string;
  files: File[];
}

export const projectFileInputs = (files: File[]) =>
  Promise.all(files.map(async file => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() })));

export interface CreationDraft extends ProjectIntake {
  id: string;
  tasks: TaskDraft[];
  supplement: string;
}
export type CreationStep = 1 | 2 | 3;
export interface SavedProjectDraft extends CreationDraft {
  workspacePath?: string;
  step?: CreationStep;
  furthest?: CreationStep;
  analysis?: ProjectAnalysis;
  needsUpdate?: boolean;
  omitted?: string[];
  selected?: string;
}
export const emptyProjectDraft = (): CreationDraft => ({id:crypto.randomUUID(),name:'',goal:'',deadline:'',owner:'',files:[],tasks:[],context:'',supplement:''});
// Finish a departing page's write before the next project form reads the draft.
let draftQueue: Promise<unknown> = Promise.resolve();
function draftStorage(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest) {
  const request = draftQueue.then(() => runDraftTransaction(mode,work));
  draftQueue = request.catch(()=>{});
  return request;
}
function runDraftTransaction(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest) {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('quandeck-project-create-draft',1);
    open.onupgradeneeded = () => open.result.createObjectStore('draft');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('draft',mode);
      const request = work(tx.objectStore('draft'));
      tx.oncomplete = () => {db.close();resolve(request.result);};
      tx.onerror = tx.onabort = () => {db.close();reject(tx.error);};
    };
  });
}
export function storeProjectDraft(key: string, draft: SavedProjectDraft) {
  return draftStorage('readwrite',store=>store.put(draft,key));
}

export async function readProjectDraft(key: string) {
  return await draftStorage('readonly',store=>store.get(key)) as SavedProjectDraft | undefined;
}

export function clearProjectDraft(key: string) {
  return draftStorage('readwrite',store=>store.delete(key));
}

export async function projectDraftInput(draft: SavedProjectDraft, workspacePath?: string): Promise<ProjectInput> {
  const background = [draft.context.trim(),draft.supplement.trim()].filter(Boolean).join('\n\n');
  if (background.length > 16000) throw Error('背景和补充合计最多 16000 字，请精简后重试。');
  if (draft.analysis && draft.needsUpdate) throw Error('请先更新需求理解，再创建项目。');
  if (!draft.name.trim() || !draft.goal.trim()) throw Error('请填写项目名称和目标');
  const labels = new Map(draft.tasks.map(task=>[task.key,task]));
  const included = (task:TaskDraft):boolean => task.include && (!task.parentKey || !!labels.get(task.parentKey) && included(labels.get(task.parentKey)!));
  const tasks = readPlanTasks(draft.tasks.filter(included).map(task=>({...task,expected:task.expected.trim() || '按任务标题核对交付'}))) ?? [];
  const analysis = draft.analysis;
  return {
    name:draft.name.trim(),description:draft.goal.trim(),ownerName:draft.owner.trim(),deadline:draft.deadline,
    ...(workspacePath && {workspacePath}),
    setup:{requestId:draft.id,tasks,background,files:await projectFileInputs(draft.files),
      ...(analysis && {understanding:{summary:analysis.summary,sourceId:analysis.sourceId,attachments:analysis.attachments ?? [],
        recommendations:(analysis.recommendations ?? []).filter(row=>!draft.omitted?.includes(row.id))}})},
  };
}
