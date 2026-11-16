import type { Snapshot } from './types';
import { dayBounds, instant, intervalRange, planFinished, plannedRange, planRanges, rangeMinutes, timeInZone, unionRanges, visibleIntervals } from './timeline';

/** Unscheduled tasks are derived from the same project library, not copied into plans.
 * A task stays here until explicitly scheduled, completed or removed from the task list.
 * A future root arrangement also reserves it; child arrangements do not hide the rest of its work.
 */
export function pendingScheduleTasks(projects: Snapshot[], date: string) {
  return [...new Map(projects.map(s => [s.project.id, s])).values()].flatMap(snap => {
    const seen = new Set<string>();
    const [dayStart] = dayBounds(date, snap.project.timeZone);
    return snap.journal.blocks.flatMap((block, order) => {
      if (block.kind !== 'task' || seen.has(block.taskId)) return [];
      seen.add(block.taskId);
      const task = snap.tasks[block.taskId];
      if (!task || task.completion) return [];
      const upcoming = snap.plans.filter(plan => {
        if (plan.taskId !== task.id || plan.cancelled || planFinished(plan, snap)) return false;
        const starts = Date.parse(instant(plan.start, plan.date ?? snap.date, snap.project.timeZone));
        return starts + plan.minutes * 60000 > dayStart;
      });
      if (upcoming.some(plan => !plan.workItemId)) return [];
      let created = Date.parse(task.createdAt);
      if (!Number.isFinite(created)) {
        try { created = Date.parse(instant(task.createdAt, snap.date, snap.project.timeZone)); }
        catch { created = 0; }
      }
      return [{ key: JSON.stringify([snap.project.id, task.id]), task, project: snap.project, snap,
        partiallyScheduled: upcoming.some(plan => !!plan.workItemId), order,
        created: Number.isFinite(created) ? created : 0 }];
    });
  }).sort((a, b) => b.created - a.created || a.order - b.order || a.key.localeCompare(b.key));
}

/** A local day keeps project identity while merging overlapping actual work only once. */
export function dailySchedule(projects: Snapshot[], date: string) {
  const rows = [...new Map(projects.map(s => [s.project.id, s])).values()].flatMap(source => {
    const snap = { ...source, date };
    return snap.plans.flatMap(plan => {
      const planned = plannedRange(plan, snap);
      const actual = planRanges(plan, snap);
      if (!planned && !actual.length) return [];
      const task = plan.taskId ? snap.tasks[plan.taskId] : undefined;
      const item = plan.taskId && plan.workItemId ? snap.orchestrations?.[plan.taskId]?.items[plan.workItemId] : undefined;
      return [{ key: `${snap.project.id}:${plan.id}`, project: snap.project, plan, task, title: item?.title ?? task?.title ?? plan.title,
        planned, actual, actualMinutes: rangeMinutes(actual), finished: planFinished(plan, snap), snap,
        sortAt: planned?.[0] ?? actual[0]?.[0] ?? 0 }];
    });
  }).sort((a,b) => a.sortAt-b.sortAt || a.key.localeCompare(b.key));
  const actualRanges = [...rows.flatMap(row => row.actual), ...projects.flatMap(source => {
    const snap = { ...source, date }; return visibleIntervals(snap).map(interval => intervalRange(interval, snap));
  })];
  return { rows, planned: rows.reduce((n,row) => n+rangeMinutes(row.planned ? [row.planned] : []),0),
    actual: rangeMinutes(actualRanges), unfinished: rows.filter(row => row.planned && !row.finished).length,
    projectCount: new Set(rows.map(row => row.project.id)).size };
}

export function dayChartRange(range: [number,number], date: string, zone?: string) {
  const [start,end] = dayBounds(date,zone);
  return { left: `${Math.max(0,(range[0]-start)/(end-start)*100)}%`, width: `${Math.max(.25,(Math.min(end,range[1])-Math.max(start,range[0]))/(end-start)*100)}%` };
}

