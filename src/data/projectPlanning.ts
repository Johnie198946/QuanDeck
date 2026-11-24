import { taskKey } from './collaboration';
import type { Snapshot } from './types';

export const priorityLevels = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type TaskPriority = typeof priorityLevels[number];
export interface PlannedTask {
  start?: string;
  end?: string;
  priority?: TaskPriority;
  information?: string;
  conclusion?: string;
  deliverable?: string;
  researchSourceId?: string;
  milestone?: boolean;
}
export interface ProjectPlanning {
  revision: number;
  tasks: Record<string, PlannedTask>;
  order?: string[];
  changes?: {eventId:string;key:string;fields:PlannedTask;previous?:PlannedTask}[];
}
export type PlanningEdit =
  | { kind: 'task'; taskId: string; itemId?: string; fields: PlannedTask; expectedRevision: number; expectedSpecRevision?: number; criteria?: string[] }
  | { kind: 'order'; order: string[]; expectedRevision: number };

const dayMs = 86400000;
export function dateDay(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const day = Date.parse(value + 'T00:00:00Z') / dayMs;
  if (Number.isFinite(day) && dayText(day) === value) return day;
}
export function dayText(day: number) {
  return new Date(day * dayMs).toISOString().slice(0, 10);
}
export function optionalDate(value?: string) {
  if (!value) return undefined;
  if (dateDay(value) === undefined) throw Error('请选择有效日期');
  return value;
}
export function planningTask(snapshot: Snapshot, taskId: string, itemId?: string): PlannedTask {
  const own = snapshot.projectPlanning?.tasks[taskKey(taskId, itemId)];
  const oldDue = !itemId ? snapshot.tasks[taskId]?.due?.date : undefined;
  return own ?? (oldDue && dateDay(oldDue) !== undefined ? { end: oldDue } : {});
}
export function validatePlannedTask(value: PlannedTask): PlannedTask {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('任务信息无效');
  const start = optionalDate(value.start), end = optionalDate(value.end);
  if (start && end && end < start) throw Error('结束日期不能早于开始日期');
  const priority = value.priority || undefined;
  if (priority && !priorityLevels.includes(priority)) throw Error('任务优先级无效');
  const field = (text?: string) => {
    if (typeof text === 'string' && text.length <= 8000) return text.trim() || undefined;
    if (text !== undefined) throw Error('每项任务信息最多 8000 字');
  };
  if(value.milestone!==undefined && typeof value.milestone!=='boolean') throw Error('里程碑标记无效');
  const source = field(value.researchSourceId);
  return { start, end, priority, information: field(value.information), conclusion: field(value.conclusion), deliverable: field(value.deliverable), researchSourceId:source?.slice(0,200),milestone:value.milestone || undefined };
}

export type GanttScale = 'day' | 'week' | 'month';
export interface GanttColumn { label: string; start: number; end: number }
function monthStart(day: number, offset = 0) {
  const date = new Date(day * dayMs);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.valueOf() / dayMs;
}
export function ganttColumns(day: number, scale: GanttScale, offset = 0): GanttColumn[] {
  const label = (day: number) => dayText(day).slice(5).replace('-', '/');
  if (scale === 'month') return Array.from({length: 6}, (_, i) => {
    const start = monthStart(day, offset * 6 + i);
    return { label: dayText(start).slice(0, 7), start, end: monthStart(start, 1) };
  });
  const step = scale === 'week' ? 7 : 1;
  const count = scale === 'week' ? 6 : 14;
  const base = scale === 'week' ? day - ((new Date(day * dayMs).getUTCDay() + 6) % 7) : day;
  return Array.from({length:count}, (_, i) => {
    const start = base + (offset * count + i) * step;
    return { label: step === 1 ? label(start) : label(start) + '–' + label(start + 6), start, end: start + step };
  });
}
export function shiftPlannedTask(task: PlannedTask, delta: number, edge: 'move' | 'start' | 'end'): PlannedTask {
  const start = dateDay(task.start);
  const end = dateDay(task.end);
  if (start === undefined || end === undefined) return task;
  const nextStart = edge === 'end' ? start : Math.min(start + delta, edge === 'move' ? end + delta : end);
  const nextEnd = edge === 'start' ? end : Math.max(end + delta, nextStart);
  return {...task, start: dayText(nextStart), end: dayText(nextEnd)};
}
