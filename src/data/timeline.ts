import type { Snapshot, PlanItem, Step } from './types';

export type ExecutionState = 'running' | 'queued' | 'waiting_reply' | 'waiting_permission' | 'done' | 'failed' | 'paused' | 'cancelled';
/** Adapter events must carry offset-qualified timestamps and monotonically increasing sequence per execution. */
export interface ExecutionEvent {
  id: string;
  sequence: number;
  at: string;
  projectId: string;
  executionId: string;
  sessionId: string;
  agentId: string;
  taskId?: string;
  workItemId?: string;
  attemptId?: string;
  status: ExecutionState;
  step?: Step | null;
  tokens?: number | null;
  reply?: { id: string; text: string };
}
export interface ExecutionInterval {
  id: string;
  executionId: string;
  sessionId: string;
  agentId: string;
  taskId?: string;
  workItemId?: string;
  attemptId?: string;
  start: string;
  end: string | null;
  provenance: 'snapshot' | 'event';
  /** A real adapter's last observed instant; unrelated UI writes never extend this range. */
  observedThrough?: string;
}
export interface TimelineState {
  intervals: ExecutionInterval[];
  cursors: Record<string, { sequence: number; at: string; status: ExecutionState }>;
  eventIds?: string[];
  /** Source event watermark; open ranges stop here when source disconnects. */
  asOf: string;
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const boundsCache = new Map<string,[number,number]>();
const instantCache = new Map<string,string>();
function formatter(zone: string) {
  if (!dateFormatters.has(zone)) dateFormatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return dateFormatters.get(zone)!;
}
export function dateInZone(ms: number, zone: string) {
  const p = formatter(zone).formatToParts(ms);
  return `${p.find(v => v.type === 'year')!.value}-${p.find(v => v.type === 'month')!.value}-${p.find(v => v.type === 'day')!.value}`;
}
export function nextDate(date: string, days = 1) { return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
/** Binary search the first instant of a local date: handles 23/25-hour DST days. */
export function dayBounds(date: string, zone = 'Asia/Shanghai'): [number, number] {
  const key = `${date}:${zone}`;
  if (boundsCache.has(key)) return boundsCache.get(key)!;
  const first = (d: string) => {
    const center = Date.parse(`${d}T12:00:00Z`);
    let lo = center - 48 * 3600000, hi = center + 48 * 3600000;
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (dateInZone(m, zone) < d) lo = m; else hi = m; }
    return hi;
  };
  const result: [number,number] = [first(date), first(nextDate(date))];
  boundsCache.set(key,result);
  return result;
}
export function timeInZone(ms: number, zone = 'Asia/Shanghai') {
  if (!timeFormatters.has(zone)) timeFormatters.set(zone,new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return timeFormatters.get(zone)!.format(ms);
}
const isInstant = (value: string) => /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
/** Legacy HH:mm records are scoped to the snapshot date. API records always use ISO instants. */
export function instant(value: string, date: string, zone = 'Asia/Shanghai'): string {
  if (isInstant(value)) return new Date(value).toISOString();
  const key = `${value}:${date}:${zone}`;
  if (instantCache.has(key)) return instantCache.get(key)!;
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error('时间必须是 ISO 时间戳或 HH:mm');
  const [h, m] = value.split(':').map(Number);
  const [start, end] = dayBounds(date, zone);
  if (h === 24 && m === 0) return new Date(end).toISOString();
  if (h > 23 || m > 59) throw new Error('时间超出范围');
  // Most local days are exactly 24 hours. Avoid formatting every intervening minute.
  if (end - start === 86400000) {
    const candidate = start + (h * 60 + m) * 60000;
    if (timeInZone(candidate, zone) === value) {
      const result = new Date(candidate).toISOString();
      instantCache.set(key, result);
      return result;
    }
  }
  // Deterministically select the first matching wall-clock minute on a repeated DST hour.
  for (let t = start; t < end; t += 60000) if (timeInZone(t, zone) === value) { const result = new Date(t).toISOString(); instantCache.set(key,result); return result; }
  throw new Error('该本地时间不存在，请使用带时区的 ISO 时间戳');
}
export function unionRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s,e] of ranges.filter(([s,e]) => e > s && Number.isFinite(s + e)).sort((a,b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(e, last[1]); else out.push([s,e]);
  }
  return out;
}
export const rangeMinutes = (ranges: [number, number][]) => unionRanges(ranges).reduce((sum,[s,e]) => sum + (e-s)/60000, 0);
/** Mutates a cloned snapshot's timeline. Duplicate/stale events cannot reopen or extend an interval. */
export function reduceExecutionEvent(state: TimelineState, event: ExecutionEvent): boolean {
  if (!isInstant(event.at) || !Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error('无效的执行事件：需要 ISO 时间与递增序号');
  if (!event.id || !event.executionId || !['running','queued','waiting_reply','waiting_permission','done','failed','paused','cancelled'].includes(event.status)) throw new Error('无效的执行身份或状态');
  if (event.tokens != null && (!Number.isFinite(event.tokens) || event.tokens < 0)) throw new Error('无效的 token 用量');
  if (state.eventIds?.includes(event.id)) return false;
  const prev = state.cursors[event.executionId];
  if (prev && (event.sequence <= prev.sequence || Date.parse(event.at) < Date.parse(prev.at))) return false;
  const at = new Date(event.at).toISOString();
  const open = state.intervals.find(i => i.executionId === event.executionId && i.end === null);
  if (event.status !== 'running' && open) open.end = at;
  if (event.status === 'running' && !open) {
    state.intervals.push({ id: event.id, executionId: event.executionId, sessionId: event.sessionId, agentId: event.agentId, taskId: event.taskId, workItemId: event.workItemId, attemptId: event.attemptId, start: at, end: null, provenance: 'event' });
  }
  (state.eventIds ??= []).push(event.id);
  state.cursors[event.executionId] = { sequence: event.sequence, at, status: event.status };
  if (Date.parse(at) > Date.parse(state.asOf)) state.asOf = at;
  return true;
}
const normalizedStatus = (s: string): ExecutionState => s === 'archived' ? 'done' : s === 'interrupted' ? 'paused' : s === 'pending' ? 'queued' : s as ExecutionState;
function entities(s: Snapshot) {
  const out: (Omit<ExecutionEvent,'id'|'sequence'|'at'|'projectId'> & { start: string; end?: string })[] = [];
  const represented = new Set<string>();
  for (const orch of Object.values(s.orchestrations ?? {})) {
    for (const a of Object.values(orch.attempts)) {
      const agentId = orch.executors[a.executorId]?.agentId;
      if (!agentId) continue;
      represented.add(a.sessionId);
      out.push({ executionId: `attempt:${a.id}`, sessionId: a.sessionId, agentId, taskId: orch.taskId, workItemId: a.workItemId, attemptId: a.id, status: normalizedStatus(a.status), start: a.startedAt, end: a.endedAt ?? orch.items[a.workItemId]?.waiting?.since ?? orch.syncedAt });
    }
    // The parent session spans coordination and children; its inclusive duration is not added again.
    if (orch.mainSessionId) represented.add(orch.mainSessionId);
  }
  for (const ses of Object.values(s.sessions)) {
    if (!ses.startedAt || represented.has(ses.id)) continue;
    out.push({ executionId: `session:${ses.id}`, sessionId: ses.id, agentId: ses.agentId, taskId: ses.taskId ?? undefined, status: normalizedStatus(ses.status), start: ses.startedAt, end: ses.endedAt ?? ses.lastActivity });
    for (const child of ses.subAgents) out.push({ executionId: `subagent:${child.id}`, sessionId: child.sessionRef, agentId: ses.agentId, taskId: ses.taskId ?? undefined, status: normalizedStatus(child.status), start: child.start, end: child.end ?? ses.lastActivity });
  }
  return out;
}
export function ensureTimeline(s: Snapshot): TimelineState {
  if (s.timeline) return s.timeline;
  const zone = s.project.timeZone ?? 'Asia/Shanghai';
  const asOf = instant(s.now, s.date, zone);
  const timeline: TimelineState = { intervals: [], cursors: {}, asOf };
  const seen = entities(s);
  for (const e of seen) {
    let start = instant(e.start, s.date, zone);
    // HH:mm-only historical records near midnight belong to the preceding date when later than the snapshot clock.
    if (/^\d\d:\d\d$/.test(e.start) && Date.parse(start) > Date.parse(asOf)) start = instant(e.start, nextDate(s.date,-1), zone);
    if (e.status === 'queued') continue;
    let end = e.status === 'running' ? null : instant(e.end ?? s.now, s.date, zone);
    if (end && Date.parse(end) < Date.parse(start)) end = instant(e.end!, nextDate(dateInZone(Date.parse(start),zone)), zone);
    timeline.intervals.push({ ...e, id: `seed:${e.executionId}`, start, end, provenance: 'snapshot' });
    timeline.cursors[e.executionId] = { sequence: 0, at: end ?? start, status: e.status };
  }
  // Preserve historical activity with no indexed session. Live/open legacy spans are replaced by execution records.
  s.activity.forEach((iv, index) => {
    if (iv.end === 'now') return;
    let start = instant(iv.start, s.date, zone), end = instant(iv.end, s.date, zone);
    if (Date.parse(start)>Date.parse(asOf)) start=instant(iv.start,nextDate(s.date,-1),zone);
    if(Date.parse(end)<Date.parse(start))end=instant(iv.end,nextDate(dateInZone(Date.parse(start),zone)),zone);
    if (seen.some(e => e.agentId === iv.agentId && Date.parse(instant(e.start, s.date, zone)) <= Date.parse(start))) return;
    timeline.intervals.push({ id: `legacy:${index}`, executionId: `legacy:${index}`, sessionId: '', agentId: iv.agentId, start, end, provenance: 'snapshot' });
  });
  s.timeline = timeline;
  return timeline;
}
/** Existing sample commands use the same event reducer as future adapter events. */
export function syncTimeline(s: Snapshot, before?: Snapshot, atOverride?: string) {
  const timeline = ensureTimeline(s);
  const zone = s.project.timeZone ?? 'Asia/Shanghai';
  const at = atOverride ?? instant(s.now, s.date, zone);
  const old = new Map(before ? entities(before).map(e => [e.executionId, e]) : []);
  const current = entities(s);
  for (const e of current) {
    const previous = old.get(e.executionId);
    if (before && previous?.status === e.status) continue;
    const cursor = timeline.cursors[e.executionId];
    if (!before && cursor) continue;
    reduceExecutionEvent(timeline, { ...e, projectId: s.project.id, id: `sample:${s.version}:${e.executionId}:${e.status}`, sequence: (cursor?.sequence ?? 0)+1, at, status: e.status });
  }
  for (const [key, prev] of old) if (!current.some(e => e.executionId === key) && timeline.intervals.some(i => i.executionId === key && !i.end)) reduceExecutionEvent(timeline, { ...prev, id:`removed:${s.version}:${key}`, projectId:s.project.id, sequence:(timeline.cursors[key]?.sequence ?? 0)+1, at, status:'cancelled' });
  timeline.asOf = Date.parse(at) > Date.parse(timeline.asOf) ? at : timeline.asOf;
  refreshTimelineStats(s);
}
export interface VisibleInterval extends ExecutionInterval { from: number; to: number; startLabel: string; endLabel: string; minutes: number }
export function visibleIntervals(s: Snapshot): VisibleInterval[] {
  const timeline = s.timeline;
  if (!timeline) return [];
  const zone = s.project.timeZone ?? 'Asia/Shanghai';
  const [dayStart, dayEnd] = dayBounds(s.date, zone);
  return timeline.intervals.flatMap(i => {
    const from = Math.max(dayStart, Date.parse(i.start));
    const to = Math.min(dayEnd, Date.parse(i.end ?? i.observedThrough ?? timeline.asOf));
    if (!(to > from)) return [];
    return [{...i, from: (from-dayStart)/(dayEnd-dayStart)*1440, to:(to-dayStart)/(dayEnd-dayStart)*1440, minutes:(to-from)/60000, startLabel:timeInZone(from,zone), endLabel:to === dayEnd ? '24:00' : timeInZone(to,zone)}];
  });
}
export function intervalRange(i: VisibleInterval, s: Snapshot): [number,number] {
  const [start,end] = dayBounds(s.date,s.project.timeZone ?? 'Asia/Shanghai');
  return [start+i.from/1440*(end-start),start+i.to/1440*(end-start)];
}
/** Remove child-session coverage from inclusive parent sessions, while retaining parallel child work. */
export function executionMinutesByAgent(s: Snapshot): Map<string,number> {
  const visible=visibleIntervals(s);
  const groups=new Map<string,{agentId:string;ranges:[number,number][]}>();
  const parents=new Map<string,string>();
  for(const o of Object.values(s.orchestrations ?? {})) for(const a of Object.values(o.attempts)) if(a.parentSessionId && a.parentSessionId!==a.sessionId) parents.set(a.sessionId,a.parentSessionId);
  for(const ses of Object.values(s.sessions)) for(const child of ses.subAgents) {
    const parent=ses.subAgents.find(v=>v.id===child.parentId)?.sessionRef ?? ses.id;
    if(child.sessionRef!==parent)parents.set(child.sessionRef,parent);
  }
  for(const i of visible) {
    const key=i.sessionId || i.executionId;
    if(!groups.has(key))groups.set(key,{agentId:i.agentId,ranges:[]});
    groups.get(key)!.ranges.push(intervalRange(i,s));
  }
  const totals=new Map<string,number>();
  for(const [key,group] of groups) {
    let own=unionRanges(group.ranges);
    const children=unionRanges([...parents].filter(([,parent])=>parent===key).flatMap(([child])=>groups.get(child)?.ranges ?? []));
    for(const [a,b] of children) own=own.flatMap(([x,y]):[number,number][]=>b<=x||a>=y?[[x,y]]:[...(a>x?[[x,a] as [number,number]]:[]),...(b<y?[[b,y] as [number,number]]:[])]);
    totals.set(group.agentId,(totals.get(group.agentId) ?? 0)+rangeMinutes(own));
  }
  return totals;
}
export function refreshTimelineStats(s: Snapshot) {
  const visible = visibleIntervals(s);
  s.stats.wallMinutes = rangeMinutes(visible.map(i=>intervalRange(i,s)));
  const agentMinutes=executionMinutesByAgent(s);
  s.stats.collabMinutes = [...agentMinutes.values()].reduce((a,b)=>a+b,0);
  for(const a of s.agents) if(a.today.minutes !== null) a.today.minutes=agentMinutes.get(a.id) ?? 0;
  s.activity=visible.map(i=>({agentId:i.agentId,start:i.startLabel,end:i.endLabel}));
}
/** A subtask schedule includes nested work, but never its parent or siblings. */
export function planIncludesInterval(plan: PlanItem, interval: Pick<ExecutionInterval, 'taskId' | 'workItemId'>, s: Snapshot) {
  if (!plan.taskId || interval.taskId !== plan.taskId) return false;
  if (!plan.workItemId) return true;
  const items = s.orchestrations?.[plan.taskId]?.items;
  const seen = new Set<string>();
  let id = interval.workItemId;
  while (id && !seen.has(id)) {
    if (id === plan.workItemId) return true;
    seen.add(id);
    id = items?.[id]?.parentTaskId;
  }
  return false;
}
export function plannedRange(plan: PlanItem, s: Snapshot): [number, number] | null {
  if (plan.cancelled) return null;
  const zone = s.project.timeZone ?? 'Asia/Shanghai';
  const [dayStart, dayEnd] = dayBounds(s.date, zone);
  const start = Date.parse(instant(plan.start, plan.date ?? s.date, zone));
  const end = start + plan.minutes * 60000;
  return end > dayStart && start < dayEnd ? [Math.max(start, dayStart), Math.min(end, dayEnd)] : null;
}
export function plansForDay(s: Snapshot) { return s.plans.filter(p => plannedRange(p, s) || planRanges(p, s).length); }
export function planRanges(plan: PlanItem, s: Snapshot): [number,number][] {
  const linked = (!plan.date || plan.date === s.date || plannedRange(plan, s)) ? visibleIntervals(s).filter(i => planIncludesInterval(plan, i, s)) : [];
  const zone = s.project.timeZone ?? 'Asia/Shanghai';
  const [dayStart, dayEnd] = dayBounds(s.date, zone);
  const legacy = linked.length || (plan.taskId && s.tasks[plan.taskId]?.sessionIds.length) ? [] : plan.actual;
  const manual = [...legacy, ...(plan.manualActual ?? []), ...(plan.manualStartedAt ? [[plan.manualStartedAt, new Date().toISOString()] as [string,string]] : [])];
  return unionRanges([...linked.map(i => intervalRange(i, s)), ...manual.map(([a,b]): [number,number] => {
    const start = Date.parse(instant(a, plan.date ?? s.date, zone));
    let end = Date.parse(instant(b, plan.date ?? s.date, zone));
    if (end < start) end = Date.parse(instant(b, nextDate(plan.date ?? s.date), zone));
    return [Math.max(start,dayStart), Math.min(end,dayEnd)];
  })]);
}
export function planFinished(plan: PlanItem,s: Snapshot) {
  if (plan.completedAt) return true;
  if (plan.follows) return false;
  if (plan.taskId && plan.workItemId) return s.orchestrations?.[plan.taskId]?.items[plan.workItemId]?.status === 'done';
  if(plan.taskId && s.tasks[plan.taskId]) return !!s.tasks[plan.taskId].completion;
  return plan.actual.length>0;
}
export function timelinePlanTotals(s: Snapshot) {
  const actual=rangeMinutes([...s.plans.flatMap(p=>planRanges(p,s)),...visibleIntervals(s).map(i=>intervalRange(i,s))]);
  return {planned:s.plans.reduce((n,p)=>n+rangeMinutes(plannedRange(p,s) ? [plannedRange(p,s)!] : []),0),actual,unfinished:s.plans.filter(p=>plannedRange(p,s) && !planFinished(p,s)).length};
}