export interface PlanMove { projectId:string; planId:string; date:string; from:string; to:string; minutes:number }
export interface ScheduleWindow { start:string; end:string; timeZone?:string; now?:number }
/** Suggestions are pure: no clock tick mutates a plan or starts an execution. */
export function scheduleCapacity(projects:Snapshot[],date:string,window:ScheduleWindow) {
  const day=dailySchedule(projects,date),zone=window.timeZone??'Asia/Shanghai';
  const start=Date.parse(instant(window.start,date,zone)),end=Date.parse(instant(window.end,date,zone));
  if(end<=start)throw new Error('结束时间需要晚于开始时间');
  const now=window.now??Date.now(),from=Math.min(end,Math.max(start,Math.ceil(now/60000)*60000));
  const rows=day.rows.filter(row=>row.planned&&!row.plan.cancelled&&!row.finished);
  const locked=rows.filter(row=>row.plan.kind==='fixed'||row.actual.length>0||!!row.plan.manualStartedAt||(row.plan.date??row.snap.date)!==date);
  const flexible=rows.filter(row=>!locked.includes(row));
  const clip=(range:[number,number]):[number,number]=>[Math.max(from,range[0]),Math.min(end,range[1])];
  const occupied=unionRanges(locked.map(row=>clip(row.planned!)));
  const available=Math.max(0,(end-from)/60000-rangeMinutes(occupied));
  const demand=flexible.reduce((sum,row)=>sum+row.plan.minutes,0);
  const conflicts:{a:typeof rows[number];b:typeof rows[number];minutes:number}[]=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++) {
    const a=rows[i],b=rows[j],overlap=Math.min(a.planned![1],b.planned![1])-Math.max(a.planned![0],b.planned![0]);
    if(overlap>0)conflicts.push({a,b,minutes:overlap/60000});
  }
  const moves:PlanMove[]=[],unplaced:typeof rows=[];let cursor=from;
  for(const row of flexible) {
    const duration=row.plan.minutes*60000;let candidate=cursor;
    for(const [busyStart,busyEnd] of occupied) {
      if(candidate+duration<=busyStart)break;
      if(candidate<busyEnd)candidate=busyEnd;
    }
    const [projectStart,projectEnd]=dayBounds(date,row.project.timeZone);
    if(candidate+duration>end||candidate<projectStart||candidate+duration>projectEnd) {unplaced.push(row);continue;}
    const to=timeInZone(candidate,row.project.timeZone);
    if(Date.parse(instant(to,date,row.project.timeZone))!==candidate){unplaced.push(row);continue;}
    if(to!==row.plan.start)moves.push({projectId:row.project.id,planId:row.plan.id,date:row.plan.date??row.snap.date,from:row.plan.start,to,minutes:row.plan.minutes});
    cursor=candidate+duration;
  }
  return {start,end,from,available,demand,overload:Math.max(0,demand-available),conflicts,moves:unplaced.length?[]:moves,unplaced,locked,rows,expired:now>=end};
}

/** Optimistic validation prevents an old preview overwriting edits or newly started work. */
export function validatePlanMove(snapshot:Snapshot,move:PlanMove) {
  const plan=snapshot.plans.find(p=>p.id===move.planId);
  if(!plan||snapshot.project.id!==move.projectId||plan.cancelled||plan.kind!=='flexible'||plan.manualStartedAt||planFinished(plan,snapshot)||planRanges(plan,{...snapshot,date:move.date}).length)throw new Error('安排已开始或发生变化，请重新预览');
  if((plan.date??snapshot.date)!==move.date||plan.start!==move.from||plan.minutes!==move.minutes)throw new Error('安排已被修改，请重新预览');
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(move.to))throw new Error('重排时间无效');
  const at=Date.parse(instant(move.to,move.date,snapshot.project.timeZone));
  if(at+plan.minutes*60000>dayBounds(move.date,snapshot.project.timeZone)[1])throw new Error('重排不能超出当天，请手动选择其他日期');
  return plan;
}
