// Owned by the main process so closing or throttling the renderer cannot stop reminders.
export function createAgendaNotifier({ projectEntries, evaluate, readLedger, writeLedger, enabled, notify, onError,
  now = Date.now, zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, timer = setTimeout, cancel = clearTimeout }) {
  let notes = [], plans = [], projectsReady = false, stopped = false, wake;
  let ledger = readLedger();
  function check() {
    cancel(wake);
    if (stopped || !projectsReady) return;
    let delay = 60000;
    try {
      if (enabled()) {
        const time = now();
        const { alerts, ledger: next, changed, nextAt } = evaluate([...notes, ...plans], ledger, time, zone());
        if (alerts.length) notify(alerts, time);
        if (changed) { writeLedger(next); ledger = next; }
        // Recheck if the wall clock, local time zone or notification settings changed.
        delay = Math.min(delay, Math.max(1, nextAt - time));
      }
    } catch (error) { onError(error); }
    wake = timer(check, delay);
    wake.unref?.();
  }
  return {
    setNotes(values) { notes = projectEntries(values, []); check(); },
    setProjects(values) { plans = projectEntries([], values); projectsReady = true; check(); },
    check,
    stop() { stopped = true; cancel(wake); },
  };
}

export function reminderMessage(alerts, time) {
  if (alerts.length > 1) {
    const names = alerts.slice(0, 3).map(({ entry }) => entry.title);
    return { title: alerts.length + ' 项日程提醒', body: names.join('、').slice(0, 160) + (alerts.length > 3 ? ' 等' : '') + '。点击查看日程。' };
  }
  const { phase, entry } = alerts[0];
  const minutes = Math.max(1, Math.ceil((entry.at - time) / 60000));
  const title = phase === 'warning' ? '日程还有 ' + minutes + ' 分钟' : phase === 'due' ? '日程已到时间' : '这项日程还未完成';
  return { title, body: (entry.title + ' · ' + entry.source).slice(0, 180) };
}
