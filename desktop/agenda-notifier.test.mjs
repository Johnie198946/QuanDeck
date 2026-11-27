import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgendaNotifier, reminderMessage } from './app/agenda-notifier.mjs';

test('main scheduler shares the clock between windows, follows writes, resume and stop', () => {
  let value = {}, time = 2000, allowed = true, active = 0;
  const notices = [], timers = new Map(), writes = [];
  const scheduler = createAgendaNotifier({
    projectEntries: (notes, plans) => [...notes,...plans],
    readLedger: () => value, writeLedger(next) {value=next;writes.push(next);},
    evaluate(entries, ledger, now) {
      const next = Object.fromEntries(entries.filter(e=>!e.done && e.at<=now).map(e=>[e.key,e.at]));
      return { ledger:next, changed:JSON.stringify(ledger)!==JSON.stringify(next),
        alerts:entries.filter(e=>next[e.key] && !ledger[e.key]), nextAt:Math.min(...entries.filter(e=>!e.done && e.at>now).map(e=>e.at)) };
    },
    notify: alerts => notices.push(alerts.map(e=>e.key)),
    enabled:()=>allowed, onError: e=>{throw e;}, now:()=>time, zone:()=>'Asia/Shanghai',
    timer: (fn, delay)=>{ timers.set(++active,{fn,delay});return active; }, cancel: id=>timers.delete(id),
  });
  scheduler.setNotes([{key:'note',at:2200}]);
  assert.equal(timers.size,0);
  scheduler.setProjects([{key:'plan',at:2200}]);
  assert.equal(timers.get(active).delay,200);
  time=2200; timers.get(active).fn();
  assert.deepEqual(notices,[['note','plan']]);
  scheduler.check();assert.equal(timers.size,1);assert.equal(writes.length,1);
  scheduler.setNotes([]);assert.deepEqual(value,{plan:2200});
  allowed=false;scheduler.setProjects([{key:'next',at:4000}]);time=4100;
  scheduler.check();assert.equal(notices.length,1);
  allowed=true;scheduler.check();assert.deepEqual(notices.at(-1),['next']);
  scheduler.stop();scheduler.check();assert.equal(timers.size,0);
});
test('notification labels reflect actual remaining minutes and group simultaneous items', () => {
  const entry={title:'检查行程',source:'日记',at:3600000};
  const warning={entry,phase:'warning'};
  assert.match(reminderMessage([warning],0).title,/60 分钟/);
  assert.match(reminderMessage([warning],20*60000).title,/40 分钟/);
  assert.match(reminderMessage([{entry,phase:'due'}],entry.at).title,/到时间/);
  assert.match(reminderMessage([{entry,phase:'overdue'}],entry.at).title,/未完成/);
  assert.match(reminderMessage([warning,warning],0).title,/2 项/);
});
