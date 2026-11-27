import type { KnowledgeNote } from './knowledgeNotes';
import type { ScheduleProgress } from './scheduleProgress';
import { dateInZone, dayBounds, instant, planFinished, timeInZone } from './timeline';
import type { Snapshot } from './types';

export type AgendaEntry = {
  key: string;
  title: string;
  source: string;
  /** Original due/start instant. Carrying a row forward never rewrites the source schedule. */
  at: number;
  end?: number;
  done: boolean;
  completedAt?: string;
  progress?: ScheduleProgress[];
} & ({ noteId: string; todoId: string } | { projectId: string; planId: string; taskId?: string });

export function scheduleEntries(notes: KnowledgeNote[], projects: Snapshot[]): AgendaEntry[] {
  const entries: AgendaEntry[] = [];
  for (const note of notes) {
    for (const todo of Array.isArray(note.todos) ? note.todos : []) {
      if (!todo?.id || typeof todo.text !== 'string') continue;
      const at = Date.parse(todo.dueAt);
      if (!Number.isFinite(at)) continue;
      entries.push({ key: 'note:' + note.id + ':' + todo.id, noteId: note.id, todoId: todo.id,
        title: todo.text, source: note.title || '未命名笔记', at, done: !!todo.completedAt, completedAt: todo.completedAt, progress: todo.progress });
    }
  }
  for (const project of projects) {
    if (project.project.deletedAt) continue;
    for (const plan of project.plans) {
      if (plan.cancelled) continue;
      let at: number;
      try { at = Date.parse(instant(plan.start, plan.date ?? project.date, project.project.timeZone)); }
      catch { continue; } // One obsolete time, including a skipped DST hour, cannot hide other items.
      if (!Number.isFinite(at)) continue;
      const task = plan.taskId ? project.tasks[plan.taskId] : undefined;
      const item = plan.taskId && plan.workItemId ? project.orchestrations?.[plan.taskId]?.items[plan.workItemId] : undefined;
      if (plan.taskId && !task || plan.workItemId && !item || item?.status === 'cancelled') continue;
      const completion = item ? item.completedAt : task?.completion?.at;
      // A legacy completion recorded only as HH:mm has no reliable calendar day.
      const completedAt = completion && /^\d{4}-\d\d-\d\dT/.test(completion) && Number.isFinite(Date.parse(completion)) ? completion : undefined;
      entries.push({ key: 'plan:' + project.project.id + ':' + plan.id, projectId: project.project.id, planId: plan.id, taskId: plan.taskId,
        title: item?.title ?? task?.title ?? plan.title, source: project.project.name, at, end: at + plan.minutes * 60000,
        done: planFinished(plan, project), completedAt, progress: plan.progress });
    }
  }
  return entries.sort((a, b) => Number(a.done) - Number(b.done) || a.at - b.at || a.key.localeCompare(b.key));
}

export function overdueScheduleDays(at: number, now: number, zone: string) {
  return Math.max(0, (Date.parse(dateInZone(now, zone)) - Date.parse(dateInZone(at, zone))) / 86400000);
}

export function carriedScheduleAt(at: number, day: string, zone: string) {
  if (dateInZone(at, zone) >= day) return at;
  const time = timeInZone(at, zone);
  try { return Date.parse(instant(time, day, zone)); }
  catch {
    // A clock can skip a whole hour when daylight saving starts. Use the first available minute after the gap.
    const [start, end] = dayBounds(day, zone);
    for (let t = start; t < end; t += 60000) if (timeInZone(t, zone) > time) return t;
    return end;
  }
}
