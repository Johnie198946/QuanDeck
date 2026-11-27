import type { AgendaEntry } from './agendaSchedule';
import { dateInZone, instant, nextDate } from './timeline';

type Phase = 'warning' | 'due' | 'overdue';
export type AgendaAlert = { entry: AgendaEntry; phase: Phase };
export type ReminderLedger = Record<string, { due: number; sent: number }>;

/** Evaluate the latest applicable slot for each item. After sleep/restart, deliver one catch-up
 * per item, even if several slots elapsed. Ledger entries survive relaunch and are bounded by
 * unfinished schedule items. A changed original deadline starts a fresh reminder sequence. */
export function agendaReminders(entries: AgendaEntry[], previous: ReminderLedger, now: number, zone: string) {
  const ledger: ReminderLedger = Object.create(null);
  const alerts: AgendaAlert[] = [];
  let nextAt = Infinity;
  if (!entries.some(entry => !entry.done)) return { ledger, alerts, changed: Object.keys(previous).length > 0, nextAt };
  const today = dateInZone(now, zone);
  // Compute the surrounding wall-clock slots once for every item, including on short/long days.
  const slots = [nextDate(today, -1), today, nextDate(today)].flatMap(day =>
    ['08:00', '18:00'].map(time => Date.parse(instant(time, day, zone))));
  for (const entry of entries) {
    if (entry.done) continue;
    const due = entry.at;
    const warning = due - 3600000;
    let latest = warning;
    let phase: Phase = 'warning';
    if (now >= due) {
      latest = due;
      phase = 'due';
      for (const slot of slots) {
        if (slot <= due) continue;
        if (slot > now) { nextAt = Math.min(nextAt, slot); break; }
        latest = slot;
        phase = 'overdue';
      }
    } else nextAt = Math.min(nextAt, now < warning ? warning : due);
    const last = previous[entry.key];
    if (last?.due === due) ledger[entry.key] = last;
    if (latest <= now && (!ledger[entry.key] || ledger[entry.key].sent < latest)) {
      ledger[entry.key] = {due, sent:latest};
      alerts.push({entry, phase});
    }
  }
  // Compare by key; reordering the user's list doesn't require a database write.
  const changed = alerts.length > 0 || Object.keys(previous).length !== Object.keys(ledger).length;
  return { ledger, alerts, changed, nextAt };
}
