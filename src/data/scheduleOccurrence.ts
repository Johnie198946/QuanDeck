import { carriedScheduleAt, type AgendaEntry } from './agendaSchedule';
import { dayBounds } from './timeline';

/** Keep the original due date visible in history. Overdue entries also appear on today or the day of completion. */
export function scheduleOccurrence(entry: AgendaEntry, date: string, today: string, zone: string) {
  const [start, end] = dayBounds(date, zone);
  const hasDuration = entry.end !== undefined && entry.end > entry.at;
  const overlaps = entry.at < end && (hasDuration ? entry.end! > start : entry.at >= start);
  // Keep the original booking in history. On a different completion day show the real
  // instant it was closed, whether it was completed early or late.
  const finished = Date.parse(entry.completedAt ?? '');
  if (!overlaps && entry.done && finished >= start && finished < end)
    return {entry, at:finished, until:undefined};
  const carry = !overlaps && entry.at < start && !entry.done && date === today;
  if (!overlaps && !carry) return;
  const at = carry ? carriedScheduleAt(entry.at, date, zone) : Math.max(start, entry.at);
  const until = hasDuration && carry ? at + entry.end! - entry.at : entry.end;
  return {entry, at, until};
}

export function occurrences(entries: AgendaEntry[], date: string, today: string, zone: string) {
  return entries.flatMap(entry => scheduleOccurrence(entry, date, today, zone) ?? [])
    .sort((a,b) => Number(a.entry.done) - Number(b.entry.done) || a.at - b.at || a.entry.key.localeCompare(b.entry.key));
}
