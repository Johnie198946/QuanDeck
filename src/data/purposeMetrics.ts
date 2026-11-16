import type { Snapshot } from './types';
import { dayBounds, dateInZone, intervalRange, rangeMinutes, visibleIntervals } from './timeline';
export function purposeMetrics(snapshot: Snapshot) {
  const zone = snapshot.project.timeZone ?? 'Asia/Shanghai';
  const buckets = { discussion: { minutes: 0, tokens: null as number | null }, execution: { minutes: 0, tokens: null as number | null }, manual: { minutes: 0, tokens: null as number | null } };
  const ranges: Record<keyof typeof buckets, [number, number][]> = { discussion: [], execution: [], manual: [] };
  const sessionFor = (id: string) => snapshot.sessions[id] ?? Object.values(snapshot.sessions).find(session => session.subAgents.some(child => child.sessionRef === id));
  for (const interval of visibleIntervals(snapshot)) {
    const kind = sessionFor(interval.sessionId)?.runtime?.purpose === 'discussion' ? 'discussion' : 'execution';
    ranges[kind].push(intervalRange(interval, snapshot));
  }
  const [dayStart, dayEnd] = dayBounds(snapshot.date, zone);
  for (const plan of snapshot.plans) for (const [start, end] of [...(plan.manualActual ?? []), ...(plan.manualStartedAt ? [[plan.manualStartedAt, new Date().toISOString()]] : [])]) {
    ranges.manual.push([Math.max(dayStart, Date.parse(start)), Math.min(dayEnd, Date.parse(end))]);
  }
  const counted = new Set<string>();
  for (const session of Object.values(snapshot.sessions)) {
    const key = session.source ? `${session.source.connectionId}:${session.source.sessionId}` : session.id;
    if (counted.has(key) || session.linkedAsHistory) continue; counted.add(key);
    const kind = session.runtime?.purpose === 'discussion' ? 'discussion' : 'execution';
    const samples = session.runtime?.usageSamples?.filter(sample => dateInZone(Date.parse(sample.at), zone) === snapshot.date && sample.delta != null) ?? [];
    if (samples.length) buckets[kind].tokens = (buckets[kind].tokens ?? 0) + samples.reduce((n, sample) => n + sample.delta!, 0);
  }
  for (const kind of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[kind].minutes = rangeMinutes(ranges[kind]);
  return buckets;
}
