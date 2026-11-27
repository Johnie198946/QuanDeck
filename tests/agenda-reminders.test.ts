import assert from 'node:assert/strict';
import { agendaReminders, type ReminderLedger } from '../src/data/agendaReminders';
import { carriedScheduleAt, overdueScheduleDays, scheduleEntries, type AgendaEntry } from '../src/data/agendaSchedule';

import type { Snapshot } from '../src/data/types';

const brokenTime = {
  project:{id:'sample',name:'安排', timeZone:'America/New_York'}, date:'2026-03-08',tasks:{},
  plans:['02:30','broken','11:00'].map((start,i)=>({id:String(i),title:start,start,minutes:20,actual:[]})),
} as unknown as Snapshot;
assert.deepEqual(scheduleEntries([], [brokenTime]).map(row => row.title), ['11:00'], 'skip nonexistent and invalid legacy times without losing good plans');
const withRemoved = {
  ...brokenTime, tasks:{root:{id:'root'}},
  orchestrations:{root:{items:{stopped:{id:'stopped',status:'cancelled'}}}},
  plans:[
    {id:'cancelled-child',taskId:'root',workItemId:'stopped'},
    {id:'deleted-child',taskId:'root',workItemId:'missing'},
    {id:'deleted-root',taskId:'missing'},
    {id:'cancelled-plan',cancelled:true},
    {id:'standalone'},
  ].map(plan=>({...plan,title:plan.id,start:'11:30',minutes:20,actual:[]})),
} as unknown as Snapshot;
assert.deepEqual(scheduleEntries([], [withRemoved]).map(row=>row.title),['standalone']);
const zone = 'Asia/Shanghai';
const at = (local: string) => Date.parse(local + ':00+08:00');
const due = at('2026-11-26T17:00');
const entry: AgendaEntry = {key:'note:n:t',noteId:'n',todoId:'t',title:'核对清单',source:'笔记',at:due,done:false};
let ledger: ReminderLedger = {};
function tick(time: number, rows = [entry]) {
  const update = agendaReminders(rows, ledger, time, zone);
  ledger = JSON.parse(JSON.stringify(update.ledger)); // Simulate a persisted ledger on every tick.
  return update;
}
assert.equal(tick(due - 3600001).nextAt, due - 3600000);
assert.deepEqual(tick(due - 3600000).alerts.map(a=>a.phase), ['warning']);
assert.equal(tick(due - 1).alerts.length, 0);
assert.deepEqual(tick(due).alerts.map(a=>a.phase), ['due']);
assert.equal(tick(due).changed, false);
assert.deepEqual(tick(at('2026-11-26T18:00')).alerts.map(a=>a.phase), ['overdue']);
for (const day of ['27','28']) for (const hour of ['08','18']) {
  const when = at('2026-11-' + day + 'T' + hour + ':00');
  assert.equal(tick(when - 1).alerts.length, 0);
  assert.deepEqual(tick(when).alerts.map(a=>a.phase), ['overdue']);
  assert.equal(tick(when + 9000).alerts.length, 0);
}
assert.equal(tick(at('2026-12-02T20:55')).alerts.length, 1, 'wake after several missed days');
assert.equal(tick(at('2026-12-02T21:00')).alerts.length, 0);
assert.equal(tick(at('2026-12-03T08:00'), [{...entry,done:true}]).alerts.length, 0);
assert.deepEqual(Object.keys(ledger), [], 'completed records expire');
assert.deepEqual(tick(at('2026-12-03T16:00'), [{...entry,at:at('2026-12-03T17:00')}]).alerts.map(a=>a.phase), ['warning']);
assert.equal(tick(at('2026-12-03T17:00'), []).alerts.length, 0, 'removed or cancelled before time');
const coincident = {...entry, at:at('2026-11-26T18:00')};
assert.deepEqual(tick(coincident.at, [coincident]).alerts.map(a=>a.phase), ['due']);
assert.equal(tick(coincident.at, [coincident]).nextAt, at('2026-11-27T08:00'));
assert.equal(overdueScheduleDays(due, at('2026-11-27T00:01'), zone), 1);
assert.equal(overdueScheduleDays(due, at('2026-11-29T00:01'), zone), 3);
assert.equal(carriedScheduleAt(due, '2026-11-27', zone), at('2026-11-27T17:00'));
const ny = 'America/New_York';
const untilGap = Date.parse('2026-03-07T02:30:00-05:00');
assert.equal(carriedScheduleAt(untilGap, '2026-03-08', ny), Date.parse('2026-03-08T03:00:00-04:00'));
assert.equal(overdueScheduleDays(untilGap,Date.parse('2026-03-10T00:01:00-04:00'),ny),3);
console.log('日程截止、提醒时点、重复启动、延后唤醒、完成及取消、跨日与夏令时通过');
