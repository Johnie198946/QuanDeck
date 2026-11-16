import type { Agent, Snapshot } from './types';
import { dateInZone, timeInZone } from './timeline';

export const LOCAL_PROJECTS_KEY = 'quandeck.projects.v1';
export interface ProjectInput { name: string; description?: string; color?: string }
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
export function readProjectLibrary(): ProjectLibrary {
  const raw = globalThis.localStorage?.getItem(LOCAL_PROJECTS_KEY);
  if (!raw) return freshLibrary();
  let value: ProjectLibrary;
  try { value = JSON.parse(raw); } catch { throw new Error('项目数据无法读取，请保留本地数据并从备份恢复。'); }
  if (value.schema !== 1 || !value.projects || !Array.isArray(value.agents)) throw new Error('项目数据版本不受支持，未覆盖原数据。');
  for (const [id, snapshot] of Object.entries(value.projects)) {
    if (snapshot.project?.id !== id || !snapshot.tasks || !snapshot.sessions || !Array.isArray(snapshot.journal?.blocks)) throw new Error('项目记录不完整，未覆盖原数据。');
  }
  if (value.activeProjectId && (!value.projects[value.activeProjectId] || value.projects[value.activeProjectId].project.deletedAt)) value.activeProjectId = Object.keys(value.projects).find(id => !value.projects[id].project.deletedAt) ?? null;
  return value;
}
export function persistProjectLibrary(library: ProjectLibrary) {
  if (!globalThis.localStorage) throw new Error('本地存储不可用，无法保存项目。');
  try { globalThis.localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(library)); }
  catch { throw new Error('本地存储空间不足，内容未保存。请先导出备份或清理空间后重试。'); }
}
