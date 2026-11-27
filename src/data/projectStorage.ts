import type { Agent, CommandResult, Snapshot, TaskDraft } from './types';
import { dateInZone, timeInZone } from './timeline';
import { MAX_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS } from './taskAttachments';

export const LOCAL_PROJECTS_KEY = 'quandeck.projects.v1';
export interface ProjectFileInput { name: string; type: string; bytes: ArrayBuffer }
export interface ProjectSetup {
  requestId: string;
  background?: string;
  understanding?: import('./projectUnderstanding').ProjectUnderstanding;
  tasks: TaskDraft[];
  files?: ProjectFileInput[];
}
export interface ProjectInput { name: string; requestId?: string; description?: string; color?: string; workspacePath?: string; deadline?: string; ownerName?: string; setup?: ProjectSetup }
export interface ProjectCreateResult extends CommandResult {
  projectId?: string;
  conflictingProject?: {id: string; name: string};
}

function validateProjectFiles(files: ProjectFileInput[]) {
  if (!Array.isArray(files) || files.length > MAX_TASK_ATTACHMENTS || files.some(file => !file || typeof file.name !== 'string' || typeof file.type !== 'string' ||
    file.name.length > 255 || !file.name.trim() || /[\0\r\n]/.test(file.name) || file.type.length > 255 ||
    !(file.bytes instanceof ArrayBuffer) || file.bytes.byteLength > MAX_ATTACHMENT_BYTES) ||
    files.reduce((total,file)=>total+file.bytes.byteLength,0) > 50*1024*1024) throw Error('项目附件最多 20 件，每件最多 25 MB，合计最多 50 MB');
}

async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function projectCreationFingerprint(input: ProjectInput) {
  const files = input.setup?.files ?? [];
  validateProjectFiles(files);
  const content = {
    name: input.name.trim(), description: input.description?.trim() || '', owner: input.ownerName?.trim() || '',
    deadline: input.deadline || '', color: input.color || '#075AF2', workspacePath: input.workspacePath || '',
    hasSetup: !!input.setup, background: input.setup?.background?.trim() || '', tasks: input.setup?.tasks ?? [], understanding: input.setup?.understanding,
    files: await Promise.all(files.map(async file=>({name:file.name,type:file.type,hash:await sha256(file.bytes)}))),
  };
  const sorted = JSON.stringify(content,(_key,value)=>value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value);
  return sha256(new TextEncoder().encode(sorted).buffer);
}
export interface ProjectLibrary {
  schema: 1; activeProjectId: string | null; projects: Record<string, Snapshot>;
  agents: Agent[]; defaultAgent: string;
}
export function freshLibrary(): ProjectLibrary {
  return { schema: 1, activeProjectId: null, projects: {}, agents: [], defaultAgent: '' };
}
export function createEmptySnapshot(project: Snapshot['project'] = { id: '', name: '' }): Snapshot {
  const timeZone = project.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Shanghai';
  const date = dateInZone(Date.now(), timeZone);
  const now = timeInZone(Date.now(), timeZone);
  return { version: 1, date, now,
    dateLabel: new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()),
    project: { ...project, timeZone }, journal: { title: '项目任务', summary: '', blocks: [] },
    tasks: {}, sessions: {}, agents: [], defaultAgent: '', autoJournal: true, plans: [], activity: [], recent: [],
    stats: { collabMinutes: 0, wallMinutes: 0, tokens: 0, sessions: 0 }, lastSync: now,
    orchestrations: {}, ideaPlans: {}, outputs: {},
  };
}
interface ProjectPartitionStorage {
  readProjectLibrary(): {library: ProjectLibrary; revision:number};
  writeProjectLibraryChanges(input:{metadata:Omit<ProjectLibrary,'projects'>;projectIds:string[];updates:Record<string,string>;removed:string[];expectedRevision:number}):number;
}
const persistedRevisions = new WeakMap<ProjectLibrary,number>();
const partitionStorage = () => {
  const storage=globalThis.localStorage as (Storage & Partial<ProjectPartitionStorage>) | undefined;
  return typeof storage?.readProjectLibrary==='function'&&typeof storage.writeProjectLibraryChanges==='function'?storage as Storage & ProjectPartitionStorage:undefined;
};
export function readProjectLibrary(): ProjectLibrary {
  const partitions=partitionStorage();
  const loaded=partitions?.readProjectLibrary();
  const raw=loaded?undefined:globalThis.localStorage?.getItem(LOCAL_PROJECTS_KEY);
  let value:ProjectLibrary;
  try { value=loaded?.library??(raw?JSON.parse(raw):freshLibrary()); } catch { throw new Error('项目数据无法读取，请保留本地数据并从备份恢复。'); }
  if (value.schema !== 1 || !value.projects || !Array.isArray(value.agents)) throw new Error('项目数据版本不受支持，未覆盖原数据。');
  for (const [id, snapshot] of Object.entries(value.projects)) {
    if (snapshot.project?.id !== id || !snapshot.tasks || !snapshot.sessions || !Array.isArray(snapshot.journal?.blocks)) throw new Error('项目记录不完整，未覆盖原数据。');
  }
  if (value.activeProjectId && (!value.projects[value.activeProjectId] || value.projects[value.activeProjectId].project.deletedAt)) value.activeProjectId = Object.keys(value.projects).find(id => !value.projects[id].project.deletedAt) ?? null;
  if(loaded)persistedRevisions.set(value,loaded.revision);
  return value;
}
export function persistProjectLibrary(library: ProjectLibrary, previous?:ProjectLibrary) {
  if (!globalThis.localStorage) throw new Error('本地存储不可用，无法保存项目。');
  try {
    const partitions=partitionStorage();
    if(partitions){
      const {projects,...metadata}=library;
      const updates=Object.fromEntries(Object.entries(projects).filter(([id,snapshot])=>snapshot!==previous?.projects[id]).map(([id,snapshot])=>[id,JSON.stringify(snapshot)]));
      const removed=Object.keys(previous?.projects??{}).filter(id=>!projects[id]);
      const revision=partitions.writeProjectLibraryChanges({metadata,projectIds:Object.keys(projects),updates,removed,expectedRevision:persistedRevisions.get(previous??library)??0});
      persistedRevisions.set(library,revision);
    }else globalThis.localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(library));
  }catch(error){throw new Error(error instanceof Error&&error.message.includes('其他连接')?error.message:'本地存储空间不足或数据校验失败，内容未保存。请先导出备份或重新读取后重试。');}
}
