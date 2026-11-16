import type { Snapshot } from './types';
import { dateInZone, dayBounds, timeInZone, timelinePlanTotals } from './timeline';
import { formatDuration } from './format';

/** Date navigation is a view over the ledger, never a mutation of its clock or intervals. */
export function scheduleDayView(source: Snapshot, selectedDate: string | null, clock: number): Snapshot {
  const zone = source.project.timeZone ?? 'Asia/Shanghai';
  const date = selectedDate ?? dateInZone(clock, zone);
  return { ...source, date, now: timeInZone(clock, zone), dateLabel: scheduleDateLabel(date) };
}
/** Opening a previously closed sheet must compare against fresh wall time, not its paused UI clock. */
export function initialScheduleDate(source: Snapshot, requested: string | undefined, clock: number): string | null {
  return requested && requested !== dateInZone(clock, source.project.timeZone ?? 'Asia/Shanghai') ? requested : null;
}
export function scheduleDateLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
}
export function scheduleDuration(minutes: number) {
  return minutes > 0 && minutes < .5 ? '<1m' : formatDuration(minutes);
}
/** The hand represents wall time; source watermarks are exclusively execution evidence. */
export function scheduleClock(source: Snapshot, clock: number) {
  const zone = source.project.timeZone ?? 'Asia/Shanghai', [start, end] = dayBounds(source.date, zone);
  const today = dateInZone(clock, zone), isToday = source.date === today;
  return { today, isToday, position: isToday ? (clock - start) / (end - start) * 1440 : null,
    label: isToday ? timeInZone(clock, zone) : source.date.slice(5).replace('-', '/') };
}
export function latestExecutionDay(source: Snapshot): string | null {
  const timeline = source.timeline;
  if (!timeline) return null;
  let latest = -Infinity;
  for (const interval of timeline.intervals) {
    const start = Date.parse(interval.start), end = Date.parse(interval.end ?? interval.observedThrough ?? timeline.asOf);
    // End is exclusive: a run ending at midnight belongs to the previous day.
    if (Number.isFinite(start + end) && end > start) latest = Math.max(latest, end - 1);
  }
  return Number.isFinite(latest) ? dateInZone(latest, source.project.timeZone ?? 'Asia/Shanghai') : null;
}
export function scheduleDayStatus(source: Snapshot, clock: number) {
  const totals = timelinePlanTotals(source), { isToday } = scheduleClock(source, clock);
  const sessions = Object.values(source.sessions), latestDate = latestExecutionDay(source);
  const running = sessions.filter(session => session.status === 'running' && !session.runtime?.disconnected).length;
  const paused = sessions.filter(session => session.status === 'paused').length;
  const waiting = sessions.filter(session => ['waiting_reply', 'waiting_permission'].includes(session.status)).length;
  const prefix = isToday ? '今天' : '这一天';
  const message = totals.actual > 0 ? '实际用时来自执行记录，暂停和等待不计时。'
    : isToday && running ? 'Agent 已开始，等待执行时间回执。'
    : `${prefix}尚无执行记录。${isToday && paused ? `${paused} 个会话已暂停，暂停期间不计时。` : isToday && waiting ? 'Agent 正在等待回复，等待期间不计时。' : ''}`;
  return { ...totals, message, latestDate, running, paused, waiting };
}
